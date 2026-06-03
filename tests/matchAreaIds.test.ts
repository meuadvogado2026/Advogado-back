import { describe, expect, it } from "vitest";
import { isSupabaseAreaId } from "../src/modules/match/routes.js";

describe("match area id validation", () => {
  it("keeps Supabase match area ids constrained to UUID values", () => {
    expect(isSupabaseAreaId("civil")).toBe(false);
    expect(isSupabaseAreaId("00000000-0000-4000-8000-000000000000")).toBe(true);
  });
});
