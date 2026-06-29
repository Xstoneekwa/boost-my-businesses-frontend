import { createSupabaseClient } from "../supabase.ts";
import { readString } from "../instagram-client/guards.ts";
import { loadTargetEligibilityCountsForAccount } from "./account-target-eligibility.ts";
import { reconcileClientAccountNotificationsForAccount } from "../instagram-client/client-account-notifications.ts";

export const NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD = 5;
export const NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE = "needs_more_target_accounts";

const ACTIVE_ACTION_STATUSES = ["pending", "acknowledged", "pending_verification"] as const;

export type NeedsMoreTargetAccountsTriggerSource = "automatic" | "manual";

export type NeedsMoreTargetAccountsActorType = "admin" | "botapp" | "system" | "client";

export type NeedsMoreTargetAccountsMetadata = {
  eligible_target_count: number;
  threshold: number;
  trigger_source: NeedsMoreTargetAccountsTriggerSource;
  evaluation_reason: string;
};

export type NeedsMoreTargetAccountsReevaluationResult = {
  account_id: string;
  eligible_target_count: number;
  threshold: number;
  needs_more_targets: boolean;
  changed: "created" | "dismissed" | "updated" | "unchanged" | "idempotent";
  action_id: string | null;
};

type SupabaseRecord = Record<string, unknown>;

type NeedsMoreTargetAccountsSupabase = ReturnType<typeof createSupabaseClient>;

function dedupeKey(accountId: string) {
  return `account:${accountId}:dashboard_action:${NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE}`;
}

function buildMetadata(input: {
  eligibleCount: number;
  triggerSource: NeedsMoreTargetAccountsTriggerSource;
  evaluationReason: string;
}): NeedsMoreTargetAccountsMetadata {
  return {
    eligible_target_count: input.eligibleCount,
    threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
    trigger_source: input.triggerSource,
    evaluation_reason: readString(input.evaluationReason, "reevaluated").slice(0, 240),
  };
}

async function loadClientId(supabase: NeedsMoreTargetAccountsSupabase, accountId: string) {
  const { data, error } = await supabase
    .from("client_instagram_accounts")
    .select("client_id")
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (error) throw new Error(error.message);
  return readString(data?.client_id, "") || null;
}

