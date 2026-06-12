import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

/**
 * Smoke real nao-destrutivo das listas admin filtradas/paginadas.
 *
 * Objetivo: validar, apos deploy/migration, que os filtros server-side usados
 * pelo Admin respondem com persistencia Supabase e metadados de paginacao.
 *
 * Seguranca: nao imprime token, senha, emails retornados nem payloads sensiveis.
 */

const env = loadEnv();
if (!env.SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_ANON_KEY e obrigatoria para admin-filter:smoke (use a anon key publicavel).");
}

const ADMIN_EMAIL = "admin@advogado20.com";

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
  console.error(JSON.stringify({ result: "FALHOU", step: "login", message: error?.message ?? "sem sessao" }));
  process.exit(1);
}

const app = await buildApp();
const authHeader = { authorization: `Bearer ${data.session.access_token}` };
const checks = [
  { step: "GET /v1/admin/lawyers?status=draft", url: "/v1/admin/lawyers?page=1&pageSize=5&status=draft", key: "lawyers" },
  { step: "GET /v1/admin/lawyers?search=SP", url: "/v1/admin/lawyers?page=1&pageSize=5&search=SP", key: "lawyers" },
  { step: "GET /v1/admin/prayer-requests?status=received", url: "/v1/admin/prayer-requests?page=1&pageSize=5&status=received", key: "requests" },
  { step: "GET /v1/admin/users?search=admin", url: "/v1/admin/users?page=1&pageSize=5&search=admin", key: "users" },
  { step: "GET /v1/admin/partner-logos?page=1", url: "/v1/admin/partner-logos?page=1&pageSize=5", key: "partners" }
] as const;

const steps: Array<Record<string, unknown>> = [];
let ok = true;

for (const check of checks) {
  const response = await app.inject({ method: "GET", url: check.url, headers: authHeader });
  const body = response.json() as PaginatedBody;
  const items = body[check.key];
  const checkOk =
    response.statusCode === 200 &&
    body.persistence === "supabase" &&
    Boolean(body.pagination) &&
    Array.isArray(items) &&
    items.length <= 5;

  ok &&= checkOk;
  steps.push({
    step: check.step,
    statusCode: response.statusCode,
    expected: 200,
    persistence: body.persistence,
    pagination: body.pagination
      ? {
          page: body.pagination.page,
          pageSize: body.pagination.pageSize,
          total: body.pagination.total,
          totalPages: body.pagination.totalPages
        }
      : null,
    itemCount: Array.isArray(items) ? items.length : null,
    ok: checkOk
  });
}

await app.close();

const out = { result: ok ? "OK" : "FALHOU", admin: ADMIN_EMAIL, tokenLogado: "REDACTED", destructive: false, steps };
console.log(JSON.stringify(out, null, 2));
process.exit(ok ? 0 : 1);
