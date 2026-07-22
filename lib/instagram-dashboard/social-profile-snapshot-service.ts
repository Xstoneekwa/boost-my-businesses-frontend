import { lookupInstagramPublicProfile, type InstagramPublicProfileLookupResult } from "../instagram-public-profile-lookup.ts";
import { createSupabaseClient } from "../supabase.ts";
import { readString } from "../instagram-client/guards.ts";
import {
  buildSocialProfileSnapshot,
  planSocialProfileScheduledTrigger,
  resolveSocialProfileTimezone,
  socialProfileSnapshotIdempotencyKey,
  type SocialProfileSnapshotRow,
  type SocialProfileSnapshotTrigger,
} from "./social-profile-snapshot-contract.ts";

type SupabaseRecord = Record<string, unknown>;
type Supabase = ReturnType<typeof createSupabaseClient>;

export const SOCIAL_PROFILE_SNAPSHOT_DAILY_BUDGET = 10;
export const SOCIAL_PROFILE_SNAPSHOT_MAX_ATTEMPTS = 3;

export type SocialProfileSnapshotJobProcessResult = {
  accountId: string;
  username: string;
  jobId: string;
  status: "succeeded" | "failed_retryable" | "failed_terminal";
  lookupStatus: string;
  snapshotCreated: boolean;
  followers: number | null;
  followings: number | null;
  posts: number | null;
  observedAt: string | null;
};

function lookupProvider(lookup: InstagramPublicProfileLookupResult) {
  const provider = readString(lookup.metadata.provider_mode, "searchapi");
  return provider === "http" ? "http" : "searchapi";
}

