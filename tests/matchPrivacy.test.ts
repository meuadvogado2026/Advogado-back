import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildApp } from "../src/app.js";
import { createMemoryRepositories } from "../src/repositories/memoryRepositories.js";
import { createSupabaseRepositories } from "../src/repositories/supabaseRepositories.js";

describe("match location minimization", () => {
  it("identifies the deployed privacy release without exposing secrets", async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: "GET", url: "/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "ok", release: "privacy-20261114" });
    } finally { await app.close(); }
  });
  it.each([true, false])("uses coordinates for calculation but not event persistence (matched=%s)", async (matched) => {
    const repos = createMemoryRepositories();
    const findNearest = vi.fn().mockResolvedValue(matched ? {
      lawyer: { id: "lawyer", name: "Professional", whatsapp: "11900000000", city: "SP", state: "SP", areaIds: ["civil"] },
      distanceKm: 1.234
    } : null);
    const record = vi.fn().mockResolvedValue(undefined);
    repos.matches.findNearest = findNearest;
    repos.matchEvents.record = record;
    const app = await buildApp(repos);
    try {
      const response = await app.inject({ method: "POST", url: "/v1/match", headers: { authorization: "Bearer test-client-token" }, payload: { lat: -23.55052, lng: -46.633308, accuracyM: 30, areaIds: ["civil"] } });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe(matched ? "matched" : "empty");
      expect(findNearest).toHaveBeenCalledWith(expect.objectContaining({ lat: -23.55052, lng: -46.633308 }));
      expect(record).toHaveBeenCalledOnce();
      const event = record.mock.calls[0]![0];
      for (const key of ["lat", "lng", "accuracyM", "distanceKm", "client_location"]) expect(event).not.toHaveProperty(key);
      expect(event).toMatchObject({ clientProfileId: "test-client-user", specialtyIds: ["civil"], algorithmVersion: "geo-nearest-v1" });
      if (matched) expect(response.json().distanceKm).toBe(1.234);
    } finally { await app.close(); }
  });

  it("does not write geographic data even if an untyped caller supplies it", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const repos = createSupabaseRepositories({ from } as unknown as SupabaseClient);
    await repos.matchEvents.record({ specialtyIds: [], algorithmVersion: "geo-nearest-v1", ...{ lat: -23, lng: -46, accuracyM: 30, distanceKm: 1.234 } });
    expect(from).toHaveBeenCalledWith("match_events");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ client_location: null, accuracy_m: null, distance_km: null }));
  });
});
