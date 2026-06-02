import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../src/config/env.js";
import {
  DEFAULT_MATCH_EVENTS_RETENTION_DAYS,
  MATCH_EVENTS_RETENTION_CONFIRMATION,
  runMatchEventsRetention,
  type MatchEventsRetentionMode
} from "../src/modules/privacy/matchEventsRetention.js";

const env = loadEnv();
const mode: MatchEventsRetentionMode = process.argv.includes("--apply") ? "apply" : "dry-run";
const retentionDays = Number(process.env.MATCH_EVENTS_RETENTION_DAYS ?? DEFAULT_MATCH_EVENTS_RETENTION_DAYS);

if (!env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY e obrigatoria para retention:match-events.");
}

if (mode === "apply" && process.env.MATCH_EVENTS_RETENTION_CONFIRMATION !== MATCH_EVENTS_RETENTION_CONFIRMATION) {
  throw new Error(
    `Aplicacao bloqueada. Defina MATCH_EVENTS_RETENTION_CONFIRMATION=${MATCH_EVENTS_RETENTION_CONFIRMATION}.`
  );
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const result = await runMatchEventsRetention({
  client: supabase,
  mode,
  retentionDays,
  confirmation: process.env.MATCH_EVENTS_RETENTION_CONFIRMATION
});

console.log(
  JSON.stringify(
    {
      result: "OK",
      table: "match_events",
      policy: "delete events older than retentionDays",
      mode: result.mode,
      applied: result.applied,
      retentionDays: result.retentionDays,
      cutoffIso: result.cutoffIso,
      matchedEvents: result.matchedEvents,
      deletedEvents: result.deletedEvents,
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
