import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AdminDashboardRepository, AdminOperationSnapshot } from "./types.js";

const profileSchema = z.object({ id: z.string(), role: z.enum(["admin", "client", "lawyer"]), blocked_at: z.string().nullable(), created_at: z.string().nullable() });
const lawyerSchema = z.object({ id: z.string(), profile_id: z.string(), status: z.enum(["draft", "pending_review", "approved", "rejected", "suspended"]), service_city_id: z.string().nullable(), available_for_matches: z.boolean(), office_location: z.unknown(), office_geocode_confidence: z.string().nullable(), office_geocode_precision: z.string().nullable() });
const citySchema = z.object({ id: z.string(), state_id: z.string(), name: z.string(), active: z.boolean() });
const stateSchema = z.object({ id: z.string(), code: z.string(), name: z.string(), active: z.boolean() });

// Advance by rows actually returned, including when the server caps pages below 500.
export async function readDashboardRows<T>(supabase: SupabaseClient, table: string, columns: string, schema: z.ZodType<T>): Promise<T[]> {
  const rows: T[] = [];
  while (true) {
    const { data, error, count } = await supabase.from(table).select(columns, { count: "exact" }).order("id").range(rows.length, rows.length + 499);
    if (error || count === null) throw new Error(`dashboard snapshot unavailable: ${table}`);
    const page = schema.array().parse(data ?? []);
    rows.push(...page);
    if (rows.length >= count) return rows;
    if (!page.length) throw new Error(`dashboard snapshot incomplete: ${table}`);
  }
}

export async function countDashboardRows(supabase: SupabaseClient, table: string, field: string, value: string | boolean): Promise<number> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true }).eq(field, value);
  if (error || typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) throw new Error(`dashboard count unavailable: ${table}`);
  return count;
}

export async function readOperationCounts(supabase: SupabaseClient): Promise<AdminOperationSnapshot> {
  const [pending, read, partnersActive, partnersInactive, benefitsActive, benefitsInactive] = await Promise.all([
    countDashboardRows(supabase, "prayer_requests", "status", "received"),
    countDashboardRows(supabase, "prayer_requests", "status", "read"),
    countDashboardRows(supabase, "partner_logos", "active", true),
    countDashboardRows(supabase, "partner_logos", "active", false),
    countDashboardRows(supabase, "benefits", "active", true),
    countDashboardRows(supabase, "benefits", "active", false)
  ]);
  return { prayers: { pending, read }, partners: { active: partnersActive, inactive: partnersInactive }, benefits: { active: benefitsActive, inactive: benefitsInactive } };
}

export function createSupabaseDashboardRepository(supabase: SupabaseClient): AdminDashboardRepository {
  return { async snapshot() {
    const [profiles, lawyers, cities, states, operations] = await Promise.all([
      readDashboardRows(supabase, "profiles", "id,role,blocked_at,created_at", profileSchema),
      readDashboardRows(supabase, "lawyer_profiles", "id,profile_id,status,service_city_id,available_for_matches,office_location,office_geocode_confidence,office_geocode_precision", lawyerSchema),
      readDashboardRows(supabase, "cities", "id,state_id,name,active", citySchema),
      readDashboardRows(supabase, "states", "id,code,name,active", stateSchema),
      readOperationCounts(supabase)
    ]);
    return {
      operations,
      profiles: profiles.map(p => ({ id: p.id, role: p.role, blockedAt: p.blocked_at, createdAt: p.created_at })),
      lawyers: lawyers.map(l => ({ id: l.id, profileId: l.profile_id, status: l.status, serviceCityId: l.service_city_id, availableForMatches: l.available_for_matches, hasOfficeLocation: l.office_location != null, confidence: l.office_geocode_confidence, precision: l.office_geocode_precision })),
      cities: cities.map(c => ({ id: c.id, stateId: c.state_id, name: c.name, active: c.active })), states
    };
  } };
}
