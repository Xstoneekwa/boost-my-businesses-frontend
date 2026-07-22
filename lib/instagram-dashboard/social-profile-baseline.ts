import { createHash } from "node:crypto";
import { createSupabaseClient } from "../supabase.ts";
import { readString } from "../instagram-client/guards.ts";
import {
  businessDayKeyFromIso,
} from "./business-timezone.ts";
import {
  normalizeSocialProfileUsername,
  resolveSocialProfileTimezone,
  socialProfileSnapshotIdempotencyKey,
} from "./social-profile-snapshot-contract.ts";
import {
  processClaimedSocialProfileSnapshotJobs,
  type SocialProfileSnapshotJobProcessResult,
} from "./social-profile-snapshot-service.ts";

type SupabaseRecord = Record<string, unknown>;
type Supabase = ReturnType<typeof createSupabaseClient>;

export const SOCIAL_PROFILE_BASELINE_MAX_ACCOUNTS = 10;
export const SOCIAL_PROFILE_BASELINE_COST_PER_LOOKUP_USD = 0.004;
export const SOCIAL_PROFILE_BASELINE_STALE_AFTER_HOURS = 36;

export type SocialProfileBaselineClassification =
  | "snapshot_current"
  | "snapshot_stale"
  | "no_snapshot"
  | "username_missing"
  | "lifecycle_excluded"
  | "ambiguous_manual_review";

export type SocialProfileBaselineAccount = {
  accountId: string;
  username: string;
  lifecycle: string;
  assignment: string;
  timezone: string;
  timezoneSource: "device_assignment" | "schedule" | "platform_default";
  classification: SocialProfileBaselineClassification;
  reason: string;
  eligible: boolean;
  lastSnapshot: null | {
    followers: number | null;
    followings: number | null;
    posts: number | null;
    observedAt: string;
    localDate: string;
    provider: string;
    trigger: string;
  };
};

export type SocialProfileBaselineInventory = {
  accounts: SocialProfileBaselineAccount[];
  eligible: SocialProfileBaselineAccount[];
};

export type SocialProfileBaselineRequest =
  | { mode: "dry_run"; maxAccounts: number }
  | {
    mode: "execute";
    maxAccounts: number;
    expectedAccountCount: number;
    maxProviderCalls: number;
    idempotencyKey: string;
    confirmation: "RUN_BASELINE";
  };

export type SocialProfileBaselineProcessing = {
  claimed: number;
  processed: number;
  providerCalls: number;
  succeeded: number;
  failedRetryable: number;
  failedTerminal: number;
  budgetExhausted: boolean;
  results: SocialProfileSnapshotJobProcessResult[];
};

export type SocialProfileBaselineDependencies = {
  loadInventory: (now: Date) => Promise<SocialProfileBaselineInventory>;
  findExistingBatch: (batchId: string) => Promise<boolean>;
  createJobs: (accounts: SocialProfileBaselineAccount[], batchId: string, now: Date) => Promise<number>;
  discardJobs: (batchId: string, accountIds: string[]) => Promise<number>;
  processBatch: (batchId: string, maxProviderCalls: number) => Promise<SocialProfileBaselineProcessing>;
};

type RawInventory = {
  accounts: SupabaseRecord[];
  assignments: SupabaseRecord[];
  devices: SupabaseRecord[];
  snapshots: SupabaseRecord[];
};

function readNullableCount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validTimestamp(value: unknown) {
  const raw = readString(value, "");
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : "";
}

function baselineEligible(classification: SocialProfileBaselineClassification) {
  return classification === "snapshot_stale" || classification === "no_snapshot";
}