export async function loadActiveNeedsMoreTargetAccountsAction(
  supabase: NeedsMoreTargetAccountsSupabase,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("account_dashboard_actions")
    .select("id,status,metadata,created_at,updated_at")
    .eq("account_id", accountId)
    .eq("action_type", NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE)
    .in("status", [...ACTIVE_ACTION_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<SupabaseRecord>();
  if (error) throw new Error(error.message);
  return data;
}

/** Canonical UTC timestamp when the needs-more signal became (or re-became) active. */
export function resolveNeedsMoreActiveSince(
  action: { created_at?: unknown } | null | undefined,
): string | null {
  const createdAt = readString(action?.created_at, "");
  return createdAt || null;
}

async function dismissActiveNeedsMoreTargetAccountsAction(
  supabase: NeedsMoreTargetAccountsSupabase,
  accountId: string,
) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("account_dashboard_actions")
    .update({ status: "dismissed", updated_at: now })
    .eq("account_id", accountId)
    .eq("action_type", NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE)
    .in("status", [...ACTIVE_ACTION_STATUSES])
    .select("id")
    .maybeSingle<SupabaseRecord>();
  if (error) throw new Error(error.message);
  return readString(data?.id, "") || null;
}

async function upsertNeedsMoreTargetAccountsAction(
  supabase: NeedsMoreTargetAccountsSupabase,
  input: {
    accountId: string;
    clientId: string | null;
    metadata: NeedsMoreTargetAccountsMetadata;
  },
) {
  const { data, error } = await supabase.rpc("upsert_account_dashboard_action", {
    p_account_id: input.accountId,
    p_client_id: input.clientId,
    p_incident_id: null,
    p_action_type: NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE,
    p_status: "pending",
    p_title: "More target accounts needed",
    p_dedupe_key: dedupeKey(input.accountId),
    p_severity: "info",
    p_audience: "ops",
    p_requires_client_action: false,
    p_blocking_campaign: false,
    p_safe_client_message: null,
    p_assistant_message: null,
    p_admin_message: `Eligible target count is ${input.metadata.eligible_target_count} (threshold ${input.metadata.threshold}).`,
    p_action_label: null,
    p_action_deep_link: null,
    p_metadata: input.metadata,
  });
  if (error) throw new Error(error.message);
  return readString((data as SupabaseRecord | null)?.id, "") || null;
}

async function auditNeedsMoreTargetAccountsEvent(
  supabase: NeedsMoreTargetAccountsSupabase,
  input: {
    accountId: string;
    actionType:
      | "needs_more_target_accounts_signal_created"
      | "needs_more_target_accounts_signal_updated"
      | "needs_more_target_accounts_signal_dismissed"
      | "needs_more_target_accounts_signal_cleared";
    actorType: NeedsMoreTargetAccountsActorType;
    metadata: NeedsMoreTargetAccountsMetadata;
    actionId?: string | null;
  },
) {
  try {
    await supabase.from("ig_action_logs").insert({
      account_id: input.accountId,
      run_id: null,
      target_username: null,
      action_type: input.actionType,
      status: "success",
      message: input.actionType,
      payload: {
        actor_type: input.actorType,
        source_surface: input.actorType === "botapp" ? "botapp_client_accounts" : "needs_more_target_accounts",
        action_id: input.actionId ?? null,
        ...input.metadata,
      },
      created_at: new Date().toISOString(),
    });
  } catch {
    // Audit is best-effort; dashboard action remains authoritative.
  }
}

function shouldSignalAutomatically(eligibleCount: number) {
  return eligibleCount <= NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD;
}

export async function reevaluateNeedsMoreTargetAccountsAutomatic(
  supabase: NeedsMoreTargetAccountsSupabase,
  input: {
    accountId: string;
    evaluationReason: string;
    actorType?: NeedsMoreTargetAccountsActorType;
  },
): Promise<NeedsMoreTargetAccountsReevaluationResult> {
  const accountId = input.accountId.trim();
  const counts = await loadTargetEligibilityCountsForAccount(supabase, accountId);
  const eligibleCount = counts.eligible;
  const needsMoreTargets = shouldSignalAutomatically(eligibleCount);
  const active = await loadActiveNeedsMoreTargetAccountsAction(supabase, accountId);
  const metadata = buildMetadata({
    eligibleCount,
    triggerSource: "automatic",
    evaluationReason: input.evaluationReason,
  });
  const actorType = input.actorType ?? "system";

  if (needsMoreTargets) {
    if (active) {
      const actionId = await upsertNeedsMoreTargetAccountsAction(supabase, {
        accountId,
        clientId: await loadClientId(supabase, accountId),
        metadata,
      });
      await auditNeedsMoreTargetAccountsEvent(supabase, {
        accountId,
        actionType: "needs_more_target_accounts_signal_updated",
        actorType,
        metadata,
        actionId,
      });
      await reconcileClientAccountNotificationsForAccount(supabase, accountId);
      return {
        account_id: accountId,
        eligible_target_count: eligibleCount,
        threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
        needs_more_targets: true,
        changed: "idempotent",
        action_id: actionId || readString(active.id, "") || null,
      };
    }

    const actionId = await upsertNeedsMoreTargetAccountsAction(supabase, {
      accountId,
      clientId: await loadClientId(supabase, accountId),
      metadata,
    });
    await auditNeedsMoreTargetAccountsEvent(supabase, {
      accountId,
      actionType: "needs_more_target_accounts_signal_created",
      actorType,
      metadata,
      actionId,
    });
    await reconcileClientAccountNotificationsForAccount(supabase, accountId);
    return {
      account_id: accountId,
      eligible_target_count: eligibleCount,
      threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
      needs_more_targets: true,
      changed: "created",
      action_id: actionId,
    };
  }

  if (!active) {
    return {
      account_id: accountId,
      eligible_target_count: eligibleCount,
      threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
      needs_more_targets: false,
      changed: "unchanged",
      action_id: null,
    };
  }

  const dismissedId = await dismissActiveNeedsMoreTargetAccountsAction(supabase, accountId);
  await auditNeedsMoreTargetAccountsEvent(supabase, {
    accountId,
    actionType: "needs_more_target_accounts_signal_dismissed",
    actorType,
    metadata,
    actionId: dismissedId,
  });
  await reconcileClientAccountNotificationsForAccount(supabase, accountId);
  return {
    account_id: accountId,
    eligible_target_count: eligibleCount,
    threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
    needs_more_targets: false,
    changed: "dismissed",
    action_id: dismissedId,
  };
}

export async function markNeedsMoreTargetAccountsManual(
  supabase: NeedsMoreTargetAccountsSupabase,
  input: {
    accountId: string;
    actorType: NeedsMoreTargetAccountsActorType;
    evaluationReason?: string;
  },
): Promise<NeedsMoreTargetAccountsReevaluationResult> {
  const accountId = input.accountId.trim();
  const counts = await loadTargetEligibilityCountsForAccount(supabase, accountId);
  const eligibleCount = counts.eligible;
  const active = await loadActiveNeedsMoreTargetAccountsAction(supabase, accountId);
  const metadata = buildMetadata({
    eligibleCount,
    triggerSource: "manual",
    evaluationReason: input.evaluationReason || "manual_operator_request",
  });
  const actionId = await upsertNeedsMoreTargetAccountsAction(supabase, {
    accountId,
    clientId: await loadClientId(supabase, accountId),
    metadata,
  });
  await auditNeedsMoreTargetAccountsEvent(supabase, {
    accountId,
    actionType: active ? "needs_more_target_accounts_signal_updated" : "needs_more_target_accounts_signal_created",
    actorType: input.actorType,
    metadata,
    actionId,
  });
  await reconcileClientAccountNotificationsForAccount(supabase, accountId);
  return {
    account_id: accountId,
    eligible_target_count: eligibleCount,
    threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
    needs_more_targets: true,
    changed: active ? "idempotent" : "created",
    action_id: actionId,
  };
}

export async function clearNeedsMoreTargetAccountsManual(
  supabase: NeedsMoreTargetAccountsSupabase,
  input: {
    accountId: string;
    actorType: NeedsMoreTargetAccountsActorType;
    evaluationReason?: string;
  },
): Promise<NeedsMoreTargetAccountsReevaluationResult> {
  const accountId = input.accountId.trim();
  const counts = await loadTargetEligibilityCountsForAccount(supabase, accountId);
  const eligibleCount = counts.eligible;
  const active = await loadActiveNeedsMoreTargetAccountsAction(supabase, accountId);
  const metadata = buildMetadata({
    eligibleCount,
    triggerSource: "manual",
    evaluationReason: input.evaluationReason || "manual_operator_clear",
  });

  if (!active) {
    return {
      account_id: accountId,
      eligible_target_count: eligibleCount,
      threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
      needs_more_targets: false,
      changed: "unchanged",
      action_id: null,
    };
  }

  const dismissedId = await dismissActiveNeedsMoreTargetAccountsAction(supabase, accountId);
  await auditNeedsMoreTargetAccountsEvent(supabase, {
    accountId,
    actionType: "needs_more_target_accounts_signal_cleared",
    actorType: input.actorType,
    metadata,
    actionId: dismissedId,
  });
  await reconcileClientAccountNotificationsForAccount(supabase, accountId);
  return {
    account_id: accountId,
    eligible_target_count: eligibleCount,
    threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
    needs_more_targets: false,
    changed: "dismissed",
    action_id: dismissedId,
  };
}

export async function reevaluateNeedsMoreTargetAccountsAfterTargetMutation(
  accountId: string,
  evaluationReason: string,
) {
  try {
    const supabase = createSupabaseClient();
    return await reevaluateNeedsMoreTargetAccountsAutomatic(supabase, {
      accountId,
      evaluationReason,
      actorType: "system",
    });
  } catch {
    return null;
  }
}

export async function syncNeedsMoreTargetAccountsDashboardAction(
  supabase: NeedsMoreTargetAccountsSupabase,
  input: {
    accountId: string;
    evaluationReason: string;
    actorType?: NeedsMoreTargetAccountsActorType;
  },
): Promise<NeedsMoreTargetAccountsReevaluationResult> {
  const accountId = input.accountId.trim();
  const counts = await loadTargetEligibilityCountsForAccount(supabase, accountId);
  const eligibleCount = counts.eligible;
  const needsMoreTargets = shouldSignalAutomatically(eligibleCount);
  const active = await loadActiveNeedsMoreTargetAccountsAction(supabase, accountId);
  const metadata = buildMetadata({
    eligibleCount,
    triggerSource: "automatic",
    evaluationReason: input.evaluationReason,
  });
  const actorType = input.actorType ?? "system";

  if (!needsMoreTargets) {
    if (!active) {
      return {
        account_id: accountId,
        eligible_target_count: eligibleCount,
        threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
        needs_more_targets: false,
        changed: "unchanged",
        action_id: null,
      };
    }
    const dismissedId = await dismissActiveNeedsMoreTargetAccountsAction(supabase, accountId);
    await auditNeedsMoreTargetAccountsEvent(supabase, {
      accountId,
      actionType: "needs_more_target_accounts_signal_dismissed",
      actorType,
      metadata,
      actionId: dismissedId,
    });
    return {
      account_id: accountId,
      eligible_target_count: eligibleCount,
      threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
      needs_more_targets: false,
      changed: "dismissed",
      action_id: dismissedId,
    };
  }

  const actionId = await upsertNeedsMoreTargetAccountsAction(supabase, {
    accountId,
    clientId: await loadClientId(supabase, accountId),
    metadata,
  });
  await auditNeedsMoreTargetAccountsEvent(supabase, {
    accountId,
    actionType: active ? "needs_more_target_accounts_signal_updated" : "needs_more_target_accounts_signal_created",
    actorType,
    metadata,
    actionId,
  });
  return {
    account_id: accountId,
    eligible_target_count: eligibleCount,
    threshold: NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD,
    needs_more_targets: true,
    changed: active ? "updated" : "created",
    action_id: actionId,
  };
}

export async function loadNeedsMoreTargetAccountsProjectionForAccounts(
  supabase: NeedsMoreTargetAccountsSupabase,
  accountIds: string[],
  eligibilityCounts: Map<string, { eligible: number }>,
) {
  const uniqueIds = [...new Set(accountIds.map((id) => id.trim()).filter(Boolean))];
  const out = new Map<string, { needsMoreTargets: boolean; eligibleTargetCount: number }>();
  if (uniqueIds.length === 0) return out;

  const { data, error } = await supabase
    .from("account_dashboard_actions")
    .select("account_id,id,status")
    .in("account_id", uniqueIds)
    .eq("action_type", NEEDS_MORE_TARGET_ACCOUNTS_ACTION_TYPE)
    .in("status", [...ACTIVE_ACTION_STATUSES]);

  if (error) throw new Error(error.message);
  const activeByAccount = new Set(
    (data ?? []).map((row) => readString((row as SupabaseRecord).account_id, "")).filter(Boolean),
  );

  for (const accountId of uniqueIds) {
    const eligibleTargetCount = eligibilityCounts.get(accountId)?.eligible ?? 0;
    out.set(accountId, {
      needsMoreTargets: activeByAccount.has(accountId),
      eligibleTargetCount,
    });
  }
  return out;
}
