import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH_EVENTS_RETENTION_DAYS,
  MATCH_EVENTS_RETENTION_CONFIRMATION,
  buildMatchEventsRetentionCutoff,
  runMatchEventsRetention,
  type MatchEventsRetentionClient
} from "../src/modules/privacy/matchEventsRetention.js";

function createClient(count: number, deletedIds: string[] = []) {
  const calls: string[] = [];
  const client: MatchEventsRetentionClient = {
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

describe("match events retention", () => {
  it("builds a 90 day cutoff by default", () => {
    const cutoff = buildMatchEventsRetentionCutoff(new Date("2026-06-02T12:00:00.000Z"));
    expect(cutoff.toISOString()).toBe("2026-03-04T12:00:00.000Z");
  });

  it("counts old events in dry-run without deleting", async () => {
    const { client, calls } = createClient(3);

    const result = await runMatchEventsRetention({
      client,
      mode: "dry-run",
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(result).toEqual({
      mode: "dry-run",
      retentionDays: DEFAULT_MATCH_EVENTS_RETENTION_DAYS,
      cutoffIso: "2026-03-04T12:00:00.000Z",
      matchedEvents: 3,
      deletedEvents: 0,
      applied: false
    });
    expect(calls).not.toContain("delete");
  });

  it("blocks apply without explicit confirmation", async () => {
    const { client } = createClient(1);

    await expect(
      runMatchEventsRetention({
        client,
        mode: "apply",
        now: new Date("2026-06-02T12:00:00.000Z")
      })
    ).rejects.toThrow("missing explicit confirmation");
  });

  it("deletes old events when confirmation is explicit", async () => {
    const { client, calls } = createClient(2, ["event-1", "event-2"]);

    const result = await runMatchEventsRetention({
      client,
      mode: "apply",
      confirmation: MATCH_EVENTS_RETENTION_CONFIRMATION,
      now: new Date("2026-06-02T12:00:00.000Z")
    });

    expect(result.deletedEvents).toBe(2);
    expect(result.applied).toBe(true);
    expect(calls).toContain("delete");
  });

  it("rejects unsafe retention windows", async () => {
    const { client } = createClient(0);

    await expect(runMatchEventsRetention({ client, mode: "dry-run", retentionDays: 0 })).rejects.toThrow(
      "between 1 and 3650"
    );
  });
});