export function buildSocialProfileBaselineInventory(input: RawInventory & { now: Date }): SocialProfileBaselineInventory {
  const devices = new Map(input.devices.map((device) => [readString(device.id, ""), device]));
  const assignmentsByAccount = new Map<string, SupabaseRecord[]>();
  for (const assignment of input.assignments) {
    const accountId = readString(assignment.account_id, "");
    if (!accountId || !["pending", "reserved", "active"].includes(readString(assignment.status, ""))) continue;
    assignmentsByAccount.set(accountId, [...(assignmentsByAccount.get(accountId) ?? []), assignment]);
  }
  for (const assignments of assignmentsByAccount.values()) {
    assignments.sort((left, right) => validTimestamp(right.created_at).localeCompare(validTimestamp(left.created_at)));
  }

  const snapshotsByAccount = new Map<string, SupabaseRecord[]>();
  for (const snapshot of input.snapshots) {
    const accountId = readString(snapshot.account_id, "");
    if (!accountId || !validTimestamp(snapshot.observed_at)) continue;
    snapshotsByAccount.set(accountId, [...(snapshotsByAccount.get(accountId) ?? []), snapshot]);
  }
  for (const snapshots of snapshotsByAccount.values()) {
    snapshots.sort((left, right) => validTimestamp(right.observed_at).localeCompare(validTimestamp(left.observed_at)));
  }

  const accounts = input.accounts.map((account): SocialProfileBaselineAccount => {
    const accountId = readString(account.id, "");
    const username = normalizeSocialProfileUsername(account.username);
    const lifecycle = readString(account.admin_lifecycle_status, readString(account.status, "unknown")).toLowerCase();
    const assignments = assignmentsByAccount.get(accountId) ?? [];
    const assignment = assignments[0] ?? null;
    const device = assignment ? devices.get(readString(assignment.device_id, "")) ?? null : null;
    const resolved = resolveSocialProfileTimezone({ deviceTimezone: assignments.length === 1 ? readString(device?.timezone, "") : "" });
    const snapshots = snapshotsByAccount.get(accountId) ?? [];
    const latest = snapshots[0] ?? null;
    const latestModern = snapshots.find((snapshot) => readString(snapshot.source_trigger, "") !== "legacy_import") ?? null;
    const modernObservedAt = validTimestamp(latestModern?.observed_at);
    const modernIsCurrent = Boolean(modernObservedAt)
      && input.now.getTime() - Date.parse(modernObservedAt) <= SOCIAL_PROFILE_BASELINE_STALE_AFTER_HOURS * 60 * 60 * 1000;

    let classification: SocialProfileBaselineClassification;
    let reason: string;
    if (!/^[a-z0-9._]{1,30}$/.test(username)) {
      classification = "username_missing";
      reason = "invalid_or_missing_username";
    } else if (lifecycle !== "active") {
      classification = "lifecycle_excluded";
      reason = "lifecycle_not_active";
    } else if (assignments.length > 1) {
      classification = "ambiguous_manual_review";
      reason = "multiple_active_assignments";
    } else if (modernIsCurrent) {
      classification = "snapshot_current";
      reason = "modern_snapshot_within_36h";
    } else if (latest) {
      classification = "snapshot_stale";
      reason = latestModern ? "modern_snapshot_older_than_36h" : "legacy_followers_only_no_modern_baseline";
    } else {
      classification = "no_snapshot";
      reason = "no_persisted_snapshot";
    }

    return {
      accountId,
      username,
      lifecycle,
      assignment: assignment ? readString(assignment.status, "unknown") : "unassigned",
      timezone: resolved.timezone,
      timezoneSource: resolved.source,
      classification,
      reason,
      eligible: baselineEligible(classification),
      lastSnapshot: latest ? {
        followers: readNullableCount(latest.followers_count),
        followings: readNullableCount(latest.following_count),
        posts: readNullableCount(latest.posts_count),
        observedAt: validTimestamp(latest.observed_at),
        localDate: readString(latest.snapshot_local_date, ""),
        provider: readString(latest.source_provider, ""),
        trigger: readString(latest.source_trigger, ""),
      } : null,
    };
  });

  return { accounts, eligible: accounts.filter((account) => account.eligible) };
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN;
}

