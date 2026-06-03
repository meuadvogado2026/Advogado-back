export const DEFAULT_PRAYER_REQUESTS_RETENTION_DAYS = 90;
export const PRAYER_REQUESTS_RETENTION_CONFIRMATION = "APPLY_PRAYER_REQUESTS_RETENTION";

export type PrayerRequestsRetentionClient = {
  from(table: "prayer_requests"): any;
};

export type PrayerRequestsRetentionMode = "dry-run" | "apply";

export type PrayerRequestsRetentionInput = {
  client: PrayerRequestsRetentionClient;
  retentionDays?: number;
  now?: Date;
  mode: PrayerRequestsRetentionMode;
  confirmation?: string;
};

export type PrayerRequestsRetentionResult = {
  mode: PrayerRequestsRetentionMode;
  retentionDays: number;
  cutoffIso: string;
  matchedRequests: number;
  deletedRequests: number;
  applied: boolean;
};

function normalizeRetentionDays(value: number | undefined): number {
  const days = value ?? DEFAULT_PRAYER_REQUESTS_RETENTION_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new Error("prayer_requests retention days must be an integer between 1 and 3650.");
  }
  return days;
}

export function buildPrayerRequestsRetentionCutoff(now: Date, retentionDays = DEFAULT_PRAYER_REQUESTS_RETENTION_DAYS): Date {
  const days = normalizeRetentionDays(retentionDays);
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export async function runPrayerRequestsRetention(input: PrayerRequestsRetentionInput): Promise<PrayerRequestsRetentionResult> {
  const retentionDays = normalizeRetentionDays(input.retentionDays);
  const cutoffIso = buildPrayerRequestsRetentionCutoff(input.now ?? new Date(), retentionDays).toISOString();

  const countResult = await input.client
    .from("prayer_requests")
    .select("id", { count: "exact", head: true })
    .lt("created_at", cutoffIso);
  if (countResult.error) {
    throw new Error(`prayer_requests.retention.count: ${countResult.error.message}`);
  }

  const matchedRequests = countResult.count ?? 0;

  if (input.mode === "dry-run") {
    return {
      mode: input.mode,
      retentionDays,
      cutoffIso,
      matchedRequests,
      deletedRequests: 0,
      applied: false
    };
  }

  if (input.confirmation !== PRAYER_REQUESTS_RETENTION_CONFIRMATION) {
    throw new Error("prayer_requests retention apply blocked: missing explicit confirmation.");
  }

  const deleteResult = await input.client
    .from("prayer_requests")
    .delete()
    .lt("created_at", cutoffIso)
    .select("id");
  if (deleteResult.error) {
    throw new Error(`prayer_requests.retention.delete: ${deleteResult.error.message}`);
  }

  return {
    mode: input.mode,
    retentionDays,
    cutoffIso,
    matchedRequests,
    deletedRequests: deleteResult.data?.length ?? 0,
    applied: true
  };
}
