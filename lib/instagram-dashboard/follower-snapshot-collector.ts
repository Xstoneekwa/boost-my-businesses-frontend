import { lookupInstagramPublicProfile } from "../instagram-public-profile-lookup";
import { createSupabaseClient } from "../supabase";
import {
  validateFollowerSnapshotInput,
  type FollowerObservationKind,
  type FollowerSnapshotRow,
  type FollowerSnapshotSource,
} from "../instagram-client/follower-snapshot-contract";
import { readString } from "../instagram-client/guards";

type SupabaseRecord = Record<string, unknown>;

export const FOLLOWER_COLLECTOR_PRIMARY_SOURCE: FollowerSnapshotSource = "device_profile_read";
export const FOLLOWER_COLLECTOR_FALLBACK_SOURCE: FollowerSnapshotSource = "public_profile_lookup";

export const FOLLOWER_COLLECTION_CADENCE = {
  baseline: "On first successful read for any active platform account.",
  daily: "One snapshot per business day per active account (feeds All + 30 days).",
  intraday: "Up to every 4 hours in business timezone (feeds Daily); disabled until budget validation.",
} as const;

export type FollowerCollectionAttemptResult =
  | { ok: true; followersCount: number; source: FollowerSnapshotSource; capturedAt: string }
  | { ok: false; reason: string; sourceAttempted: FollowerSnapshotSource | "none" };

export type FollowerSnapshotInsertResult =
  | { ok: true; row: FollowerSnapshotRow }
  | { ok: false; reason: string };

function readActiveAccountStatuses(row: SupabaseRecord) {
  const lifecycle = readString(row.admin_lifecycle_status, readString(row.status, "")).toLowerCase();
  return lifecycle === "active";
}

export async function listActivePlatformInstagramAccountIds(): Promise<string[]> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_accounts")
    .select("id,status,admin_lifecycle_status")
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) throw new Error(error.message);

  return (Array.isArray(data) ? data as SupabaseRecord[] : [])
    .filter(readActiveAccountStatuses)
    .map((row) => readString(row.id))
    .filter(Boolean);
}

export async function readPlatformAccountUsername(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_accounts")
    .select("username")
    .eq("id", accountId)
    .maybeSingle();
  if (error || !data) return null;
  return readString(data.username, "") || null;
}

/**
 * Device profile read is the preferred source when a live session exists.
 * This step does not invoke devices — callers supply device reads from worker/runtime.
 */
export function normalizeDeviceProfileReadObservation(input: {
  accountId: string;
  followersCount: unknown;
  capturedAt?: string;
}): FollowerCollectionAttemptResult {
  if (input.followersCount === null || input.followersCount === undefined) {
    return { ok: false, reason: "device_followers_missing", sourceAttempted: FOLLOWER_COLLECTOR_PRIMARY_SOURCE };
  }
  const followersCount = Number(input.followersCount);
  if (!Number.isFinite(followersCount) || followersCount < 0 || !Number.isInteger(followersCount)) {
    return { ok: false, reason: "device_followers_invalid", sourceAttempted: FOLLOWER_COLLECTOR_PRIMARY_SOURCE };
  }
  return {
    ok: true,
    followersCount,
    source: FOLLOWER_COLLECTOR_PRIMARY_SOURCE,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
  };
}

export async function collectFollowerObservationViaPublicLookup(username: string): Promise<FollowerCollectionAttemptResult> {
  const lookup = await lookupInstagramPublicProfile(username);
  if (lookup.status !== "found") {
    return {
      ok: false,
      reason: lookup.reason || lookup.status,
      sourceAttempted: FOLLOWER_COLLECTOR_FALLBACK_SOURCE,
    };
  }
  if (lookup.followers_count === null || !Number.isFinite(lookup.followers_count)) {
    return { ok: false, reason: "public_lookup_followers_missing", sourceAttempted: FOLLOWER_COLLECTOR_FALLBACK_SOURCE };
  }
  return {
    ok: true,
    followersCount: lookup.followers_count,
    source: FOLLOWER_COLLECTOR_FALLBACK_SOURCE,
    capturedAt: lookup.checked_at,
  };
}

export async function insertFollowerSnapshot(input: {
  accountId: string;
  followersCount: number;
  capturedAt: string;
  source: FollowerSnapshotSource;
  observationKind: FollowerObservationKind;
  mirrorToIgAccounts?: boolean;
}): Promise<FollowerSnapshotInsertResult> {
  const validated = validateFollowerSnapshotInput({
    account_id: input.accountId,
    followers_count: input.followersCount,
    captured_at: input.capturedAt,
    source: input.source,
    observation_kind: input.observationKind,
  });
  if (!validated.ok) return validated;

  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_account_follower_snapshots")
    .insert(validated.row)
    .select("id,account_id,followers_count,captured_at,source,observation_kind,created_at")
    .maybeSingle();

  if (error) {
    return { ok: false, reason: error.message };
  }

  if (input.mirrorToIgAccounts) {
    await supabase
      .from("ig_accounts")
      .update({ followers_count: validated.row.followers_count })
      .eq("id", input.accountId);
  }

  return { ok: true, row: data as FollowerSnapshotRow };
}

export function describeFollowerCollectorPlan() {
  return {
    platformScope: "All active ig_accounts regardless of client_instagram_accounts linkage.",
    primarySource: FOLLOWER_COLLECTOR_PRIMARY_SOURCE,
    fallbackSource: FOLLOWER_COLLECTOR_FALLBACK_SOURCE,
    cadence: FOLLOWER_COLLECTION_CADENCE,
    intradayEnabled: false,
    notes: [
      "Never derive follower counts from bot interactions.",
      "Skip insert when observation is missing or unreliable.",
      "Internal logs may capture failure reasons; client UI stays generic.",
    ],
  };
}
