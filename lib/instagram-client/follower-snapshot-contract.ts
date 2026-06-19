export const FOLLOWER_SNAPSHOT_SOURCES = [
  "device_profile_read",
  "public_profile_lookup",
  "admin_manual_verified",
] as const;

export type FollowerSnapshotSource = (typeof FOLLOWER_SNAPSHOT_SOURCES)[number];

export const FOLLOWER_OBSERVATION_KINDS = [
  "baseline",
  "daily",
  "intraday",
] as const;

export type FollowerObservationKind = (typeof FOLLOWER_OBSERVATION_KINDS)[number];

export type FollowerSnapshotRow = {
  id?: string;
  account_id: string;
  followers_count: number;
  captured_at: string;
  source: string;
  observation_kind: string;
  created_at?: string;
};

export function isAllowedFollowerSnapshotSource(source: string): source is FollowerSnapshotSource {
  return (FOLLOWER_SNAPSHOT_SOURCES as readonly string[]).includes(source);
}

export function isAllowedFollowerObservationKind(kind: string): kind is FollowerObservationKind {
  return (FOLLOWER_OBSERVATION_KINDS as readonly string[]).includes(kind);
}

export function isReliableFollowerCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value);
}

export function validateFollowerSnapshotInput(input: {
  account_id: string;
  followers_count: unknown;
  captured_at: string;
  source: string;
  observation_kind: string;
}): { ok: true; row: FollowerSnapshotRow } | { ok: false; reason: string } {
  const accountId = String(input.account_id || "").trim();
  if (!accountId) return { ok: false, reason: "missing_account_id" };

  if (!isReliableFollowerCount(input.followers_count)) {
    return { ok: false, reason: "invalid_followers_count" };
  }

  const capturedAt = String(input.captured_at || "").trim();
  const capturedDate = new Date(capturedAt);
  if (!capturedAt || Number.isNaN(capturedDate.getTime())) {
    return { ok: false, reason: "invalid_captured_at" };
  }

  if (!isAllowedFollowerSnapshotSource(input.source)) {
    return { ok: false, reason: "disallowed_source" };
  }

  if (!isAllowedFollowerObservationKind(input.observation_kind)) {
    return { ok: false, reason: "disallowed_observation_kind" };
  }

  return {
    ok: true,
    row: {
      account_id: accountId,
      followers_count: input.followers_count,
      captured_at: capturedDate.toISOString(),
      source: input.source,
      observation_kind: input.observation_kind,
    },
  };
}
