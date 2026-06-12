import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

/**
 * Benchmark nao destrutivo das listas admin filtradas.
 *
 * Mede o caminho completo da rota ate o Supabase sem imprimir token, dados
 * pessoais ou corpos das respostas. O aquecimento fica fora das amostras.
 */

const env = loadEnv();
if (!env.SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_ANON_KEY e obrigatoria para admin-filter:perf (use a anon key publicavel).");
}

const ADMIN_EMAIL = "admin@advogado20.com";
const WARMUP_RUNS = 2;
const SAMPLE_RUNS = boundedInteger(process.env.ADMIN_FILTER_PERF_SAMPLES, 7, 3, 30);
const P95_BUDGET_MS = boundedInteger(process.env.ADMIN_FILTER_P95_BUDGET_MS, 1_500, 100, 30_000);
const PUBLIC_BASE_URL = normalizePublicBaseUrl(process.env.ADMIN_FILTER_PERF_BASE_URL);

function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function normalizePublicBaseUrl(raw: string | undefined) {
  if (!raw) return null;
  const url = new URL(raw);
  if (url.protocol !== "https:") {
    throw new Error("ADMIN_FILTER_PERF_BASE_URL deve usar HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

function parseAdminCredential(raw: string): { email: string; password: string } {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = 0; i < lines.length; i += 2) {
    const email = lines[i];
    const password = lines[i + 1];
    if (email === ADMIN_EMAIL && password) return { email, password };
  }
  throw new Error(`Credencial do ${ADMIN_EMAIL} nao encontrada no arquivo de credenciais.`);
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function rounded(value: number) {
  return Math.round(value * 10) / 10;
}

type PaginatedBody = {
  pagination?: { page: number; pageSize: number; total: number; totalPages: number };
  persistence?: string;
  lawyers?: unknown[];
  requests?: unknown[];
  users?: unknown[];
  partners?: unknown[];
};

const credentialsPath = resolve(process.cwd(), "..", "Credenciais para testes.txt");
const credential = parseAdminCredential(await readFile(credentialsPath, "utf8"));
const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const { data, error } = await authClient.auth.signInWithPassword(credential);
if (error || !data.session?.access_token) {
  throw new Error(`Falha no login de performance: ${error?.message ?? "sem sessao"}.`);
}

const authHeader = { authorization: `Bearer ${data.session.access_token}` };
const app = PUBLIC_BASE_URL ? null : await buildApp();
const request = async (url: string) => {
  if (PUBLIC_BASE_URL) {
    const response = await fetch(`${PUBLIC_BASE_URL}${url}`, { headers: authHeader });
    let body: PaginatedBody = {};
    try {
      body = (await response.json()) as PaginatedBody;
    } catch {
      // Resposta invalida sera marcada por validResponses.
    }
    return { statusCode: response.status, body };
  }

  const response = await app!.inject({ method: "GET", url, headers: authHeader });
  return { statusCode: response.statusCode, body: response.json() as PaginatedBody };
};
const checks = [
  { step: "lawyers-status", url: "/v1/admin/lawyers?page=1&pageSize=5&status=draft", key: "lawyers" },
  { step: "lawyers-search", url: "/v1/admin/lawyers?page=1&pageSize=5&search=SP", key: "lawyers" },
  {
    step: "prayers-status",
    url: "/v1/admin/prayer-requests?page=1&pageSize=5&status=received",
    key: "requests"
  },
  { step: "users-search", url: "/v1/admin/users?page=1&pageSize=5&search=admin", key: "users" },
  { step: "partners-page", url: "/v1/admin/partner-logos?page=1&pageSize=5", key: "partners" }
] as const;

const results: Array<Record<string, unknown>> = [];
let ok = true;

try {
  for (const check of checks) {
    const durations: number[] = [];
    let validResponses = true;
    let responseContract: Record<string, unknown> = {};

    for (let run = 0; run < WARMUP_RUNS + SAMPLE_RUNS; run += 1) {
      const startedAt = performance.now();
      const response = await request(check.url);
      const elapsedMs = performance.now() - startedAt;
      const body = response.body;
      const items = body[check.key];
      responseContract = {
        statusCode: response.statusCode,
        persistence: body.persistence ?? null,
        hasPagination: Boolean(body.pagination),
        hasExpectedCollection: Array.isArray(items)
      };
      validResponses &&=
        response.statusCode === 200 &&
        body.persistence === "supabase" &&
        Boolean(body.pagination) &&
        Array.isArray(items) &&
        items.length <= 5;
      if (run >= WARMUP_RUNS) durations.push(elapsedMs);
    }

    const p50Ms = percentile(durations, 0.5);
    const p95Ms = percentile(durations, 0.95);
    const checkOk = validResponses && p95Ms <= P95_BUDGET_MS;
    ok &&= checkOk;
    results.push({
      step: check.step,
      samples: durations.length,
      p50Ms: rounded(p50Ms),
      p95Ms: rounded(p95Ms),
      minMs: rounded(Math.min(...durations)),
      maxMs: rounded(Math.max(...durations)),
      budgetP95Ms: P95_BUDGET_MS,
      responseContract,
      validResponses,
      ok: checkOk
    });
  }
} finally {
  await app?.close();
}

console.log(
  JSON.stringify(
    {
      result: ok ? "OK" : "FALHOU",
      mode: PUBLIC_BASE_URL ? "public-https" : "app-inject-with-supabase",
      target: PUBLIC_BASE_URL ? new URL(PUBLIC_BASE_URL).host : "local-app",
      warmupRuns: WARMUP_RUNS,
      sampleRuns: SAMPLE_RUNS,
      token: "REDACTED",
      piiLogged: false,
      destructive: false,
      results
    },
    null,
    2
  )
);
process.exit(ok ? 0 : 1);
