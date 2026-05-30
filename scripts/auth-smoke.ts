import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildApp } from "../src/app.js";
import { loadEnv } from "../src/config/env.js";

type Credential = {
  email: string;
  password: string;
};

function parseCredentials(raw: string): Credential[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const credentials: Credential[] = [];
  for (let index = 0; index < lines.length; index += 2) {
    const email = lines[index];
    const password = lines[index + 1];
    if (!email || !password || !email.includes("@")) {
      throw new Error("Arquivo de credenciais deve alternar linhas email/senha.");
    }
    credentials.push({ email, password });
  }

  return credentials;
}

const env = loadEnv();
if (!env.SUPABASE_ANON_KEY) {
  throw new Error("SUPABASE_ANON_KEY e obrigatoria para auth:smoke.");
}

const credentialsPath = resolve(process.cwd(), "..", "Credenciais para testes.txt");
const credentials = parseCredentials(await readFile(credentialsPath, "utf8"));
const authClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
const app = await buildApp();

const results = [];
for (const credential of credentials) {
  const { data, error } = await authClient.auth.signInWithPassword(credential);
  if (error || !data.session?.access_token) {
    results.push({ email: credential.email, login: "FALHOU", statusCode: null });
    continue;
  }

  const response = await app.inject({
    method: "GET",
    url: "/v1/admin/lawyers",
    headers: {
      authorization: `Bearer ${data.session.access_token}`
    }
  });

  results.push({ email: credential.email, login: "OK", statusCode: response.statusCode });
}

await app.close();

const admin = results.find((result) => result.email === "admin@advogado20.com");
const lawyer = results.find((result) => result.email === "advogado@advogado20.com");
const client = results.find((result) => result.email === "usuario@advogado20.com");

if (admin?.statusCode !== 200 || lawyer?.statusCode !== 403 || client?.statusCode !== 403) {
  console.error(JSON.stringify({ result: "FALHOU", results }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ result: "OK", results }, null, 2));
