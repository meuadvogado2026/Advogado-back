import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../src/config/env.js";
import { createSupabaseAdminClient } from "../src/lib/supabase.js";

/**
 * Smoke e2e contra o backend de PRODUCAO (Railway) via HTTP real.
 *
 * Diferente de match-smoke/form-smoke (que usam app.inject em processo), este
 * faz fetch contra a URL publica, validando o deploy de ponta a ponta:
 *  - GET  /health
 *  - GET  /v1/areas
 *  - POST /v1/match (cliente real): matched SP/civil, empty SP/criminal, 401 sem token
 *  - GET  /v1/lawyers/:id (cliente real): 200 com allowlist publica, 401 sem token
 *  - POST /v1/admin/geocode/cep (admin real): 200
 *  - GET  /v1/admin/lawyers (admin real): 200 persistence=supabase
 *  - GET  /v1/lawyer/me/dashboard: 401 sem token, 403 cliente, 200 advogado
 *  - POST /v1/prayer-requests: 401 sem token, 403 advogado/admin, 422 invalido,
 *    201 cliente anonimo/identificado sem ecoar mensagem
 * Limpa os match_events criados (residuo LGPD). Tokens nunca impressos.
 *
 * Uso (cwd = back):
 *   $env:SUPABASE_ANON_KEY=<anon>; $env:PROD_BASE_URL="https://...up.railway.app"; npm run prod:smoke
 */

const env = loadEnv();
if (!env.SUPABASE_ANON_KEY) throw new Error("SUPABASE_ANON_KEY e obrigatoria (anon key publicavel).");
const BASE = (process.env.PROD_BASE_URL ?? "").replace(/\/$/, "");
if (!BASE) throw new Error("PROD_BASE_URL e obrigatoria (ex.: https://seu-app.up.railway.app).");

const ADMIN_EMAIL = "admin@advogado20.com";
const CLIENT_EMAIL = "usuario@advogado20.com";
const LAWYER_EMAIL = "advogado@advogado20.com";
const SP_FIXTURE = { lat: -23.561414, lng: -46.655881 };
const COVERED = new Set(["civil", "consumidor", "trabalhista", "familia"]);
const PUBLIC_PROFILE_KEYS = new Set([
  "id",
  "name",
  "oabNumber",
  "oabState",
  "city",
  "state",
  "areaIds",
  "areas",
  "whatsapp",
  "verified",
  "avatarUrl",
  "coverUrl",
  "miniBio",
  "fullBio",
  "yearsExperience",
  "planLabel",
  "emergencyAvailable"
]);
const PUBLIC_AREA_KEYS = new Set(["id", "name"]);
const NEUTRAL_PRAYER_TEXT = "Pedido neutro de teste automatizado sem dado sensivel.";

function cred(raw: string, email: string) {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 2) if (lines[i] === email && lines[i + 1]) return { email, password: lines[i + 1]! };
  throw new Error(`Credencial de ${email} nao encontrada.`);
}

async function login(authClient: { auth: { signInWithPassword: (c: { email: string; password: string }) => Promise<{ data: { session: { access_token?: string } | null }; error: { message: string } | null }> } }, c: { email: string; password: string }) {
  const { data, error } = await authClient.auth.signInWithPassword(c);
  if (error || !data.session?.access_token) throw new Error(`login ${c.email}: ${error?.message ?? "sem sessao"}`);
  return data.session.access_token;
}

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  let body: unknown = null;
  try { body = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body };
}

const credsRaw = await readFile(resolve(process.cwd(), "..", "Credenciais para testes.txt"), "utf8");
const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const adminToken = await login(authClient, cred(credsRaw, ADMIN_EMAIL));
const clientToken = await login(authClient, cred(credsRaw, CLIENT_EMAIL));
const lawyerToken = await login(authClient, cred(credsRaw, LAWYER_EMAIL));
const adminH = { authorization: `Bearer ${adminToken}`, "content-type": "application/json" };
const clientH = { authorization: `Bearer ${clientToken}`, "content-type": "application/json" };
const lawyerH = { authorization: `Bearer ${lawyerToken}`, "content-type": "application/json" };

const steps: Array<Record<string, unknown>> = [];
let ok = true;
const startedAt = new Date(Date.now() - 1000).toISOString();
const mark = (s: Record<string, unknown>, pass: boolean) => { ok &&= pass; steps.push({ ...s, ok: pass }); };
const prayerRequestIds: string[] = [];

// health
const health = await call("/health");
mark({ step: "GET /health", status: health.status }, health.status === 200);

// areas
const areas = await call("/v1/areas");
const list = (areas.body as { areas?: Array<{ id: string; slug: string }> })?.areas ?? [];
const civil = list.find((a) => a.slug === "civil");
const uncovered = list.find((a) => !COVERED.has(a.slug));
mark({ step: "GET /v1/areas", status: areas.status, count: list.length }, areas.status === 200 && list.length === 6 && Boolean(civil));

