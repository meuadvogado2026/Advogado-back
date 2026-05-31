import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createSupabaseAdminClient } from "../src/lib/supabase.js";

/**
 * Smoke e2e do match real geoespacial (spec 001) com Bearer token de CLIENTE real,
 * contra o backend + Supabase reais (RPC PostGIS `match_nearest_lawyer`).
 *
 * Prova:
 *  - login cliente real via Supabase Auth (anon key publicavel);
 *  - GET /v1/areas -> ids reais de especialidades;
 *  - POST /v1/match perto da fixture SP (civil) -> 200 `matched`, advogado em Sao Paulo, distancia ~0;
 *  - GET /v1/lawyers/:id para o match retornado -> 200 com allowlist publica segura;
 *  - POST /v1/match com area sem advogado aprovado -> 200 `empty`;
 *  - POST /v1/match sem token -> 401.
 *
 * O endpoint grava `match_events` (coordenada LGPD) no Supabase real. Para nao
 * deixar residuo, os eventos criados por este smoke sao removidos no fim via
 * service role (filtrando pelo cliente + janela de tempo do smoke).
 * Seguranca: o access_token nunca e impresso; coordenadas nao vao para log.
 */

const env = loadEnv();
if (!env.SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_ANON_KEY e obrigatoria para match-smoke (anon key publicavel).");
}

const CLIENT_EMAIL = "usuario@advogado20.com";
// Coordenada do escritorio fixture em Sao Paulo (Av. Paulista) - seed 001_match_fixtures.
const SP_FIXTURE = { lat: -23.561414, lng: -46.655881 };
const COVERED_SLUGS = new Set(["civil", "consumidor", "trabalhista", "familia"]);

function parseClientCredential(raw: string): { email: string; password: string } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 2) {
    const email = lines[i];
    const password = lines[i + 1];
    if (email === CLIENT_EMAIL && password) {
      return { email, password };
    }
  }
  throw new Error(`Credencial do ${CLIENT_EMAIL} nao encontrada no arquivo de credenciais.`);
}

const credentialsPath = resolve(process.cwd(), "..", "Credenciais para testes.txt");
const credential = parseClientCredential(await readFile(credentialsPath, "utf8"));

const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const { data: session, error: loginError } = await authClient.auth.signInWithPassword(credential);
if (loginError || !session.session?.access_token) {
  console.error(JSON.stringify({ result: "FALHOU", step: "login", message: loginError?.message ?? "sem sessao" }));
  process.exit(1);
}
const clientToken = session.session.access_token; // nunca impresso.
const authHeader = { authorization: `Bearer ${clientToken}` };

const app = await buildApp();
const steps: Array<Record<string, unknown>> = [];
let ok = true;

// Marca o inicio da janela do smoke para a limpeza dos match_events.
const startedAt = new Date(Date.now() - 1000).toISOString();
let matchedLawyerId: string | undefined;

// Areas reais.
const areasRes = await app.inject({ method: "GET", url: "/v1/areas" });
const areas = (areasRes.json() as { areas?: Array<{ id: string; slug: string }> }).areas ?? [];
const civil = areas.find((a) => a.slug === "civil");
const uncovered = areas.find((a) => !COVERED_SLUGS.has(a.slug));
steps.push({
  step: "GET /v1/areas",
  statusCode: areasRes.statusCode,
  count: areas.length,
  hasCivil: Boolean(civil),
  uncoveredSlug: uncovered?.slug ?? null,
  ok: areasRes.statusCode === 200 && Boolean(civil)
});
ok &&= areasRes.statusCode === 200 && Boolean(civil);

// 1. matched: perto da fixture SP, area civil.
if (civil) {
  const matched = await app.inject({
    method: "POST",
    url: "/v1/match",
    headers: authHeader,
    payload: { ...SP_FIXTURE, accuracyM: 20, areaIds: [civil.id] }
  });
  const body = matched.json() as { status?: string; lawyer?: { id?: string; city?: string }; distanceKm?: number };
  const matchedOk = matched.statusCode === 200 && body.status === "matched" && (body.distanceKm ?? 99) < 5;
  matchedLawyerId = body.lawyer?.id;
  ok &&= matchedOk;
  steps.push({
    step: "POST /v1/match (SP/civil)",
    statusCode: matched.statusCode,
    status: body.status,
    lawyerCity: body.lawyer?.city ?? null,
    distanceKm: body.distanceKm ?? null,
    ok: matchedOk
  });
}

