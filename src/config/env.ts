import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const REQUIRED_CORS_ORIGINS = ["https://advogado20admin.vercel.app"];

const workspaceEnvPath = resolve(process.cwd(), "..", ".env");
const localEnvPath = resolve(process.cwd(), ".env");

if (existsSync(workspaceEnvPath)) {
  config({ path: workspaceEnvPath });
}
config({ path: localEnvPath, override: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3333),
  API_BASE_PATH: z.string().default("/v1"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173,http://localhost:8081,https://advogado20admin.vercel.app"),
  SUPABASE_URL: z.string().url().default("https://qpemxkiowiiklztgumqy.supabase.co"),
  SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_DB_URL: z.string().optional(),
  TEST_AUTH_ADMIN_TOKEN: z.string().default("test-admin-token"),
  TEST_AUTH_CLIENT_TOKEN: z.string().default("test-client-token"),
  TEST_AUTH_LAWYER_TOKEN: z.string().default("test-lawyer-token"),
  APPLY_REMOTE_MIGRATIONS: z.enum(["true", "false"]).default("false"),
  MIGRATION_CONFIRMATION: z.string().optional(),
  GEOCODING_PROVIDER: z.enum(["nominatim", "stub"]).default("stub"),
  NOMINATIM_BASE_URL: z.string().url().default("https://nominatim.openstreetmap.org"),
  BRASILAPI_BASE_URL: z.string().url().default("https://brasilapi.com.br/api"),
  MATCH_MAX_RADIUS_KM: z.coerce.number().positive().default(200)
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source = process.env): AppEnv {
  return envSchema.parse(source);
}

export function resolveCorsOrigins(corsOrigins: string): string[] {
  return Array.from(
    new Set([
      ...corsOrigins
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      ...REQUIRED_CORS_ORIGINS
    ])
  );
}
