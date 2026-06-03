import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../src/config/env.js";
import {
  DEFAULT_PRAYER_REQUESTS_RETENTION_DAYS,
  PRAYER_REQUESTS_RETENTION_CONFIRMATION,
  runPrayerRequestsRetention,
  type PrayerRequestsRetentionMode
} from "../src/modules/privacy/prayerRequestsRetention.js";

const env = loadEnv();
const mode: PrayerRequestsRetentionMode = process.argv.includes("--apply") ? "apply" : "dry-run";
const retentionDays = Number(process.env.PRAYER_REQUESTS_RETENTION_DAYS ?? DEFAULT_PRAYER_REQUESTS_RETENTION_DAYS);

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY e obrigatoria para retention:prayer-requests.");
}

if (mode === "apply" && process.env.PRAYER_REQUESTS_RETENTION_CONFIRMATION !== PRAYER_REQUESTS_RETENTION_CONFIRMATION) {
  throw new Error(
    `Aplicacao bloqueada. Defina PRAYER_REQUESTS_RETENTION_CONFIRMATION=${PRAYER_REQUESTS_RETENTION_CONFIRMATION}.`
  );
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const result = await runPrayerRequestsRetention({
  client: supabase,
  mode,
  retentionDays,
  confirmation: process.env.PRAYER_REQUESTS_RETENTION_CONFIRMATION
});

console.log(
  JSON.stringify(
    {
      result: "OK",
      table: "prayer_requests",
      policy: "delete requests older than retentionDays",
      mode: result.mode,
      applied: result.applied,
      retentionDays: result.retentionDays,
      cutoffIso: result.cutoffIso,
      matchedRequests: result.matchedRequests,
      deletedRequests: result.deletedRequests,
      sensitiveFieldsLogged: false,
      gaps:
        mode === "dry-run"
          ? ["Dry-run nao altera dados. Use --apply com confirmacao explicita para executar expurgo real."]
          : []
    },
    null,
    2
  )
);
