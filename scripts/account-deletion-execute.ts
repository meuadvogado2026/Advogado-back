import { loadEnv } from "../src/config/env.js";
import { createSupabaseAdminClient } from "../src/lib/supabase.js";

const profileId = process.argv.find((value) => value.startsWith("--profile-id="))?.slice("--profile-id=".length);
const apply = process.argv.includes("--apply");
const confirmation = process.env.ACCOUNT_DELETION_CONFIRMATION;
if (!profileId) throw new Error("Uso: npm run account-deletion -- --profile-id=<uuid> [--apply]");
if (apply && confirmation !== "APPLY_ACCOUNT_DELETION") throw new Error("Aplicacao bloqueada. Defina ACCOUNT_DELETION_CONFIRMATION=APPLY_ACCOUNT_DELETION.");

const supabase = createSupabaseAdminClient(loadEnv());
if (!supabase) throw new Error("SUPABASE_SERVICE_ROLE_KEY e obrigatoria.");
const profile = await supabase.from("profiles").select("id, role").eq("id", profileId).maybeSingle();
if (profile.error) throw profile.error;
if (!profile.data) throw new Error("Perfil nao encontrado.");
const lawyers = await supabase.from("lawyer_profiles").select("id").eq("profile_id", profileId);
if (lawyers.error) throw lawyers.error;
const lawyerIds = (lawyers.data ?? []).map((item) => item.id);
const [matches, prayers] = await Promise.all([
  supabase.from("match_events").select("id", { count: "exact", head: true }).eq("client_profile_id", profileId),
  supabase.from("prayer_requests").select("id", { count: "exact", head: true }).eq("client_profile_id", profileId)
]);
if (matches.error || prayers.error) throw matches.error ?? prayers.error;
const summary = { mode: apply ? "apply" : "dry-run", profileId, role: profile.data.role, matchEvents: matches.count ?? 0, prayerRequests: prayers.count ?? 0, lawyerProfiles: lawyerIds.length };
if (!apply) { console.log(JSON.stringify(summary)); process.exit(0); }

if (lawyerIds.length) {
  const lawyerMatches = await supabase.from("match_events").delete().in("lawyer_profile_id", lawyerIds);
  if (lawyerMatches.error) throw lawyerMatches.error;
}
for (const table of ["match_events", "prayer_requests"] as const) {
  const result = await supabase.from(table).delete().eq("client_profile_id", profileId);
  if (result.error) throw result.error;
}
const audit = await supabase.from("audit_logs").update({ actor_profile_id: null }).eq("actor_profile_id", profileId);
if (audit.error) throw audit.error;
const publicProfile = await supabase.from("profiles").delete().eq("id", profileId);
if (publicProfile.error) throw publicProfile.error;
const auth = await supabase.auth.admin.deleteUser(profileId);
if (auth.error) throw auth.error;
console.log(JSON.stringify({ ...summary, deleted: true }));