export function validateSocialProfileBaselineRequest(value: unknown):
  | { ok: true; request: SocialProfileBaselineRequest }
  | { ok: false; status: string; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, status: "invalid_request", error: "A JSON object is required." };
  }
  const body = value as Record<string, unknown>;
  const mode = body.mode;
  const maxAccounts = integer(body.max_accounts);
  if (mode !== "dry_run" && mode !== "execute") {
    return { ok: false, status: "invalid_mode", error: "mode must be dry_run or execute." };
  }
  if (!Number.isInteger(maxAccounts) || maxAccounts < 1 || maxAccounts > SOCIAL_PROFILE_BASELINE_MAX_ACCOUNTS) {
    return { ok: false, status: "invalid_max_accounts", error: "max_accounts must be between 1 and 10." };
  }
  if (mode === "dry_run") return { ok: true, request: { mode, maxAccounts } };

  const expectedAccountCount = integer(body.expected_account_count);
  const maxProviderCalls = integer(body.max_provider_calls);
  const idempotencyKey = readString(body.idempotency_key, "").trim();
  if (body.confirmation !== "RUN_BASELINE") {
    return { ok: false, status: "confirmation_required", error: "Exact confirmation is required." };
  }
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return { ok: false, status: "idempotency_key_required", error: "A bounded idempotency_key is required." };
  }
  if (!Number.isInteger(expectedAccountCount) || expectedAccountCount < 0) {
    return { ok: false, status: "invalid_expected_account_count", error: "expected_account_count must be a non-negative integer." };
  }
  if (!Number.isInteger(maxProviderCalls) || maxProviderCalls < 1 || maxProviderCalls > SOCIAL_PROFILE_BASELINE_MAX_ACCOUNTS) {
    return { ok: false, status: "invalid_max_provider_calls", error: "max_provider_calls must be between 1 and 10." };
  }
  return {
    ok: true,
    request: { mode, maxAccounts, expectedAccountCount, maxProviderCalls, idempotencyKey, confirmation: "RUN_BASELINE" },
  };
}

export function socialProfileBaselineBatchId(idempotencyKey: string) {
  return createHash("sha256").update(`social-profile-baseline-v1:${idempotencyKey}`).digest("hex");
}

function inventoryReport(inventory: SocialProfileBaselineInventory, maxAccounts: number) {
  const providerCallsMax = Math.min(inventory.eligible.length, maxAccounts);
  return {
    eligible_count: inventory.eligible.length,
    provider_calls_max: providerCallsMax,
    estimated_cost_usd_max: Number((providerCallsMax * SOCIAL_PROFILE_BASELINE_COST_PER_LOOKUP_USD).toFixed(3)),
    accounts: inventory.accounts.map((account) => ({
      account_ref: createHash("sha256").update(`social-profile-baseline-account:${account.accountId}`).digest("hex").slice(0, 12),
      username_redacted: account.username.length <= 2
        ? "**"
        : `${account.username.slice(0, 2)}***${account.username.slice(-1)}`,
      lifecycle: account.lifecycle,
      assignment: account.assignment,
      timezone: account.timezone,
      timezone_source: account.timezoneSource,
      classification: account.classification,
      reason: account.reason,
      eligible: account.eligible,
      last_snapshot: account.lastSnapshot,
    })),
  };
}

export function socialProfileBaselineLogRecord(event: string, input: {
  batchId?: string;
  eligibleCount?: number;
  jobsCreated?: number;
  providerCalls?: number;
  status?: string;
}) {
  return {
    component: "social_profile_snapshot_baseline",
    event,
    batch_id_prefix: input.batchId?.slice(0, 12) ?? null,
    eligible_count: input.eligibleCount ?? 0,
    jobs_created: input.jobsCreated ?? 0,
    provider_calls: input.providerCalls ?? 0,
    status: input.status ?? "unknown",
  };
}