// match matched
let matchedLawyerId: string | undefined;
if (civil) {
  const m = await call("/v1/match", { method: "POST", headers: clientH, body: JSON.stringify({ ...SP_FIXTURE, accuracyM: 20, areaIds: [civil.id] }) });
  const b = m.body as { status?: string; lawyer?: { id?: string; city?: string }; distanceKm?: number };
  matchedLawyerId = b?.lawyer?.id;
  mark({ step: "POST /v1/match SP/civil", status: m.status, matchStatus: b?.status, city: b?.lawyer?.city, distanceKm: b?.distanceKm }, m.status === 200 && b?.status === "matched");
}

// lawyer profile no token
const profileNoTok = await call(`/v1/lawyers/${matchedLawyerId ?? "perfil-indisponivel"}`);
mark({ step: "GET /v1/lawyers/:id sem token", status: profileNoTok.status }, profileNoTok.status === 401);

// lawyer profile public allowlist
if (matchedLawyerId) {
  const profile = await call(`/v1/lawyers/${matchedLawyerId}`, { headers: clientH });
  const lawyer = (profile.body as { lawyer?: Record<string, unknown> })?.lawyer;
  const unexpectedFields = lawyer ? Object.keys(lawyer).filter((key) => !PUBLIC_PROFILE_KEYS.has(key)) : ["lawyer"];
  const areas = Array.isArray(lawyer?.areas) ? lawyer.areas as Array<Record<string, unknown>> : [];
  const unexpectedAreaFields = areas.flatMap((area) => Object.keys(area).filter((key) => !PUBLIC_AREA_KEYS.has(key)));
  const profileOk = profile.status === 200 && lawyer?.verified === true && areas.length > 0 && unexpectedFields.length === 0 && unexpectedAreaFields.length === 0;
  mark({
    step: "GET /v1/lawyers/:id perfil publico",
    status: profile.status,
    verified: lawyer?.verified ?? null,
    areasCount: areas.length,
    hasForbiddenField: unexpectedFields.length > 0 || unexpectedAreaFields.length > 0
  }, profileOk);
} else {
  mark({ step: "GET /v1/lawyers/:id perfil publico", skipped: true, reason: "match sem lawyer.id" }, false);
}

// match empty
if (uncovered) {
  const m = await call("/v1/match", { method: "POST", headers: clientH, body: JSON.stringify({ ...SP_FIXTURE, accuracyM: 20, areaIds: [uncovered.id] }) });
  mark({ step: `POST /v1/match SP/${uncovered.slug}`, status: m.status, matchStatus: (m.body as { status?: string })?.status }, m.status === 200 && (m.body as { status?: string })?.status === "empty");
}
// match no token
const noTok = await call("/v1/match", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...SP_FIXTURE, accuracyM: 20, areaIds: civil ? [civil.id] : ["x"] }) });
mark({ step: "POST /v1/match sem token", status: noTok.status }, noTok.status === 401);

// admin geocode
const geo = await call("/v1/admin/geocode/cep", { method: "POST", headers: adminH, body: JSON.stringify({ cep: "01310-100" }) });
mark({ step: "POST /v1/admin/geocode/cep", status: geo.status, persistence: (geo.body as { persistence?: string })?.persistence }, geo.status === 200);

// admin list
const lw = await call("/v1/admin/lawyers", { headers: adminH });
const pers = (lw.body as { persistence?: string })?.persistence;
mark({ step: "GET /v1/admin/lawyers", status: lw.status, persistence: pers }, lw.status === 200 && pers === "supabase");

// spec 008 part 3 - lawyer dashboard auth/role matrix
const dashboardNoTok = await call("/v1/lawyer/me/dashboard");
mark({ step: "GET /v1/lawyer/me/dashboard sem token", status: dashboardNoTok.status }, dashboardNoTok.status === 401);

const dashboardClient = await call("/v1/lawyer/me/dashboard", { headers: clientH });
mark({ step: "GET /v1/lawyer/me/dashboard cliente", status: dashboardClient.status }, dashboardClient.status === 403);

const dashboardLawyer = await call("/v1/lawyer/me/dashboard", { headers: lawyerH });
const dashboardBody = dashboardLawyer.body as { lawyer?: { id?: string; name?: string }; metrics?: unknown; benefits?: unknown[] };
mark(
  {
    step: "GET /v1/lawyer/me/dashboard advogado",
    status: dashboardLawyer.status,
    hasLawyer: Boolean(dashboardBody?.lawyer?.id),
    benefitsCount: Array.isArray(dashboardBody?.benefits) ? dashboardBody.benefits.length : null
  },
  dashboardLawyer.status === 200 && Boolean(dashboardBody?.lawyer?.id) && Array.isArray(dashboardBody?.benefits)
);

