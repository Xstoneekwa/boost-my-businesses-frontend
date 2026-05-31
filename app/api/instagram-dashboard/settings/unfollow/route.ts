import {
  evaluateUnfollowStartGate,
  normalizeUnfollowRuntimeCapMode,
  resolveFollowToUnfollowHandoffEnabled,
  resolveUnfollowRuntimeCap,
  runControlUnfollowAnyH3RealSupported,
  runControlUnfollowAnySafeStrategyProven,
  sanitizeRunControlReason,
  type UnfollowRuntimeCapMode,
} from "@/lib/instagram-dashboard/run-control";
import { createSupabaseClient } from "@/lib/supabase";
import { getDashboardUserContext } from "@/lib/restaurant-analytics/session";
import {
  getAccountId,
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readNumber,
  readString,
  requireInstagramAdmin,
  validateAccountId,
  type SupabaseRecord,
} from "../../_utils";

export const dynamic = "force-dynamic";

export const SUPPORTED_UNFOLLOW_MODES = ["unfollow", "unfollow-any"] as const;
export const PLANNED_UNFOLLOW_MODE = "unfollow-non-followers";
const DEFAULT_UNFOLLOW_SESSION_CAP = 50;
const DEFAULT_UNFOLLOW_DAY_CAP = 200;
const DEFAULT_UNFOLLOW_AFTER_DAYS = 3;

type SupportedUnfollowMode = (typeof SUPPORTED_UNFOLLOW_MODES)[number];

export type UnfollowDomainPatchPayload = {
  account_id?: unknown;
  unfollow_enabled?: unknown;
  unfollow_mode?: unknown;
  unfollow_per_session_limit?: unknown;
  unfollow_per_day_limit?: unknown;
  unfollow_after_days?: unknown;
  runtime_cap_mode?: unknown;
  runtime_safety_cap?: unknown;
};

export type UnfollowDomainInput = {
  unfollowEnabled: boolean;
  unfollowMode: string;
  unfollowPerSessionLimit: number;
  unfollowPerDayLimit: number;
  unfollowAfterDays: number;
  runtimeCapMode: UnfollowRuntimeCapMode;
  runtimeSafetyCap: number | null;
};

