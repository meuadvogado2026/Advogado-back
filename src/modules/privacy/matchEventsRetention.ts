export const DEFAULT_MATCH_EVENTS_RETENTION_DAYS = 90;
export const MATCH_EVENTS_RETENTION_CONFIRMATION = "APPLY_MATCH_EVENTS_RETENTION";

export type MatchEventsRetentionClient = {
  from(table: "match_events"): any;
};

export type MatchEventsRetentionMode = "dry-run" | "apply";

export type MatchEventsRetentionInput = {
  client: MatchEventsRetentionClient;
  retentionDays?: number;
  now?: Date;
  mode: MatchEventsRetentionMode;
  confirmation?: string;
};

export type MatchEventsRetentionResult = {
  mode: MatchEventsRetentionMode;
  retentionDays: number;
  cutoffIso: string;
  matchedEvents: number;
  deletedEvents: number;
  applied: boolean;
};

function normalizeRetentionDays(value: number | undefined): number {
  const days = value ?? DEFAULT_MATCH_EVENTS_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("match_events retention days must be an integer between 1 and 3650.");
  }
  return days;
}

export function buildMatchEventsRetentionCutoff(now: Date, retentionDays = DEFAULT_MATCH_EVENTS_RETENTION_DAYS): Date {
  const days = normalizeRetentionDays(retentionDays);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function runMatchEventsRetention(input: MatchEventsRetentionInput): Promise<MatchEventsRetentionResult> {
  const retentionDays = normalizeRetentionDays(input.retentionDays);
  const cutoffIso = buildMatchEventsRetentionCutoff(input.now ?? new Date(), retentionDays).toISOString();

  const countResult = await input.client
    .from("match_events")
    .select("id", { count: "exact", head: true })
    .lt("created_at", cutoffIso);
  if (countResult.error) {
    throw new Error(`match_events.retention.count: ${countResult.error.message}`);
  }

  const matchedEvents = countResult.count ?? 0;

  if (input.mode === "dry-run") {
    return {
      mode: input.mode,
      retentionDays,
      cutoffIso,
      matchedEvents,
      deletedEvents: 0,
      applied: false
    };
  }

  if (input.confirmation !== MATCH_EVENTS_RETENTION_CONFIRMATION) {
    throw new Error("match_events retention apply blocked: missing explicit confirmation.");
  }

  const deleteResult = await input.client
    .from("match_events")
    .delete()
    .lt("created_at", cutoffIso)
    .select("id");
  if (deleteResult.error) {
    throw new Error(`match_events.retention.delete: ${deleteResult.error.message}`);
  }

  return {
    mode: input.mode,
    retentionDays,
    cutoffIso,
    matchedEvents,
    deletedEvents: deleteResult.data?.length ?? 0,
    applied: true
  };
}
