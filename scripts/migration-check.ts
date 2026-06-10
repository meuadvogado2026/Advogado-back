import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { loadEnv } from "../src/config/env.js";

const migrationsDir = "src/db/migrations";
const seedsDir = "src/db/seeds";

// Padroes obrigatorios por migration. Migrations sem entrada aqui caem no
// fallback generico (apenas exige conteudo SQL nao vazio).
const requiredByMigration: Record<string, RegExp[]> = {
  "0001_foundation_postgis.sql": [
    /create extension if not exists postgis/i,
    /do\s+\$\$[\s\S]+create type public\.profile_role/i,
    /create table if not exists public\.profiles/i,
    /create table if not exists public\.lawyer_profiles/i,
    /geography\(Point,\s*4326\)/i,
    /insert into public\.legal_specialties/i
  ],
  "0002_match_nearest.sql": [
    /create or replace function public\.match_nearest_lawyer/i,
    /st_distance/i,
    /st_setsrid\(st_makepoint/i,
    /lp\.status\s*=\s*'approved'/i
  ],
  "0010_add_empresarial_tributario_specialties.sql": [
    /insert into public\.legal_specialties/i,
    /'empresarial',\s*'Direito Empresarial'/i,
    /'tributario',\s*'Direito Tributário'/i,
    /on conflict \(slug\) do update/i
  ]
};

// Padroes proibidos aplicados a TODAS as migrations (operacoes destrutivas).
const forbiddenPatterns = [
  /\bdrop\s+table\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\bdrop\s+schema\b/i
];

const applyRequested = process.argv.includes("--apply");
const env = loadEnv();

async function listSqlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries.filter((name) => name.endsWith(".sql")).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

const migrationFiles = await listSqlFiles(migrationsDir);
const seedFiles = await listSqlFiles(seedsDir);

if (migrationFiles.length === 0) {
  console.error(
    JSON.stringify({ migrationsDir, result: "FALHOU", reason: "Nenhuma migration .sql encontrada." }, null, 2)
  );
  process.exit(1);
}

type MigrationCheck = {
  file: string;
  path: string;
  missingRequiredChecks: number;
  forbiddenChecks: number;
  hasExplicitRules: boolean;
  ok: boolean;
};

const checks: MigrationCheck[] = [];

for (const file of migrationFiles) {
  const path = `${migrationsDir}/${file}`;
  const sql = await readFile(path, "utf8");
  const required = requiredByMigration[file];
  const hasExplicitRules = Array.isArray(required);

  const missing = hasExplicitRules ? required.filter((pattern) => !pattern.test(sql)) : [];
  const forbidden = forbiddenPatterns.filter((pattern) => pattern.test(sql));
  // Fallback generico: migration sem regras explicitas precisa ter SQL real.
  const emptyFallback = !hasExplicitRules && sql.trim().length === 0;

  checks.push({
    file,
    path,
    missingRequiredChecks: missing.length,
    forbiddenChecks: forbidden.length,
    hasExplicitRules,
    ok: missing.length === 0 && forbidden.length === 0 && !emptyFallback
  });
}

const failed = checks.filter((check) => !check.ok);

if (failed.length > 0) {
  console.error(
    JSON.stringify(
      {
        migrationsDir,
        result: "FALHOU",
        failedMigrations: failed.map((check) => ({
          file: check.file,
          missingRequiredChecks: check.missingRequiredChecks,
          forbiddenChecks: check.forbiddenChecks
        }))
      },
      null,
      2
    )
  );
  process.exit(1);
}

if (!applyRequested || env.APPLY_REMOTE_MIGRATIONS !== "true") {
  console.log(
    JSON.stringify(
      {
        migrationsDir,
        objective: "Validar migrations sem aplicar remotamente.",
        exitCode: 0,
        result: "OK_DRY_RUN_STATIC",
        appliedRemote: false,
        migrations: checks.map((check) => ({
          file: check.file,
          validatedWith: check.hasExplicitRules ? "regras-especificas" : "fallback-generico"
        })),
        seeds: seedFiles.map((file) => `${seedsDir}/${file}`),
        gaps: [
          "Seeds nao sao aplicados automaticamente; rodar manualmente no Supabase SQL Editor (ex.: 001_match_fixtures.sql).",
          "Aplicacao remota exige npm run migration:apply, APPLY_REMOTE_MIGRATIONS=true, SUPABASE_DB_URL e MIGRATION_CONFIRMATION=APPLY_ADVOGADO_20_FOUNDATION."
        ]
      },
      null,
      2
    )
  );
  process.exit(0);
}

if (!env.SUPABASE_DB_URL || env.MIGRATION_CONFIRMATION !== "APPLY_ADVOGADO_20_FOUNDATION") {
  console.error("Aplicacao remota bloqueada: faltam SUPABASE_DB_URL ou confirmacao textual exata.");
  process.exit(1);
}

for (const check of checks) {
  const result = spawnSync("psql", [env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-f", check.path], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: true
  });

  if (result.status !== 0) {
    console.error(`Falha ao aplicar ${check.path}:\n${result.stdout}\n${result.stderr}`.trim());
    process.exit(result.status ?? 1);
  }

  console.log(`Migration aplicada remotamente via psql com confirmacao explicita: ${check.path}`);
}

console.log(`Todas as ${checks.length} migrations foram aplicadas remotamente em ordem.`);
