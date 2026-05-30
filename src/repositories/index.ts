import type { AppEnv } from "../config/env.js";
import { createSupabaseAdminClient } from "../lib/supabase.js";
import { createMemoryRepositories } from "./memoryRepositories.js";
import { createSupabaseRepositories } from "./supabaseRepositories.js";
import type { Repositories } from "./types.js";

export function createRepositories(env: AppEnv): Repositories {
  if (env.NODE_ENV === "test") {
    return createMemoryRepositories();
  }

  const supabase = createSupabaseAdminClient(env);
  if (!supabase) {
    return createMemoryRepositories();
  }

  return createSupabaseRepositories(supabase);
}