export async function runSocialProfileBaseline(
  request: SocialProfileBaselineRequest,
  dependencies: SocialProfileBaselineDependencies,
  now = new Date(),
) {
  const inventory = await dependencies.loadInventory(now);
  const report = inventoryReport(inventory, request.maxAccounts);
  if (request.mode === "dry_run") {
    return { ok: true as const, status: "dry_run", providerCalls: 0, jobsCreated: 0, jobsProcessed: 0, ...report };
  }
  if (inventory.eligible.length !== request.expectedAccountCount) {
    return { ok: false as const, status: "expected_account_count_mismatch", providerCalls: 0, jobsCreated: 0, jobsProcessed: 0, ...report };
  }
  if (inventory.eligible.length > request.maxAccounts) {
    return { ok: false as const, status: "account_limit_exceeded", providerCalls: 0, jobsCreated: 0, jobsProcessed: 0, ...report };
  }
  if (report.provider_calls_max > request.maxProviderCalls) {
    return { ok: false as const, status: "provider_budget_exceeded", providerCalls: 0, jobsCreated: 0, jobsProcessed: 0, ...report };
  }
  if (inventory.eligible.length === 0) {
    return { ok: true as const, status: "baseline_completed", replayed: false, providerCalls: 0, jobsCreated: 0, jobsProcessed: 0, ...report };
  }

  const batchId = socialProfileBaselineBatchId(request.idempotencyKey);
  if (await dependencies.findExistingBatch(batchId)) {
    return { ok: true as const, status: "idempotent_replay", replayed: true, batchId, providerCalls: 0, jobsCreated: 0, jobsProcessed: 0, ...report };
  }
  const selected = inventory.eligible.slice(0, request.maxAccounts);
  const jobsCreated = await dependencies.createJobs(selected, batchId, now);
  if (jobsCreated === 0) {
    return { ok: true as const, status: "idempotent_noop", replayed: true, batchId, providerCalls: 0, jobsCreated: 0, jobsProcessed: 0, ...report };
  }

  const revalidated = await dependencies.loadInventory(new Date());
  const allowedIds = new Set(revalidated.eligible.map((account) => account.accountId));
  const excludedIds = selected.map((account) => account.accountId).filter((accountId) => !allowedIds.has(accountId));
  if (excludedIds.length > 0) await dependencies.discardJobs(batchId, excludedIds);
  const processLimit = Math.min(request.maxProviderCalls, selected.length - excludedIds.length);
  const processing = processLimit > 0
    ? await dependencies.processBatch(batchId, processLimit)
    : { claimed: 0, processed: 0, providerCalls: 0, succeeded: 0, failedRetryable: 0, failedTerminal: 0, budgetExhausted: false, results: [] };
  if (processing.providerCalls > request.maxProviderCalls) {
    throw new Error("social_profile_baseline_provider_budget_violation");
  }
  const status = processing.failedRetryable || processing.failedTerminal ? "baseline_partial" : "baseline_completed";
  console.info(JSON.stringify(socialProfileBaselineLogRecord("execute_complete", {
    batchId,
    eligibleCount: inventory.eligible.length,
    jobsCreated,
    providerCalls: processing.providerCalls,
    status,
  })));
  return {
    ok: true as const,
    status,
    replayed: false,
    batchId,
    providerCalls: processing.providerCalls,
    jobsCreated,
    jobsProcessed: processing.processed,
    succeeded: processing.succeeded,
    failed_retryable: processing.failedRetryable,
    failed_terminal: processing.failedTerminal,
    skipped_fresh: inventory.accounts.filter((account) => account.classification === "snapshot_current").length,
    budget_exhausted: processing.budgetExhausted,
    actual_cost_usd: Number((processing.providerCalls * SOCIAL_PROFILE_BASELINE_COST_PER_LOOKUP_USD).toFixed(3)),
    results: processing.results.map((result) => ({
      account_ref: createHash("sha256").update(`social-profile-baseline-account:${result.accountId}`).digest("hex").slice(0, 12),
      username_redacted: result.username.length <= 2 ? "**" : `${result.username.slice(0, 2)}***${result.username.slice(-1)}`,
      job_id: result.jobId,
      status: result.status,
      lookup_status: result.lookupStatus,
      snapshot_created: result.snapshotCreated,
      followers: result.followers,
      followings: result.followings,
      posts: result.posts,
      observed_at: result.observedAt,
    })),
    ...report,
  };
}