// 2. perfil publico seguro do advogado retornado.
if (matchedLawyerId) {
  const profile = await app.inject({
    method: "GET",
    url: `/v1/lawyers/${matchedLawyerId}`,
    headers: authHeader
  });
  const body = profile.json() as {
    lawyer?: Record<string, unknown> & { verified?: boolean; areas?: unknown[] };
  };
  const forbiddenFields = ["email", "officeCep", "officeNumber", "officeLat", "officeLng", "office_location"];
  const hasForbiddenField = forbiddenFields.some((field) => body.lawyer?.[field] !== undefined);
  const profileOk =
    profile.statusCode === 200 &&
    body.lawyer?.verified === true &&
    Array.isArray(body.lawyer.areas) &&
    !hasForbiddenField;
  ok &&= profileOk;
  steps.push({
    step: "GET /v1/lawyers/:id (perfil publico)",
    statusCode: profile.statusCode,
    verified: body.lawyer?.verified ?? null,
    areasCount: body.lawyer?.areas?.length ?? null,
    hasForbiddenField,
    ok: profileOk
  });
} else {
  steps.push({ step: "GET /v1/lawyers/:id (perfil publico)", skipped: true, reason: "match sem lawyer.id" });
  ok = false;
}

// 3. empty: mesma coordenada, area sem advogado aprovado proximo.
if (uncovered) {
  const empty = await app.inject({
    method: "POST",
    url: "/v1/match",
    headers: authHeader,
    payload: { ...SP_FIXTURE, accuracyM: 20, areaIds: [uncovered.id] }
  });
  const body = empty.json() as { status?: string };
  const emptyOk = empty.statusCode === 200 && body.status === "empty";
  ok &&= emptyOk;
  steps.push({ step: `POST /v1/match (SP/${uncovered.slug})`, statusCode: empty.statusCode, status: body.status, expected: "empty", ok: emptyOk });
} else {
  steps.push({ step: "POST /v1/match (empty)", skipped: true, reason: "nenhuma area sem cobertura disponivel" });
}

// 4. sem token -> 401.
const noToken = await app.inject({
  method: "POST",
  url: "/v1/match",
  payload: { ...SP_FIXTURE, accuracyM: 20, areaIds: civil ? [civil.id] : ["x"] }
});
ok &&= noToken.statusCode === 401;
steps.push({ step: "POST /v1/match (sem token)", statusCode: noToken.statusCode, expected: 401, ok: noToken.statusCode === 401 });

await app.close();

// Limpeza dos match_events criados por este smoke (residuo LGPD).
let cleanup: Record<string, unknown> = { attempted: false };
const admin = createSupabaseAdminClient(env);
if (!admin) {
  cleanup = { attempted: false, reason: "service role indisponivel" };
  ok = false;
} else {
  const { data: profile } = await admin.from("profiles").select("id").eq("email", CLIENT_EMAIL).maybeSingle();
  const clientProfileId = (profile as { id?: string } | null)?.id;
  if (clientProfileId) {
    const del = await admin
      .from("match_events")
      .delete()
      .eq("client_profile_id", clientProfileId)
      .gte("created_at", startedAt)
      .select("id");
    const cleanupOk = !del.error;
    ok &&= cleanupOk;
    cleanup = {
      attempted: true,
      eventsDeleted: del.data?.length ?? 0,
      ok: cleanupOk,
      ...(del.error ? { error: del.error.message } : {})
    };
  } else {
    cleanup = { attempted: false, reason: "client_profile_id nao encontrado" };
    ok = false;
  }
}

console.log(JSON.stringify({ result: ok ? "OK" : "FALHOU", client: CLIENT_EMAIL, tokenLogado: "REDACTED", steps, cleanup }, null, 2));
process.exit(ok ? 0 : 1);