export async function resolveAccountSnapshotTimezone(
  supabase: Supabase,
  accountId: string,
) {
  const assignment = await supabase
    .from("account_assignments")
    .select("device_id")
    .eq("account_id", accountId)
    .in("status", ["pending", "reserved", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  const deviceId = readString(assignment.data?.device_id, "");
  const device = deviceId
    ? await supabase.from("phone_devices").select("timezone").eq("id", deviceId).maybeSingle<SupabaseRecord>()
    : { data: null };
  return resolveSocialProfileTimezone({ deviceTimezone: readString(device.data?.timezone, "") });
}

export async function persistSocialProfileLookup(input: {
  accountId: string;
  username: string;
  lookup: InstagramPublicProfileLookupResult;
  trigger: SocialProfileSnapshotTrigger;
  sourceEventId?: string | null;
  sourceRunId?: string | null;
  sourceBusinessSessionId?: string | null;
  supabase?: Supabase;
}) {
  if (input.lookup.status !== "found") return { ok: false as const, reason: input.lookup.reason || input.lookup.status };
  return persistSocialProfileObservation({
    accountId: input.accountId,
    username: input.lookup.canonical_username || input.username,
    followersCount: input.lookup.followers_count,
    followingCount: input.lookup.following_count ?? null,
    postsCount: input.lookup.posts_count ?? null,
    observedAt: input.lookup.checked_at,
    lookupStatus: input.lookup.status,
    provider: lookupProvider(input.lookup),
    trigger: input.trigger,
    sourceEventId: input.sourceEventId,
    sourceRunId: input.sourceRunId,
    sourceBusinessSessionId: input.sourceBusinessSessionId,
    supabase: input.supabase,
  });
}

export async function persistSocialProfileObservation(input: {
  accountId: string;
  username: string;
  followersCount: number | null;
  followingCount: number | null;
  postsCount: number | null;
  observedAt: string;
  lookupStatus: string;
  provider: string;
  trigger: SocialProfileSnapshotTrigger;
  sourceEventId?: string | null;
  sourceRunId?: string | null;
  sourceBusinessSessionId?: string | null;
  supabase?: Supabase;
}) {
  const supabase = input.supabase ?? createSupabaseClient();
  const resolved = await resolveAccountSnapshotTimezone(supabase, input.accountId);
  const row = buildSocialProfileSnapshot({
    accountId: input.accountId,
    username: input.username,
    observation: {
      followers_count: input.followersCount,
      following_count: input.followingCount,
      posts_count: input.postsCount,
      observed_at: input.observedAt,
      lookup_status: input.lookupStatus,
    },
    provider: input.provider,
    trigger: input.trigger,
    deviceTimezone: resolved.source === "device_assignment" ? resolved.timezone : null,
    scheduleTimezone: resolved.source === "schedule" ? resolved.timezone : null,
    sourceEventId: input.sourceEventId,
    sourceRunId: input.sourceRunId,
    sourceBusinessSessionId: input.sourceBusinessSessionId,
  });
  if (!row) return { ok: false as const, reason: "snapshot_has_no_reliable_metric" };
  const { data, error } = await supabase
    .from("ig_account_social_profile_snapshots")
    .upsert(row, { onConflict: "account_id,idempotency_key", ignoreDuplicates: true })
    .select("*")
    .maybeSingle<SocialProfileSnapshotRow>();
  if (error) return { ok: false as const, reason: error.message };
  if (data) return { ok: true as const, created: true, row: data };
  const existing = await supabase
    .from("ig_account_social_profile_snapshots")
    .select("*")
    .eq("account_id", input.accountId)
    .eq("idempotency_key", row.idempotency_key)
    .maybeSingle<SocialProfileSnapshotRow>();
  return existing.data
    ? { ok: true as const, created: false, row: existing.data }
    : { ok: false as const, reason: existing.error?.message || "snapshot_idempotency_read_failed" };
}

export async function enqueueDailySocialProfileSnapshotJobs(input: {
  now?: Date;
  supabase?: Supabase;
}) {
  const supabase = input.supabase ?? createSupabaseClient();
  const now = input.now ?? new Date();
  const accountsResult = await supabase
    .from("ig_accounts")
    .select("id,username,status,admin_lifecycle_status")
    .order("created_at", { ascending: true })
    .limit(5000);
  if (accountsResult.error) throw new Error(accountsResult.error.message);
  const active = ((accountsResult.data ?? []) as SupabaseRecord[])
    .filter((row) => readString(row.admin_lifecycle_status, readString(row.status, "")).toLowerCase() === "active")
    .filter((row) => readString(row.id, "") && readString(row.username, ""));
  let enqueued = 0;
  for (const account of active) {
    const accountId = readString(account.id, "");
    const resolved = await resolveAccountSnapshotTimezone(supabase, accountId);
    const observedAt = now.toISOString();
    const latestRun = await supabase.from("ig_runs")
      .select("id,finished_at,status")
      .eq("account_id", accountId)
      .in("status", ["completed", "stopped"])
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle<SupabaseRecord>();
    const runFinishedAt = readString(latestRun.data?.finished_at, "");
    const plan = planSocialProfileScheduledTrigger({ now, timezone: resolved.timezone, latestRunFinishedAt: runFinishedAt });
    if (!plan) continue;
    const trigger: SocialProfileSnapshotTrigger = plan.trigger;
    const sourceRunId = trigger === "session_end" ? readString(latestRun.data?.id, "") : "";
    const idempotencyKey = socialProfileSnapshotIdempotencyKey({
      accountId,
      trigger,
      observedAt,
      timezone: resolved.timezone,
    });
    const localDate = plan.localDate;
    const insert = await supabase.from("ig_social_profile_snapshot_jobs").upsert({
      account_id: accountId,
      username_normalized: readString(account.username, "").trim().toLowerCase(),
      snapshot_local_date: localDate,
      account_timezone: resolved.timezone,
      timezone_source: resolved.source,
      source_trigger: trigger,
      source_run_id: sourceRunId || null,
      idempotency_key: idempotencyKey,
      status: "queued",
    }, { onConflict: "account_id,idempotency_key", ignoreDuplicates: true }).select("id").maybeSingle();
    if (insert.error) throw new Error(insert.error.message);
    if (insert.data?.id) enqueued += 1;
  }
  return { selected: active.length, enqueued };
}

export async function processSocialProfileSnapshotJobs(input: {
  limit?: number;
  leaseOwner?: string;
  supabase?: Supabase;
  lookup?: typeof lookupInstagramPublicProfile;
  pause?: (milliseconds: number) => Promise<void>;
}) {
  const supabase = input.supabase ?? createSupabaseClient();
  const limit = Math.max(1, Math.min(input.limit ?? SOCIAL_PROFILE_SNAPSHOT_DAILY_BUDGET, SOCIAL_PROFILE_SNAPSHOT_DAILY_BUDGET));
  const claim = await supabase.rpc("claim_ig_social_profile_snapshot_jobs", {
    p_lease_owner: input.leaseOwner ?? `social-profile-cron:${crypto.randomUUID()}`,
    p_limit: limit,
    p_lease_seconds: 120,
  });
  if (claim.error) throw new Error(claim.error.message);
  const jobs = (claim.data ?? []) as SupabaseRecord[];
  return processClaimedSocialProfileSnapshotJobs({
    jobs,
    maxProviderCalls: limit,
    supabase,
    lookup: input.lookup,
    pause: input.pause,
  });
}

export async function processClaimedSocialProfileSnapshotJobs(input: {
  jobs: SupabaseRecord[];
  maxProviderCalls: number;
  supabase?: Supabase;
  lookup?: typeof lookupInstagramPublicProfile;
  persist?: typeof persistSocialProfileLookup;
  pause?: (milliseconds: number) => Promise<void>;
}) {
  const supabase = input.supabase ?? createSupabaseClient();
  const limit = Math.max(0, Math.min(input.maxProviderCalls, SOCIAL_PROFILE_SNAPSHOT_DAILY_BUDGET));
  const jobs = input.jobs.slice(0, limit);
  const results: SocialProfileSnapshotJobProcessResult[] = [];
  const pause = input.pause ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let providerCalls = 0;
  let stopAfterIndex: number | null = null;
  for (const [index, job] of jobs.entries()) {
    if (index > 0) await pause(1100);
    if (providerCalls >= limit) {
      stopAfterIndex = index;
      break;
    }
    providerCalls += 1;
    const lookup = await (input.lookup ?? lookupInstagramPublicProfile)(readString(job.username_normalized, ""));
    const persisted = await (input.persist ?? persistSocialProfileLookup)({
      accountId: readString(job.account_id, ""),
      username: readString(job.username_normalized, ""),
      lookup,
      trigger: readString(job.source_trigger, "daily_fallback") as SocialProfileSnapshotTrigger,
      sourceEventId: readString(job.source_event_id, "") || null,
      sourceRunId: readString(job.source_run_id, "") || null,
      sourceBusinessSessionId: readString(job.source_business_session_id, "") || null,
      supabase,
    });
    const attempts = Number(job.attempts ?? 1);
    const retryable = ["rate_limited", "unavailable", "provider_error"].includes(lookup.status) && attempts < SOCIAL_PROFILE_SNAPSHOT_MAX_ATTEMPTS;
    const jobStatus = persisted.ok ? "succeeded" : retryable ? "queued" : "failed";
    const update = await supabase.from("ig_social_profile_snapshot_jobs").update({
      status: jobStatus,
      available_at: retryable ? new Date(Date.now() + attempts * 15 * 60 * 1000).toISOString() : new Date().toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      last_error_code: persisted.ok ? null : String(persisted.reason).slice(0, 120),
      updated_at: new Date().toISOString(),
    }).eq("id", readString(job.id, ""));
    if (update.error) throw new Error(update.error.message);
    results.push({
      accountId: readString(job.account_id, ""),
      username: readString(job.username_normalized, ""),
      jobId: readString(job.id, ""),
      status: persisted.ok ? "succeeded" : retryable ? "failed_retryable" : "failed_terminal",
      lookupStatus: lookup.status,
      snapshotCreated: persisted.ok && persisted.created,
      followers: persisted.ok ? persisted.row.followers_count : null,
      followings: persisted.ok ? persisted.row.following_count : null,
      posts: persisted.ok ? persisted.row.posts_count : null,
      observedAt: persisted.ok ? persisted.row.observed_at : null,
    });
    if (lookup.status === "rate_limited") {
      stopAfterIndex = index + 1;
      break;
    }
  }

  const unprocessed = input.jobs.slice(stopAfterIndex ?? jobs.length);
  const unprocessedIds = unprocessed.map((job) => readString(job.id, "")).filter(Boolean);
  if (unprocessedIds.length > 0) {
    const release = await supabase.from("ig_social_profile_snapshot_jobs").update({
      status: "queued",
      available_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      lease_owner: null,
      lease_expires_at: null,
      last_error_code: providerCalls >= limit ? "provider_budget_exhausted" : "batch_paused_after_rate_limit",
      updated_at: new Date().toISOString(),
    }).in("id", unprocessedIds);
    if (release.error) throw new Error(release.error.message);
  }

  return {
    claimed: input.jobs.length,
    processed: results.length,
    providerCalls,
    succeeded: results.filter((result) => result.status === "succeeded").length,
    failedRetryable: results.filter((result) => result.status === "failed_retryable").length,
    failedTerminal: results.filter((result) => result.status === "failed_terminal").length,
    budgetExhausted: unprocessedIds.length > 0 && providerCalls >= limit,
    results,
  };
}