export async function loadSocialProfileBaselineInventory(now = new Date(), supabase: Supabase = createSupabaseClient()) {
  const [accounts, assignments, snapshots] = await Promise.all([
    supabase.from("ig_accounts").select("id,username,status,admin_lifecycle_status,created_at").order("created_at", { ascending: true }).limit(5000),
    supabase.from("account_assignments").select("account_id,device_id,status,created_at").in("status", ["pending", "reserved", "active"]).order("created_at", { ascending: false }).limit(10000),
    supabase.from("ig_account_social_profile_snapshots")
      .select("account_id,followers_count,following_count,posts_count,observed_at,snapshot_local_date,source_provider,source_trigger,created_at")
      .order("observed_at", { ascending: false }).limit(10000),
  ]);
  const firstError = accounts.error ?? assignments.error ?? snapshots.error;
  if (firstError) throw new Error(firstError.message);
  const deviceIds = [...new Set(((assignments.data ?? []) as SupabaseRecord[]).map((row) => readString(row.device_id, "")).filter(Boolean))];
  const devices = deviceIds.length
    ? await supabase.from("phone_devices").select("id,timezone").in("id", deviceIds)
    : { data: [], error: null };
  if (devices.error) throw new Error(devices.error.message);
  return buildSocialProfileBaselineInventory({
    accounts: (accounts.data ?? []) as SupabaseRecord[],
    assignments: (assignments.data ?? []) as SupabaseRecord[],
    devices: (devices.data ?? []) as SupabaseRecord[],
    snapshots: (snapshots.data ?? []) as SupabaseRecord[],
    now,
  });
}

export function createSocialProfileBaselineDependencies(supabase: Supabase = createSupabaseClient()): SocialProfileBaselineDependencies {
  return {
    loadInventory: (now) => loadSocialProfileBaselineInventory(now, supabase),
    findExistingBatch: async (batchId) => {
      const result = await supabase.from("ig_social_profile_snapshot_jobs").select("id")
        .eq("source_trigger", "baseline_one_shot").eq("source_event_id", batchId).limit(1).maybeSingle();
      if (result.error) throw new Error(result.error.message);
      return Boolean(result.data?.id);
    },
    createJobs: async (accounts, batchId, now) => {
      if (accounts.length === 0) return 0;
      const rows = accounts.map((account) => ({
        account_id: account.accountId,
        username_normalized: account.username,
        snapshot_local_date: businessDayKeyFromIso(now.toISOString(), account.timezone),
        account_timezone: account.timezone,
        timezone_source: account.timezoneSource,
        source_trigger: "baseline_one_shot",
        source_event_id: batchId,
        idempotency_key: socialProfileSnapshotIdempotencyKey({
          accountId: account.accountId,
          trigger: "baseline_one_shot",
          observedAt: now.toISOString(),
          timezone: account.timezone,
        }),
        status: "queued",
      }));
      const result = await supabase.from("ig_social_profile_snapshot_jobs")
        .upsert(rows, { onConflict: "account_id,idempotency_key", ignoreDuplicates: true }).select("id");
      if (result.error) throw new Error(result.error.message);
      return (result.data ?? []).length;
    },
    discardJobs: async (batchId, accountIds) => {
      if (accountIds.length === 0) return 0;
      const result = await supabase.from("ig_social_profile_snapshot_jobs").update({
        status: "discarded",
        last_error_code: "baseline_revalidation_excluded",
        lease_owner: null,
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq("source_trigger", "baseline_one_shot").eq("source_event_id", batchId).in("account_id", accountIds).select("id");
      if (result.error) throw new Error(result.error.message);
      return (result.data ?? []).length;
    },
    processBatch: async (batchId, maxProviderCalls) => {
      const claim = await supabase.rpc("claim_ig_social_profile_baseline_jobs", {
        p_source_event_id: batchId,
        p_lease_owner: `social-profile-baseline:${crypto.randomUUID()}`,
        p_limit: maxProviderCalls,
        p_lease_seconds: 120,
      });
      if (claim.error) throw new Error(claim.error.message);
      return processClaimedSocialProfileSnapshotJobs({
        jobs: (claim.data ?? []) as SupabaseRecord[],
        maxProviderCalls,
        supabase,
      });
    },
  };
}