// spec 008 part 3 - prayer request auth/role matrix and no message echo
const prayerNoTok = await call("/v1/prayer-requests", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ message: NEUTRAL_PRAYER_TEXT, anonymous: true })
});
mark({ step: "POST /v1/prayer-requests sem token", status: prayerNoTok.status }, prayerNoTok.status === 401);

const prayerLawyer = await call("/v1/prayer-requests", {
  method: "POST",
  headers: lawyerH,
  body: JSON.stringify({ message: NEUTRAL_PRAYER_TEXT, anonymous: true })
});
mark({ step: "POST /v1/prayer-requests advogado", status: prayerLawyer.status }, prayerLawyer.status === 403);

const prayerAdmin = await call("/v1/prayer-requests", {
  method: "POST",
  headers: adminH,
  body: JSON.stringify({ message: NEUTRAL_PRAYER_TEXT, anonymous: true })
});
mark({ step: "POST /v1/prayer-requests admin", status: prayerAdmin.status }, prayerAdmin.status === 403);

const prayerInvalid = await call("/v1/prayer-requests", {
  method: "POST",
  headers: clientH,
  body: JSON.stringify({ message: "curto", anonymous: true })
});
mark({ step: "POST /v1/prayer-requests payload invalido", status: prayerInvalid.status }, prayerInvalid.status === 422);

const prayerAnonymous = await call("/v1/prayer-requests", {
  method: "POST",
  headers: clientH,
  body: JSON.stringify({ message: NEUTRAL_PRAYER_TEXT, anonymous: true })
});
const anonymousEcho = JSON.stringify(prayerAnonymous.body).includes(NEUTRAL_PRAYER_TEXT);
const anonymousPrayerId = (prayerAnonymous.body as { request?: { id?: string } })?.request?.id;
if (anonymousPrayerId) prayerRequestIds.push(anonymousPrayerId);
mark(
  { step: "POST /v1/prayer-requests cliente anonimo", status: prayerAnonymous.status, echoedMessage: anonymousEcho },
  prayerAnonymous.status === 201 && !anonymousEcho
);

const prayerIdentified = await call("/v1/prayer-requests", {
  method: "POST",
  headers: clientH,
  body: JSON.stringify({ message: NEUTRAL_PRAYER_TEXT, anonymous: false })
});
const identifiedBody = JSON.stringify(prayerIdentified.body);
const identifiedPrayerId = (prayerIdentified.body as { request?: { id?: string } })?.request?.id;
if (identifiedPrayerId) prayerRequestIds.push(identifiedPrayerId);
mark(
  {
    step: "POST /v1/prayer-requests cliente identificado",
    status: prayerIdentified.status,
    echoedMessage: identifiedBody.includes(NEUTRAL_PRAYER_TEXT),
    echoedClientProfileId: identifiedBody.includes("clientProfileId")
  },
  prayerIdentified.status === 201 &&
    !identifiedBody.includes(NEUTRAL_PRAYER_TEXT) &&
    !identifiedBody.includes("clientProfileId")
);

// cleanup match_events
let cleanup: Record<string, unknown> = { attempted: false };
const admin = createSupabaseAdminClient(env);
if (admin) {
  const { data: prof } = await admin.from("profiles").select("id").eq("email", CLIENT_EMAIL).maybeSingle();
  const pid = (prof as { id?: string } | null)?.id;
  const cleanupParts: Record<string, unknown> = { attempted: true };
  if (pid) {
    const del = await admin.from("match_events").delete().eq("client_profile_id", pid).gte("created_at", startedAt).select("id");
    cleanupParts.eventsDeleted = del.data?.length ?? 0;
    cleanupParts.eventsOk = !del.error;
    ok &&= !del.error;
  }
  if (prayerRequestIds.length > 0) {
    const delPrayer = await admin.from("prayer_requests").delete().in("id", prayerRequestIds).select("id");
    cleanupParts.prayerRequestsDeleted = delPrayer.data?.length ?? 0;
    cleanupParts.prayerRequestsOk = !delPrayer.error;
    ok &&= !delPrayer.error;
  } else {
    cleanupParts.prayerRequestsDeleted = 0;
    cleanupParts.prayerRequestsOk = true;
  }
  cleanup = cleanupParts;
} else {
  cleanup = {
    attempted: false,
    reason: "service role local indisponivel (limpe match_events/prayer_requests manualmente se necessario)"
  };
}

console.log(JSON.stringify({ result: ok ? "OK" : "FALHOU", base: BASE, tokens: "REDACTED", steps, cleanup }, null, 2));
process.exit(ok ? 0 : 1);