function readNonNegativeInteger(value: unknown, fallback: number) {
  const parsed = readNumber(value, fallback);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readOptionalNonNegativeInteger(value: unknown, fallback: number | null) {
  if (value === null || value === undefined || readString(value, "").trim() === "") return fallback;
  const parsed = readNumber(value, Number.NaN);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeUnfollowMode(value: unknown) {
  return readString(value, "unfollow").trim().toLowerCase() || "unfollow";
}

export function validateUnfollowDomainInput(input: UnfollowDomainInput) {
  if (input.unfollowMode === PLANNED_UNFOLLOW_MODE) {
    return "unfollow_non_followers_planned";
  }
  if (!SUPPORTED_UNFOLLOW_MODES.includes(input.unfollowMode as SupportedUnfollowMode)) {
    return "unfollow_mode_not_supported";
  }
  if (input.unfollowEnabled && input.unfollowPerSessionLimit < 1) {
    return "unfollow_cap_unproven";
  }
  if (input.unfollowEnabled && input.unfollowPerDayLimit < 1) {
    return "unfollow_cap_unproven";
  }
  if (
    input.unfollowEnabled &&
    input.runtimeCapMode !== "prod_normal" &&
    (input.runtimeSafetyCap === null || input.runtimeSafetyCap < 1)
  ) {
    return "unfollow_cap_unproven";
  }
  if (input.unfollowEnabled && input.unfollowPerSessionLimit > input.unfollowPerDayLimit) {
    return "session_cap_exceeds_day_cap";
  }
  return null;
}

export function unfollowChangedFields(before: UnfollowDomainInput, after: UnfollowDomainInput) {
  const fields: string[] = [];
  if (before.unfollowEnabled !== after.unfollowEnabled) fields.push("unfollow_enabled");
  if (before.unfollowMode !== after.unfollowMode) fields.push("unfollow_mode");
  if (before.unfollowPerSessionLimit !== after.unfollowPerSessionLimit) fields.push("unfollow_per_session_limit");
  if (before.unfollowPerDayLimit !== after.unfollowPerDayLimit) fields.push("unfollow_per_day_limit");
  if (before.unfollowAfterDays !== after.unfollowAfterDays) fields.push("unfollow_after_days");
  if (before.runtimeCapMode !== after.runtimeCapMode) fields.push("runtime_cap_mode");
  if (before.runtimeSafetyCap !== after.runtimeSafetyCap) fields.push("runtime_safety_cap");
  return fields;
}

function redactedSummary(input: UnfollowDomainInput) {
  return {
    unfollow_enabled: input.unfollowEnabled,
    unfollow_mode: input.unfollowMode,
    unfollow_per_session_limit: input.unfollowPerSessionLimit,
    unfollow_per_day_limit: input.unfollowPerDayLimit,
    unfollow_after_days: input.unfollowAfterDays,
    runtime_cap_mode: input.runtimeCapMode,
    runtime_safety_cap: input.runtimeSafetyCap,
  };
}

function entitlementActive(row: SupabaseRecord) {
  if (row.active !== true) return false;
  const validUntil = readString(row.valid_until, "").trim();
  return !validUntil || Date.parse(validUntil) > Date.now();
}

async function hasFeatureEntitlement(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  featureCode: "follow" | "unfollow",
) {
  const { data: links, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("client_id")
    .eq("account_id", accountId)
    .limit(10);
  if (linkError) return null;
  const clientIds = [...new Set((links ?? []).map((row) => readString((row as SupabaseRecord).client_id, "")).filter(Boolean))];
  if (!clientIds.length) return false;

  const { data, error } = await supabase
    .from("client_entitlements")
    .select("active,valid_until")
    .in("client_id", clientIds)
    .eq("feature_code", featureCode)
    .eq("active", true)
    .limit(10);
  if (error) return null;
  return (data ?? []).some((row) => entitlementActive(row as SupabaseRecord));
}

async function countUnfollowsToday(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const since = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
  const { count, error } = await supabase
    .from("ig_interacted_users")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("unfollow_result", "success")
    .gte("unfollowed_at", since);
  if (error) return null;
  return count ?? 0;
}

function inputFromRow(row: SupabaseRecord | null | undefined): UnfollowDomainInput {
  return {
    unfollowEnabled: row?.unfollow_enabled === true,
    unfollowMode: normalizeUnfollowMode(row?.unfollow_mode),
    unfollowPerSessionLimit: readNonNegativeInteger(row?.unfollow_per_session_limit, DEFAULT_UNFOLLOW_SESSION_CAP),
    unfollowPerDayLimit: readNonNegativeInteger(row?.unfollow_per_day_limit, DEFAULT_UNFOLLOW_DAY_CAP),
    unfollowAfterDays: readNonNegativeInteger(row?.unfollow_after_days, DEFAULT_UNFOLLOW_AFTER_DAYS),
    runtimeCapMode: normalizeUnfollowRuntimeCapMode(row?.runtime_cap_mode),
    runtimeSafetyCap: readOptionalNonNegativeInteger(row?.runtime_safety_cap, null),
  };
}

function limitingReason({
  input,
  effectiveCap,
  unfollowDayRemaining,
  runtimeSafetyCap,
  runtimeCapMode,
  blockReason,
}: {
  input: UnfollowDomainInput;
  effectiveCap: number;
  unfollowDayRemaining: number | null;
  runtimeSafetyCap: number | null;
  runtimeCapMode: UnfollowRuntimeCapMode;
  blockReason: string;
}) {
  if (blockReason === "unfollow_entitlement_missing") return "limited_by_entitlement";
  if (blockReason === "unfollow_disabled") return "unfollow_disabled";
  if (blockReason === "unfollow_handoff_disabled") return "limited_by_handoff_disabled";
  if (blockReason === "unfollow_no_safe_candidate_strategy") return "limited_by_no_safe_candidate";
  if (blockReason) return "limited_by_runtime_gate";
  if (unfollowDayRemaining !== null && unfollowDayRemaining <= effectiveCap && unfollowDayRemaining < input.unfollowPerSessionLimit) {
    return "limited_by_daily_remaining";
  }
  if (runtimeSafetyCap !== null && runtimeSafetyCap <= effectiveCap && runtimeSafetyCap < input.unfollowPerSessionLimit) {
    return runtimeCapMode === "mini_run" ? "limited_by_mini_run_mode" : "limited_by_safety_cap";
  }
  return "ready";
}

async function fetchUnfollowRow(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("ig_account_unfollow_settings")
    .select("unfollow_enabled,unfollow_mode,unfollow_per_session_limit,unfollow_per_day_limit,unfollow_after_days,do_unfollow_first,unfollow_only,runtime_cap_mode,runtime_safety_cap")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function buildUnfollowProjection(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const row = await fetchUnfollowRow(supabase, accountId);
  const input = inputFromRow(row);
  const followEntitlementActive = await hasFeatureEntitlement(supabase, accountId, "follow");
  const unfollowEntitlementActive = await hasFeatureEntitlement(supabase, accountId, "unfollow");
  const unfollowsDoneToday = await countUnfollowsToday(supabase, accountId);
  const unfollowDayRemaining =
    unfollowsDoneToday === null ? null : Math.max(0, input.unfollowPerDayLimit - unfollowsDoneToday);
  const runtimeCap = resolveUnfollowRuntimeCap({
    unfollowPerSessionLimit: input.unfollowPerSessionLimit,
    runtimeCapMode: input.runtimeCapMode,
    runtimeSafetyCap: input.runtimeSafetyCap,
  });
  const handoffEnabled = resolveFollowToUnfollowHandoffEnabled({
    unfollowEnabled: input.unfollowEnabled,
    unfollowMode: input.unfollowMode,
    runtimeCapMode: runtimeCap.mode,
  });
  const blockReason = evaluateUnfollowStartGate({
    requestedRunType: "account_session",
    unfollowEntitlementActive: unfollowEntitlementActive === true,
    unfollowEnabled: input.unfollowEnabled,
    unfollowMode: input.unfollowMode,
    unfollowPerSessionLimit: input.unfollowPerSessionLimit,
    unfollowPerDayLimit: input.unfollowPerDayLimit,
    unfollowDayRemaining,
    realHandoffEnabled: handoffEnabled,
    realMaxActions: runtimeCap.cap,
    realHardMax: runtimeCap.hardCap,
    h3RealSupported: runControlUnfollowAnyH3RealSupported(),
    safeCandidateStrategyProven: runControlUnfollowAnySafeStrategyProven(),
  });
  const rawEffectiveCap = Math.min(
    input.unfollowPerSessionLimit,
    input.unfollowPerDayLimit,
    runtimeCap.cap ?? input.unfollowPerSessionLimit,
    unfollowDayRemaining ?? input.unfollowPerDayLimit,
  );
  const effectiveCap = blockReason ? 0 : Math.max(0, rawEffectiveCap);

  return {
    account_id: accountId,
    unfollow_enabled: input.unfollowEnabled,
    unfollow_mode: input.unfollowMode,
    unfollow_per_session_limit: input.unfollowPerSessionLimit,
    unfollow_per_day_limit: input.unfollowPerDayLimit,
    unfollow_after_days: input.unfollowAfterDays,
    runtime_cap_mode: runtimeCap.mode,
    effective_unfollow_cap: effectiveCap,
    runtime_safety_cap: runtimeCap.mode === "prod_normal" ? null : input.runtimeSafetyCap ?? 0,
    runtime_hard_cap: runtimeCap.hardCap ?? 0,
    runtime_cap_source: runtimeCap.source,
    unfollow_day_remaining: unfollowDayRemaining,
    limiting_reason: limitingReason({
      input,
      effectiveCap,
      unfollowDayRemaining,
      runtimeSafetyCap: runtimeCap.limitedByRuntimeCap ? runtimeCap.cap : null,
      runtimeCapMode: runtimeCap.mode,
      blockReason: blockReason ?? "",
    }),
    follow_entitlement_status: followEntitlementActive === null ? "Unknown" : followEntitlementActive ? "Active" : "Missing",
    unfollow_entitlement_status: unfollowEntitlementActive === null ? "Unknown" : unfollowEntitlementActive ? "Active" : "Missing",
    handoff_real_status: handoffEnabled ? "Enabled" : "Disabled",
    current_runtime_mode: input.unfollowMode,
    block_reason: blockReason ?? "",
    safe_candidate_strategy_status: runControlUnfollowAnySafeStrategyProven() ? "Ready" : "Unknown",
    do_unfollow_first_status: "Needs runtime support",
    legacy: {
      unfollow_any_runtime_source: "ignored",
      unfollow_non_followers_runtime_source: "ignored",
      do_follows_first_runtime_source: "ignored",
    },
  };
}

async function recordAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId: string;
    actorId: string | null;
    fieldsChanged: string[];
    oldSummary: Record<string, unknown>;
    newSummary: Record<string, unknown>;
  },
) {
  await supabase.from("ig_action_logs").insert({
    account_id: input.accountId,
    run_id: null,
    target_username: null,
    action_type: "unfollow_domain_settings_saved",
    status: "success",
    message: "Unfollow domain settings saved from admin dashboard.",
    payload: {
      actor_type: "admin",
      actor_id: input.actorId,
      source_surface: "admin_dashboard",
      domain: "unfollow",
      fields_changed: input.fieldsChanged,
      old_summary: input.oldSummary,
      new_summary: input.newSummary,
    },
    created_at: new Date().toISOString(),
  });
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;
    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;
    return jsonOk(await buildUnfollowProjection(createSupabaseClient(), accountId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Unfollow domain settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not load Unfollow domain settings."), 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorizedResponse = await requireInstagramAdmin();
    if (unauthorizedResponse) return unauthorizedResponse;
    const body = await readJsonBody<UnfollowDomainPatchPayload>(request);
    if (!body) return jsonError("Invalid Unfollow settings payload.", 400);

    const accountId = readString(body.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const beforeRow = await fetchUnfollowRow(supabase, accountId);
    const before = inputFromRow(beforeRow);
    const after: UnfollowDomainInput = {
      unfollowEnabled: readBoolean(body.unfollow_enabled, before.unfollowEnabled),
      unfollowMode: normalizeUnfollowMode(body.unfollow_mode ?? before.unfollowMode),
      unfollowPerSessionLimit: readNonNegativeInteger(body.unfollow_per_session_limit, before.unfollowPerSessionLimit),
      unfollowPerDayLimit: readNonNegativeInteger(body.unfollow_per_day_limit, before.unfollowPerDayLimit),
      unfollowAfterDays: readNonNegativeInteger(body.unfollow_after_days, before.unfollowAfterDays),
      runtimeCapMode: normalizeUnfollowRuntimeCapMode(body.runtime_cap_mode ?? before.runtimeCapMode),
      runtimeSafetyCap:
        normalizeUnfollowRuntimeCapMode(body.runtime_cap_mode ?? before.runtimeCapMode) === "prod_normal"
          ? null
          : readOptionalNonNegativeInteger(body.runtime_safety_cap, before.runtimeSafetyCap),
    };

    const validationError = validateUnfollowDomainInput(after);
    if (validationError) return jsonError(validationError, 400);

    const fieldsChanged = unfollowChangedFields(before, after);
    if (!fieldsChanged.length) {
      return jsonOk({ ...(await buildUnfollowProjection(supabase, accountId)), changed_fields: [] });
    }

    const { error } = await supabase.from("ig_account_unfollow_settings").upsert(
      {
        account_id: accountId,
        unfollow_enabled: after.unfollowEnabled,
        unfollow_mode: after.unfollowMode,
        unfollow_per_session_limit: after.unfollowPerSessionLimit,
        unfollow_per_day_limit: after.unfollowPerDayLimit,
        unfollow_after_days: after.unfollowAfterDays,
        runtime_cap_mode: after.runtimeCapMode,
        runtime_safety_cap: after.runtimeSafetyCap,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id" },
    );
    if (error) return jsonError(sanitizeRunControlReason(error.message, "Could not save Unfollow settings."), 500);

    const actorContext = await getDashboardUserContext();
    await recordAudit(supabase, {
      accountId,
      actorId: actorContext?.userId ?? null,
      fieldsChanged,
      oldSummary: redactedSummary(before),
      newSummary: redactedSummary(after),
    }).catch(() => undefined);

    return jsonOk({ ...(await buildUnfollowProjection(supabase, accountId)), changed_fields: fieldsChanged });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save Unfollow domain settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not save Unfollow domain settings."), 500);
  }
}
