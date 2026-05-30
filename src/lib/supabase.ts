import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppEnv } from "../config/env.js";

export function hasUsableServiceRoleKey(env: AppEnv) {
  return Boolean(env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_SERVICE_ROLE_KEY !== "replace-with-railway-secret");
}

export function createSupabaseAdminClient(env: AppEnv): SupabaseClient | null {
  if (!hasUsableServiceRoleKey(env)) {
    return null;
  }

  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
