import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRAYER_REQUESTS_RETENTION_DAYS,
  PRAYER_REQUESTS_RETENTION_CONFIRMATION,
  buildPrayerRequestsRetentionCutoff,
  runPrayerRequestsRetention,
  type PrayerRequestsRetentionClient
} from "../src/modules/privacy/prayerRequestsRetention.js";

function createClient(count: number, deletedIds: string[] = []) {
  const calls: string[] = [];
  const client: PrayerRequestsRetentionClient = {
    from(table) {
      calls.push(`from:${table}`);
      let deleteMode = false;
      const builder = {
        select(columns: string, options?: unknown) {
          calls.push(`select:${columns}:${options ? "count" : "return"}`);
          if (options) {
            return builder;
          }
          return Promise.resolve({ data: deletedIds.map((id) => ({ id })), error: null });
        },
        delete() {
          calls.push("delete");
          deleteMode = true;
          return builder;
        },
        lt(column: string, value: string) {
          calls.push(`lt:${column}:${value}`);
          if (deleteMode) {
            return builder;
          }
          return Promise.resolve({ count, error: null });
        }
      };
      return builder;
    }
  };
  return { client, calls };
}

describe("prayer requests retention", () => {
  it("builds a 90 day cutoff by default", () => {
    const cutoff = buildPrayerRequestsRetentionCutoff(new Date("2026-06-03T12:00:00.000Z"));
    expect(cutoff.toISOString()).toBe("2026-03-05T12:00:00.000Z");
  });

  it("counts old requests in dry-run without deleting", async () => {
    const { client, calls } = createClient(4);

    const result = await runPrayerRequestsRetention({
      client,
      mode: "dry-run",
      now: new Date("2026-06-03T12:00:00.000Z")
    });

    expect(result).toEqual({
      mode: "dry-run",
      retentionDays: DEFAULT_PRAYER_REQUESTS_RETENTION_DAYS,
      cutoffIso: "2026-03-05T12:00:00.000Z",
      matchedRequests: 4,
      deletedRequests: 0,
      applied: false
    });
    expect(calls).not.toContain("delete");
  });

  it("blocks apply without explicit confirmation", async () => {
    const { client } = createClient(1);

    await expect(
      runPrayerRequestsRetention({
        client,
        mode: "apply",
        now: new Date("2026-06-03T12:00:00.000Z")
      })
    ).rejects.toThrow("missing explicit confirmation");
  });

  it("deletes old requests when confirmation is explicit", async () => {
    const { client, calls } = createClient(2, ["request-1", "request-2"]);

    const result = await runPrayerRequestsRetention({
      client,
      mode: "apply",
      confirmation: PRAYER_REQUESTS_RETENTION_CONFIRMATION,
      now: new Date("2026-06-03T12:00:00.000Z")
    });

    expect(result.deletedRequests).toBe(2);
    expect(result.applied).toBe(true);
    expect(calls).toContain("delete");
  });

  it("rejects unsafe retention windows", async () => {
    const { client } = createClient(0);

    await expect(runPrayerRequestsRetention({ client, mode: "dry-run", retentionDays: 0 })).rejects.toThrow(
      "between 1 and 3650"
    );
  });
});
