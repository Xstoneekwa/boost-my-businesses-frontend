import { createHash } from "node:crypto";
import { lookupInstagramPublicProfile } from "../instagram-public-profile-lookup.ts";
import { createSupabaseClient } from "../supabase.ts";
import {
  validateFollowerSnapshotInput,
  type FollowerObservationKind,
  type FollowerSnapshotRow,
  type FollowerSnapshotSource,
} from "../instagram-client/follower-snapshot-contract.ts";
import { readString } from "../instagram-client/guards.ts";

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
  | { ok: true; row: FollowerSnapshotRow; created: boolean }
  | { ok: false; reason: string };

function businessDayKey(value: string, timeZone = "Africa/Johannesburg") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

function stableUuid(seed: string) {
  const chars = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function followerSnapshotId(accountId: string, capturedAt: string) {
  return stableUuid(`account-follower-snapshot:${accountId}:${businessDayKey(capturedAt)}`);
}

function readActiveAccountStatuses(row: SupabaseRecord) {
  const lifecycle = readString(row.admin_lifecycle_status, readString(row.status, "")).toLowerCase();
  return lifecycle === "active";
}

export type ActivePlatformInstagramAccount = { id: string; username: string };

export async function listActivePlatformInstagramAccounts(): Promise<ActivePlatformInstagramAccount[]> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_accounts")
    .select("id,username,status,admin_lifecycle_status")
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) throw new Error(error.message);

  return (Array.isArray(data) ? data as SupabaseRecord[] : [])
    .filter(readActiveAccountStatuses)
    .map((row) => ({ id: readString(row.id), username: readString(row.username) }))
    .filter((row) => row.id && row.username);
}

export async function listActivePlatformInstagramAccountIds(): Promise<string[]> {
  return (await listActivePlatformInstagramAccounts()).map((row) => row.id);
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
  const row = {
    id: followerSnapshotId(input.accountId, input.capturedAt),
    ...validated.row,
  };
  const { data, error } = await supabase
    .from("ig_account_follower_snapshots")
    .upsert(row, { onConflict: "id", ignoreDuplicates: true })
    .select("id,account_id,followers_count,captured_at,source,observation_kind,created_at")
    .maybeSingle();

  if (error) {
    return { ok: false, reason: error.message };
  }

  let persisted = data as FollowerSnapshotRow | null;
  let created = Boolean(persisted);
  if (!persisted) {
    const existing = await supabase
      .from("ig_account_follower_snapshots")
      .select("id,account_id,followers_count,captured_at,source,observation_kind,created_at")
      .eq("id", row.id)
      .maybeSingle();
    if (existing.error || !existing.data) {
      return { ok: false, reason: existing.error?.message || "snapshot_idempotency_read_failed" };
    }
    persisted = existing.data as FollowerSnapshotRow;
    created = false;
  }

  if (input.mirrorToIgAccounts) {
    await supabase
      .from("ig_accounts")
      .update({ followers_count: persisted.followers_count })
      .eq("id", input.accountId);
  }

  return { ok: true, row: persisted, created };
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
