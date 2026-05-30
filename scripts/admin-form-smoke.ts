import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";
import { createSupabaseAdminClient } from "../src/lib/supabase.js";

/**
 * Smoke e2e do formulario admin (spec 002) com Bearer token admin REAL.
 *
 * Prova, contra o backend + Supabase reais:
 *  1. Login admin real via Supabase Auth (anon key publicavel).
 *  2. POST /v1/admin/geocode/cep -> 200 com coordenada (caminho CEP do formulario).
 *  3. GET  /v1/admin/lawyers     -> 200 lendo do Supabase real (persistence != memory).
 *
 * O INSERT de advogado (POST /v1/admin/lawyers) deixa residuo na base real e
 * NAO tem rota de delete, entao so roda com ADMIN_FORM_SMOKE_WRITE=true (gate
 * explicito). Por padrao o smoke e nao-destrutivo.
 *
 * Seguranca: o access_token nunca e impresso; apenas status e metadados sem PII.
 */

const env = loadEnv();
if (!env.SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_ANON_KEY e obrigatoria para admin-form-smoke (use a anon key publicavel).");
}

const ADMIN_EMAIL = "admin@advogado20.com";
const CEP_TESTE = "72309-601"; // CEP ja usado em fixtures (Brasilia/Samambaia Sul).

function parseAdminCredential(raw: string): { email: string; password: string } {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i += 2) {
    const email = lines[i];
    const password = lines[i + 1];
    if (email === ADMIN_EMAIL && password) {
      return { email, password };
    }
  }
  throw new Error(`Credencial do ${ADMIN_EMAIL} nao encontrada no arquivo de credenciais.`);
}

const credentialsPath = resolve(process.cwd(), "..", "Credenciais para testes.txt");
const credential = parseAdminCredential(await readFile(credentialsPath, "utf8"));

const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const { data, error } = await authClient.auth.signInWithPassword(credential);
if (error || !data.session?.access_token) {
  console.error(JSON.stringify({ result: "FALHOU", step: "login", message: error?.message ?? "sem sessao" }));
  process.exit(1);
}
const adminToken = data.session.access_token; // nunca impresso.
const authHeader = { authorization: `Bearer ${adminToken}` };

const app = await buildApp();
const steps: Array<Record<string, unknown>> = [];
let ok = true;

// 1. CEP do formulario -> coordenada.
const geocode = await app.inject({
  method: "POST",
  url: "/v1/admin/geocode/cep",
  headers: authHeader,
  payload: { cep: CEP_TESTE }
});
const geocodeBody = geocode.json() as { coordinates?: { lat: number; lng: number } | null; persistence?: string };
const geocodeOk = geocode.statusCode === 200;
ok &&= geocodeOk;
steps.push({
  step: "POST /v1/admin/geocode/cep",
  statusCode: geocode.statusCode,
  expected: 200,
  hasCoordinate: Boolean(geocodeBody.coordinates),
  persistence: geocodeBody.persistence,
  ok: geocodeOk
});

// 2. Listagem real do Supabase.
const list = await app.inject({ method: "GET", url: "/v1/admin/lawyers", headers: authHeader });
const listBody = list.json() as { lawyers?: unknown[]; persistence?: string };
const listOk = list.statusCode === 200 && listBody.persistence !== "memory";
ok &&= listOk;
steps.push({
  step: "GET /v1/admin/lawyers",
  statusCode: list.statusCode,
  expected: 200,
  count: Array.isArray(listBody.lawyers) ? listBody.lawyers.length : null,
  persistence: listBody.persistence,
  ok: listOk
});

// 3. INSERT real (gated) + limpeza imediata via service role (rodar e limpar).
//    O create grava em `profiles` E `lawyer_profiles`; ambas sao removidas no fim.
if (process.env.ADMIN_FORM_SMOKE_WRITE === "true") {
  const create = await app.inject({
    method: "POST",
    url: "/v1/admin/lawyers",
    headers: authHeader,
    payload: {
      name: "Smoke Teste Advogado",
      email: `smoke+${Date.now()}@advogado20.com`,
      whatsapp: "5561999990000",
      oabNumber: `SMOKE-${Date.now()}`,
      oabState: "DF",
      mainAreaId: "civil",
      secondaryAreaIds: [],
      officeCep: "70040-010",
      officeNumber: "100",
      status: "draft" // fora do match; nao aprovado.
    }
  });
  const createOk = create.statusCode === 201;
  ok &&= createOk;
  const createdLawyer = createOk
    ? ((create.json() as { lawyer?: { id?: string; profileId?: string } }).lawyer ?? {})
    : {};
  const lawyerId = createdLawyer.id;
  const profileId = createdLawyer.profileId;

  // Limpeza: remove lawyer_profiles e o profile criado, sem deixar residuo.
  let cleanup: Record<string, unknown> = { attempted: false };
  if (createOk && lawyerId) {
    const admin = createSupabaseAdminClient(env);
    if (!admin) {
      cleanup = { attempted: false, reason: "service role indisponivel" };
      ok = false;
    } else {
      const delLawyer = await admin.from("lawyer_profiles").delete().eq("id", lawyerId);
      const delProfile = profileId
        ? await admin.from("profiles").delete().eq("id", profileId)
        : { error: null };
      const cleanupOk = !delLawyer.error && !delProfile.error;
      ok &&= cleanupOk;
      cleanup = {
        attempted: true,
        lawyerDeleted: !delLawyer.error,
        profileDeleted: !delProfile.error,
        ok: cleanupOk,
        ...(delLawyer.error ? { lawyerError: delLawyer.error.message } : {}),
        ...(delProfile.error ? { profileError: delProfile.error.message } : {})
      };
    }
  }
  steps.push({ step: "POST /v1/admin/lawyers", statusCode: create.statusCode, expected: 201, ok: createOk, cleanup });
} else {
  steps.push({ step: "POST /v1/admin/lawyers", skipped: true, reason: "ADMIN_FORM_SMOKE_WRITE!=true (nao-destrutivo)" });
}

await app.close();

const out = { result: ok ? "OK" : "FALHOU", admin: ADMIN_EMAIL, tokenLogado: "REDACTED", steps };
console.log(JSON.stringify(out, null, 2));
process.exit(ok ? 0 : 1);
