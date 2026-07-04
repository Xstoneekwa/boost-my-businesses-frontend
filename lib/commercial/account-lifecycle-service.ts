import type { SupabaseClient } from "@supabase/supabase-js";
import { readString, type SupabaseRecord } from "@/app/api/instagram-dashboard/_utils";
import { reconcileClientAccountNotificationsForAccount } from "@/lib/instagram-client/client-account-notifications";
import { insertCheckoutAuditEvent } from "./entitlements.ts";
import {
  accountHasActiveRuntime,
  quiesceAccountRuntime,
} from "./account-lifecycle-runtime.ts";
import {
  getAccountLifecycleStripeGateway,
  type AccountLifecycleStripeGateway,
} from "./account-lifecycle-stripe.ts";
import type {
  CommercialLifecycleActor,
  CommercialLifecycleOperationType,
  CommercialLifecycleResult,
  CommercialLifecycleState,
} from "./account-lifecycle-types.ts";

type Row = Record<string, unknown>;

const PAUSE_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "paused", "unpaid"]);
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(["canceled", "cancelled", "incomplete_expired"]);

type AccountContext = {
  accountId: string;
  clientId: string | null;
  adminLifecycleStatus: string;
  entitlementId: string | null;
  stripeSubscriptionId: string | null;
  commercialState: CommercialLifecycleState;
  pauseExpiresAt: string | null;
  stripeBillingPaused: boolean;
  resolutionIssue: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function pauseExpiresAtFrom(now = new Date()) {
  return new Date(now.getTime() + PAUSE_DURATION_MS).toISOString();
}

function readCommercialState(row: Row | null): CommercialLifecycleState {
  return readString(row?.commercial_state, "active") as CommercialLifecycleState;
}

async function loadAccountContext(
  supabase: SupabaseClient,
  accountId: string,
  override?: { entitlementId?: string | null; stripeSubscriptionId?: string | null; allowTerminalSubscription?: boolean },
): Promise<AccountContext> {
  const { data: accountRow } = await supabase
    .from("ig_accounts")
    .select("id,admin_lifecycle_status")
    .eq("id", accountId)
    .maybeSingle<Row>();
  if (!accountRow?.id) throw new Error("account_not_found");

  const { data: stateRow } = await supabase
    .from("commercial_account_lifecycle_states")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle<Row>();

  const { data: entitlementRows } = await supabase
    .from("client_account_entitlements")
    .select("id,client_id,status,account_id,consumed_at,created_at")
    .eq("account_id", accountId)
    .eq("status", "entitlement_consumed")
    .order("consumed_at", { ascending: false })
    .limit(20);

  const entitlements = ((entitlementRows ?? []) as Row[]);
  const overrideEntitlementId = readString(override?.entitlementId);
  const overrideSubscriptionId = readString(override?.stripeSubscriptionId) || readString(stateRow?.stripe_subscription_id);
  const candidateEntitlements = overrideEntitlementId
    ? entitlements.filter((row) => readString(row.id) === overrideEntitlementId)
    : entitlements;

  let entitlementId: string | null = null;
  let clientId: string | null = null;
  let stripeSubscriptionId: string | null = null;
  let resolutionIssue: string | null = null;

  if (!candidateEntitlements.length) {
    resolutionIssue = "commercial_entitlement_missing";
  } else {
    const entitlementIds = candidateEntitlements.map((row) => readString(row.id)).filter(Boolean);
    const { data: projectionRows } = await supabase
      .from("commercial_stripe_subscriptions")
      .select("stripe_subscription_id,status,client_account_entitlement_id,account_id")
      .in("client_account_entitlement_id", entitlementIds)
      .order("updated_at", { ascending: false })
      .limit(50);
    const compatible = ((projectionRows ?? []) as Row[]).filter((row) => {
      const subscriptionId = readString(row.stripe_subscription_id);
      const status = readString(row.status).toLowerCase();
      if (!subscriptionId) return false;
      if (overrideSubscriptionId && subscriptionId !== overrideSubscriptionId) return false;
      if (override?.allowTerminalSubscription && TERMINAL_SUBSCRIPTION_STATUSES.has(status)) return true;
      return ACTIVE_SUBSCRIPTION_STATUSES.has(status);
    });

    const pairs = compatible.map((projection) => {
      const linkedEntitlementId = readString(projection.client_account_entitlement_id);
      const entitlement = candidateEntitlements.find((row) => readString(row.id) === linkedEntitlementId);
      return entitlement ? { entitlement, projection } : null;
    }).filter(Boolean) as Array<{ entitlement: Row; projection: Row }>;

    if (!pairs.length) {
      resolutionIssue = overrideSubscriptionId ? "commercial_subscription_missing" : "commercial_subscription_missing";
    } else if (pairs.length > 1) {
      resolutionIssue = "commercial_subscription_ambiguous";
    } else {
      entitlementId = readString(pairs[0].entitlement.id);
      clientId = readString(pairs[0].entitlement.client_id) || null;
      stripeSubscriptionId = readString(pairs[0].projection.stripe_subscription_id) || null;
    }
  }

  return {
    accountId,
    clientId,
    adminLifecycleStatus: readString(accountRow.admin_lifecycle_status, "active"),
    entitlementId,
    stripeSubscriptionId,
    commercialState: readCommercialState(stateRow),
    pauseExpiresAt: readString(stateRow?.pause_expires_at) || null,
    stripeBillingPaused: stateRow?.stripe_billing_paused === true,
    resolutionIssue,
  };
}

async function upsertLifecycleState(
  supabase: SupabaseClient,
  input: {
    accountId: string;
    entitlementId?: string | null;
    stripeSubscriptionId?: string | null;
    commercialState: CommercialLifecycleState;
    pauseExpiresAt?: string | null;
    pausedAt?: string | null;
    stripeBillingPaused?: boolean;
    actionRequiredReason?: string | null;
    lastOperationId?: string | null;
    lastIdempotencyKey?: string | null;
  },
) {
  const patch = {
    account_id: input.accountId,
    entitlement_id: input.entitlementId ?? null,
    stripe_subscription_id: input.stripeSubscriptionId ?? null,
    commercial_state: input.commercialState,
    pause_expires_at: input.pauseExpiresAt ?? null,
    paused_at: input.pausedAt ?? null,
    stripe_billing_paused: input.stripeBillingPaused ?? false,
    action_required_reason: input.actionRequiredReason ?? null,
    last_operation_id: input.lastOperationId ?? null,
    last_idempotency_key: input.lastIdempotencyKey ?? null,
    updated_at: nowIso(),
  };
  const { error } = await supabase
    .from("commercial_account_lifecycle_states")
    .upsert(patch, { onConflict: "account_id" });
  if (error) throw new Error(error.message || "lifecycle_state_upsert_failed");
}

async function setAdminLifecycleStatus(
  supabase: SupabaseClient,
  accountId: string,
  status: string,
) {
  const { error } = await supabase
    .from("ig_accounts")
    .update({ admin_lifecycle_status: status })
    .eq("id", accountId);
  if (error) throw new Error(error.message || "admin_lifecycle_update_failed");
}

async function markEntitlementCancelled(
  supabase: SupabaseClient,
  entitlementId: string,
) {
  const { error } = await supabase
    .from("client_account_entitlements")
    .update({ status: "entitlement_cancelled", updated_at: nowIso() })
    .eq("id", entitlementId)
    .eq("status", "entitlement_consumed");
  if (error) throw new Error(error.message || "entitlement_cancel_failed");
}

async function updateStripeProjectionBilling(
  supabase: SupabaseClient,
  stripeSubscriptionId: string,
  input: { billingPaused: boolean; pauseCollectionBehavior: string | null; status?: string },
) {
  const patch: Row = {
    billing_paused: input.billingPaused,
    pause_collection_behavior: input.pauseCollectionBehavior,
    updated_at: nowIso(),
  };
  if (input.status) patch.status = input.status;
  await supabase
    .from("commercial_stripe_subscriptions")
    .update(patch)
    .eq("stripe_subscription_id", stripeSubscriptionId);
}

async function releaseCapacityIfSafe(
  supabase: SupabaseClient,
  accountId: string,
  actorId: string | null,
): Promise<CommercialLifecycleResult["capacityReleaseStatus"]> {
  if (await accountHasActiveRuntime(supabase, accountId)) {
    return "skipped_active_runtime";
  }
  const { data, error } = await supabase.rpc("release_account_schedule_capacity", {
    p_account_id: accountId,
    p_reason: "account_cancelled_release",
    p_source: "commercial_account_lifecycle",
    p_actor_id: actorId,
  });
  if (error) return "pending";
  if (data && typeof data === "object" && (data as Row).ok === false) return "pending";
  return "released";
}

async function claimOperation(
  supabase: SupabaseClient,
  input: {
    accountId: string;
    entitlementId: string | null;
    operationType: CommercialLifecycleOperationType;
    idempotencyKey: string;
    reason: string;
    actor: CommercialLifecycleActor;
  },
) {
  const { data: existing } = await supabase
    .from("commercial_account_lifecycle_operations")
    .select("*")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle<Row>();

  if (existing?.id) {
    return {
      operationId: readString(existing.id),
      replay: true,
      state: readString(existing.state),
      operationType: readString(existing.operation_type) as CommercialLifecycleOperationType,
    };
  }

  const { data: openOperations } = await supabase
    .from("commercial_account_lifecycle_operations")
    .select("id,operation_type,state,idempotency_key")
    .eq("account_id", input.accountId)
    .in("state", ["pending", "in_progress"])
    .limit(5);
  const incompatible = ((openOperations ?? []) as Row[]).find((row) => {
    const key = readString(row.idempotency_key);
    if (key === input.idempotencyKey) return false;
    return readString(row.operation_type) !== input.operationType
      || readString(row.state) === "in_progress";
  });
  if (incompatible?.id) {
    throw new Error("lifecycle_operation_conflict");
  }

  const { data, error } = await supabase
    .from("commercial_account_lifecycle_operations")
    .insert({
      account_id: input.accountId,
      entitlement_id: input.entitlementId,
      operation_type: input.operationType,
      idempotency_key: input.idempotencyKey,
      state: "in_progress",
      reason: input.reason,
      actor_type: input.actor.actorType,
      actor_id: input.actor.actorId,
      source_surface: input.actor.sourceSurface,
      metadata_safe: {},
      created_at: nowIso(),
      updated_at: nowIso(),
    })
    .select("id")
    .maybeSingle<Row>();

  if (error) throw new Error(error.message || "operation_claim_failed");
  return {
    operationId: readString(data?.id),
    replay: false,
    state: "in_progress",
    operationType: input.operationType,
  };
}

async function failLifecycleActionRequired(
  supabase: SupabaseClient,
  input: {
    accountId: string;
    operationType: CommercialLifecycleOperationType;
    idempotencyKey: string;
    operationId: string;
    reason: string;
    pauseExpiresAt?: string | null;
    stripeBillingPaused?: boolean;
    capacityReleaseStatus?: CommercialLifecycleResult["capacityReleaseStatus"];
    runtimeQuiesced?: boolean;
  },
) {
  await upsertLifecycleState(supabase, {
    accountId: input.accountId,
    commercialState: "action_required",
    actionRequiredReason: input.reason,
    lastOperationId: input.operationId,
    lastIdempotencyKey: input.idempotencyKey,
  });
  await finishOperation(supabase, input.operationId, "failed", input.reason);
  return buildResult({
    ok: false,
    accountId: input.accountId,
    operationType: input.operationType,
    commercialState: "action_required",
    idempotencyKey: input.idempotencyKey,
    operationId: input.operationId,
    converged: false,
    actionRequired: true,
    actionRequiredReason: input.reason,
    pauseExpiresAt: input.pauseExpiresAt ?? null,
    stripeBillingPaused: input.stripeBillingPaused ?? false,
    capacityReleaseStatus: input.capacityReleaseStatus ?? "not_applicable",
    runtimeQuiesced: input.runtimeQuiesced ?? false,
  });
}

async function finishOperation(
  supabase: SupabaseClient,
  operationId: string,
  state: "completed" | "failed",
  errorRedacted: string | null = null,
) {
  await supabase
    .from("commercial_account_lifecycle_operations")
    .update({ state, error_redacted: errorRedacted, updated_at: nowIso() })
    .eq("id", operationId);
}

async function auditLifecycle(
  supabase: SupabaseClient,
  input: {
    accountId: string;
    action: string;
    actor: CommercialLifecycleActor;
    payload: Row;
  },
) {
  await supabase.from("ig_action_logs").insert({
    account_id: input.accountId,
    action_type: "commercial_account_lifecycle",
    status: "success",
    message: input.action,
    payload: {
      actor_type: input.actor.actorType,
      actor_id: input.actor.actorId,
      source_surface: input.actor.sourceSurface,
      ...input.payload,
    },
    created_at: nowIso(),
  }).then(() => undefined, () => undefined);
}

function buildResult(input: {
  ok: boolean;
  accountId: string;
  operationType: CommercialLifecycleOperationType;
  commercialState: CommercialLifecycleState;
  idempotencyKey: string;
  operationId: string | null;
  converged: boolean;
  actionRequired: boolean;
  actionRequiredReason: string | null;
  pauseExpiresAt: string | null;
  stripeBillingPaused: boolean;
  capacityReleaseStatus: CommercialLifecycleResult["capacityReleaseStatus"];
  runtimeQuiesced: boolean;
}): CommercialLifecycleResult {
  return { ...input };
}

export async function executeCommercialAccountLifecycle(input: {
  supabase: SupabaseClient;
  accountId: string;
  operationType: CommercialLifecycleOperationType;
  idempotencyKey: string;
  reason: string;
  actor: CommercialLifecycleActor;
  stripeGateway?: AccountLifecycleStripeGateway;
  env?: NodeJS.ProcessEnv;
  knownEntitlementId?: string | null;
  knownStripeSubscriptionId?: string | null;
  skipStripeCancel?: boolean;
}): Promise<CommercialLifecycleResult> {
  const supabase = input.supabase;
  const accountId = readString(input.accountId);
  const operationType = input.operationType;
  const idempotencyKey = readString(input.idempotencyKey).slice(0, 200);
  if (!accountId || !idempotencyKey) throw new Error("invalid_lifecycle_input");

  const ctx = await loadAccountContext(supabase, accountId, {
    entitlementId: input.knownEntitlementId,
    stripeSubscriptionId: input.knownStripeSubscriptionId,
    allowTerminalSubscription: input.skipStripeCancel === true,
  });
  const claim = await claimOperation(supabase, {
    accountId,
    entitlementId: ctx.entitlementId,
    operationType,
    idempotencyKey,
    reason: input.reason,
    actor: input.actor,
  });

  if (claim.replay && claim.state === "completed") {
    const refreshed = await loadAccountContext(supabase, accountId);
    return buildResult({
      ok: true,
      accountId,
      operationType,
      commercialState: refreshed.commercialState,
      idempotencyKey,
      operationId: claim.operationId,
      converged: true,
      actionRequired: refreshed.commercialState === "action_required",
      actionRequiredReason: null,
      pauseExpiresAt: refreshed.pauseExpiresAt,
      stripeBillingPaused: refreshed.stripeBillingPaused,
      capacityReleaseStatus: "not_applicable",
      runtimeQuiesced: true,
    });
  }

  if (ctx.resolutionIssue && !(operationType === "cancel" && ctx.commercialState === "cancelled")) {
    return failLifecycleActionRequired(supabase, {
      accountId,
      operationType,
      idempotencyKey,
      operationId: claim.operationId,
      reason: ctx.resolutionIssue,
      pauseExpiresAt: ctx.pauseExpiresAt,
      stripeBillingPaused: ctx.stripeBillingPaused,
      runtimeQuiesced: false,
    });
  }

  const getStripe = () => input.stripeGateway ?? getAccountLifecycleStripeGateway(input.env);

  try {
    if (operationType === "pause") {
      if (!ctx.stripeSubscriptionId) throw new Error("commercial_subscription_missing");
      if (ctx.commercialState === "paused" || ctx.commercialState === "cancelled") {
        await finishOperation(supabase, claim.operationId, "completed");
        return buildResult({
          ok: true,
          accountId,
          operationType,
          commercialState: ctx.commercialState,
          idempotencyKey,
          operationId: claim.operationId,
          converged: true,
          actionRequired: false,
          actionRequiredReason: null,
          pauseExpiresAt: ctx.pauseExpiresAt,
          stripeBillingPaused: ctx.stripeBillingPaused,
          capacityReleaseStatus: "not_applicable",
          runtimeQuiesced: true,
        });
      }

      await upsertLifecycleState(supabase, {
        accountId,
        entitlementId: ctx.entitlementId,
        stripeSubscriptionId: ctx.stripeSubscriptionId,
        commercialState: "pause_requested",
        lastOperationId: claim.operationId,
        lastIdempotencyKey: idempotencyKey,
      });
      await setAdminLifecycleStatus(supabase, accountId, "paused");

      const runtime = await quiesceAccountRuntime(supabase, accountId, input.reason);
      if (runtime.stillActive) {
        await upsertLifecycleState(supabase, {
          accountId,
          commercialState: "action_required",
          actionRequiredReason: "runtime_still_active",
          lastOperationId: claim.operationId,
          lastIdempotencyKey: idempotencyKey,
        });
        await finishOperation(supabase, claim.operationId, "failed", "runtime_still_active");
        await auditLifecycle(supabase, { accountId, action: "pause_runtime_blocked", actor: input.actor, payload: { runtime } });
        return buildResult({
          ok: false,
          accountId,
          operationType,
          commercialState: "action_required",
          idempotencyKey,
          operationId: claim.operationId,
          converged: false,
          actionRequired: true,
          actionRequiredReason: "runtime_still_active",
          pauseExpiresAt: null,
          stripeBillingPaused: false,
          capacityReleaseStatus: "not_applicable",
          runtimeQuiesced: false,
        });
      }

      try {
        await getStripe().pauseCollectionVoid(ctx.stripeSubscriptionId, idempotencyKey);
      } catch (stripeError) {
        const message = stripeError instanceof Error ? stripeError.message : "stripe_pause_failed";
        await upsertLifecycleState(supabase, {
          accountId,
          commercialState: "action_required",
          actionRequiredReason: "stripe_pause_failed",
          lastOperationId: claim.operationId,
          lastIdempotencyKey: idempotencyKey,
        });
        await finishOperation(supabase, claim.operationId, "failed", message.slice(0, 240));
        return buildResult({
          ok: false,
          accountId,
          operationType,
          commercialState: "action_required",
          idempotencyKey,
          operationId: claim.operationId,
          converged: false,
          actionRequired: true,
          actionRequiredReason: "stripe_pause_failed",
          pauseExpiresAt: null,
          stripeBillingPaused: false,
          capacityReleaseStatus: "not_applicable",
          runtimeQuiesced: runtime.quiesced,
        });
      }

      const pausedAt = nowIso();
      const pauseExpiresAt = pauseExpiresAtFrom();
      await upsertLifecycleState(supabase, {
        accountId,
        entitlementId: ctx.entitlementId,
        stripeSubscriptionId: ctx.stripeSubscriptionId,
        commercialState: "paused",
        pausedAt,
        pauseExpiresAt,
        stripeBillingPaused: true,
        actionRequiredReason: null,
        lastOperationId: claim.operationId,
        lastIdempotencyKey: idempotencyKey,
      });
      await updateStripeProjectionBilling(supabase, ctx.stripeSubscriptionId, {
        billingPaused: true,
        pauseCollectionBehavior: "void",
      });
      if (ctx.entitlementId) {
        await insertCheckoutAuditEvent(supabase, {
          entitlementId: ctx.entitlementId,
          clientId: ctx.clientId,
          eventType: "commercial_lifecycle_paused",
          payload: { account_id: accountId, pause_expires_at: pauseExpiresAt },
        });
      }
      await reconcileClientAccountNotificationsForAccount(supabase, accountId);
      await finishOperation(supabase, claim.operationId, "completed");
      await auditLifecycle(supabase, { accountId, action: "commercial_pause_completed", actor: input.actor, payload: { pause_expires_at: pauseExpiresAt } });

      return buildResult({
        ok: true,
        accountId,
        operationType,
        commercialState: "paused",
        idempotencyKey,
        operationId: claim.operationId,
        converged: true,
        actionRequired: false,
        actionRequiredReason: null,
        pauseExpiresAt,
        stripeBillingPaused: true,
        capacityReleaseStatus: "not_applicable",
        runtimeQuiesced: runtime.quiesced,
      });
    }

    if (operationType === "resume") {
      if (!ctx.stripeSubscriptionId) throw new Error("commercial_subscription_missing");
      if (ctx.commercialState !== "paused" && ctx.commercialState !== "action_required") {
        throw new Error("resume_not_allowed_from_state");
      }
      if (ctx.pauseExpiresAt && Date.parse(ctx.pauseExpiresAt) <= Date.now()) {
        throw new Error("pause_expired");
      }

      await upsertLifecycleState(supabase, {
        accountId,
        commercialState: "resume_requested",
        lastOperationId: claim.operationId,
        lastIdempotencyKey: idempotencyKey,
      });

      try {
        await getStripe().resumeCollection(ctx.stripeSubscriptionId, idempotencyKey);
      } catch (stripeError) {
        const message = stripeError instanceof Error ? stripeError.message : "stripe_resume_failed";
        await upsertLifecycleState(supabase, {
          accountId,
          commercialState: "action_required",
          actionRequiredReason: "stripe_resume_failed",
          lastOperationId: claim.operationId,
          lastIdempotencyKey: idempotencyKey,
        });
        await finishOperation(supabase, claim.operationId, "failed", message.slice(0, 240));
        return buildResult({
          ok: false,
          accountId,
          operationType,
          commercialState: "action_required",
          idempotencyKey,
          operationId: claim.operationId,
          converged: false,
          actionRequired: true,
          actionRequiredReason: "stripe_resume_failed",
          pauseExpiresAt: ctx.pauseExpiresAt,
          stripeBillingPaused: ctx.stripeBillingPaused,
          capacityReleaseStatus: "not_applicable",
          runtimeQuiesced: true,
        });
      }

      await setAdminLifecycleStatus(supabase, accountId, "active");
      await upsertLifecycleState(supabase, {
        accountId,
        entitlementId: ctx.entitlementId,
        stripeSubscriptionId: ctx.stripeSubscriptionId,
        commercialState: "active",
        pauseExpiresAt: null,
        pausedAt: null,
        stripeBillingPaused: false,
        actionRequiredReason: null,
        lastOperationId: claim.operationId,
        lastIdempotencyKey: idempotencyKey,
      });
      await updateStripeProjectionBilling(supabase, ctx.stripeSubscriptionId, {
        billingPaused: false,
        pauseCollectionBehavior: null,
      });
      await reconcileClientAccountNotificationsForAccount(supabase, accountId);
      await finishOperation(supabase, claim.operationId, "completed");
      await auditLifecycle(supabase, { accountId, action: "commercial_resume_completed", actor: input.actor, payload: {} });

      return buildResult({
        ok: true,
        accountId,
        operationType,
        commercialState: "active",
        idempotencyKey,
        operationId: claim.operationId,
        converged: true,
        actionRequired: false,
        actionRequiredReason: null,
        pauseExpiresAt: null,
        stripeBillingPaused: false,
        capacityReleaseStatus: "not_applicable",
        runtimeQuiesced: true,
      });
    }

    // cancel
    if (!ctx.stripeSubscriptionId) {
      return failLifecycleActionRequired(supabase, {
        accountId,
        operationType,
        idempotencyKey,
        operationId: claim.operationId,
        reason: "commercial_subscription_missing",
        pauseExpiresAt: ctx.pauseExpiresAt,
        stripeBillingPaused: ctx.stripeBillingPaused,
      });
    }
    if (ctx.commercialState === "cancelled") {
      await finishOperation(supabase, claim.operationId, "completed");
      return buildResult({
        ok: true,
        accountId,
        operationType,
        commercialState: "cancelled",
        idempotencyKey,
        operationId: claim.operationId,
        converged: true,
        actionRequired: false,
        actionRequiredReason: null,
        pauseExpiresAt: null,
        stripeBillingPaused: false,
        capacityReleaseStatus: "released",
        runtimeQuiesced: true,
      });
    }

    await upsertLifecycleState(supabase, {
      accountId,
      commercialState: "cancel_requested",
      lastOperationId: claim.operationId,
      lastIdempotencyKey: idempotencyKey,
    });
    await setAdminLifecycleStatus(supabase, accountId, "paused");

    const runtime = await quiesceAccountRuntime(supabase, accountId, input.reason);
    if (runtime.stillActive) {
      await upsertLifecycleState(supabase, {
        accountId,
        commercialState: "action_required",
        actionRequiredReason: "runtime_still_active",
        lastOperationId: claim.operationId,
        lastIdempotencyKey: idempotencyKey,
      });
      await finishOperation(supabase, claim.operationId, "failed", "runtime_still_active");
      return buildResult({
        ok: false,
        accountId,
        operationType,
        commercialState: "action_required",
        idempotencyKey,
        operationId: claim.operationId,
        converged: false,
        actionRequired: true,
        actionRequiredReason: "runtime_still_active",
        pauseExpiresAt: null,
        stripeBillingPaused: ctx.stripeBillingPaused,
        capacityReleaseStatus: "skipped_active_runtime",
        runtimeQuiesced: false,
      });
    }

    if (!input.skipStripeCancel) {
      try {
        await getStripe().cancelSubscriptionImmediately(ctx.stripeSubscriptionId, idempotencyKey);
      } catch (stripeError) {
        const message = stripeError instanceof Error ? stripeError.message : "stripe_cancel_failed";
        await upsertLifecycleState(supabase, {
          accountId,
          commercialState: "action_required",
          actionRequiredReason: "stripe_cancel_failed",
          lastOperationId: claim.operationId,
          lastIdempotencyKey: idempotencyKey,
        });
        await finishOperation(supabase, claim.operationId, "failed", message.slice(0, 240));
        return buildResult({
          ok: false,
          accountId,
          operationType,
          commercialState: "action_required",
          idempotencyKey,
          operationId: claim.operationId,
          converged: false,
          actionRequired: true,
          actionRequiredReason: "stripe_cancel_failed",
          pauseExpiresAt: null,
          stripeBillingPaused: ctx.stripeBillingPaused,
          capacityReleaseStatus: "skipped_active_runtime",
          runtimeQuiesced: runtime.quiesced,
        });
      }
    }

    if (ctx.entitlementId) {
      await markEntitlementCancelled(supabase, ctx.entitlementId);
    }
    await updateStripeProjectionBilling(supabase, ctx.stripeSubscriptionId, {
      billingPaused: false,
      pauseCollectionBehavior: null,
      status: "canceled",
    });
    const capacityReleaseStatus = await releaseCapacityIfSafe(supabase, accountId, input.actor.actorId);
    if (capacityReleaseStatus !== "released") {
      await upsertLifecycleState(supabase, {
        accountId,
        entitlementId: ctx.entitlementId,
        stripeSubscriptionId: ctx.stripeSubscriptionId,
        commercialState: "action_required",
        actionRequiredReason: "capacity_release_pending",
        stripeBillingPaused: false,
        lastOperationId: claim.operationId,
        lastIdempotencyKey: idempotencyKey,
      });
      await finishOperation(supabase, claim.operationId, "failed", "capacity_release_pending");
      return buildResult({
        ok: false,
        accountId,
        operationType,
        commercialState: "action_required",
        idempotencyKey,
        operationId: claim.operationId,
        converged: false,
        actionRequired: true,
        actionRequiredReason: "capacity_release_pending",
        pauseExpiresAt: null,
        stripeBillingPaused: false,
        capacityReleaseStatus,
        runtimeQuiesced: runtime.quiesced,
      });
    }
    await setAdminLifecycleStatus(supabase, accountId, "cancelled");
    await upsertLifecycleState(supabase, {
      accountId,
      entitlementId: ctx.entitlementId,
      stripeSubscriptionId: ctx.stripeSubscriptionId,
      commercialState: "cancelled",
      pauseExpiresAt: null,
      pausedAt: null,
      stripeBillingPaused: false,
      actionRequiredReason: null,
      lastOperationId: claim.operationId,
      lastIdempotencyKey: idempotencyKey,
    });
    if (ctx.entitlementId) {
      await insertCheckoutAuditEvent(supabase, {
        entitlementId: ctx.entitlementId,
        clientId: ctx.clientId,
        eventType: "commercial_lifecycle_cancelled",
        payload: { account_id: accountId, reason: input.reason },
      });
    }
    await reconcileClientAccountNotificationsForAccount(supabase, accountId);
    await finishOperation(supabase, claim.operationId, "completed");
    await auditLifecycle(supabase, { accountId, action: "commercial_cancel_completed", actor: input.actor, payload: { capacity_release_status: capacityReleaseStatus } });

    return buildResult({
      ok: true,
      accountId,
      operationType,
      commercialState: "cancelled",
      idempotencyKey,
      operationId: claim.operationId,
      converged: true,
      actionRequired: false,
      actionRequiredReason: null,
      pauseExpiresAt: null,
      stripeBillingPaused: false,
      capacityReleaseStatus,
      runtimeQuiesced: runtime.quiesced,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "lifecycle_failed";
    if (claim.operationId) {
      await finishOperation(supabase, claim.operationId, "failed", message.slice(0, 240));
    }
    throw error;
  }
}

export async function processExpiredCommercialPauses(input: {
  supabase: SupabaseClient;
  limit?: number;
  stripeGateway?: AccountLifecycleStripeGateway;
  env?: NodeJS.ProcessEnv;
}) {
  const limit = input.limit ?? 50;
  const now = nowIso();
  const { data, error } = await input.supabase
    .from("commercial_account_lifecycle_states")
    .select("account_id,pause_expires_at,commercial_state")
    .eq("commercial_state", "paused")
    .lte("pause_expires_at", now)
    .order("pause_expires_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message || "expired_pause_query_failed");

  const results: CommercialLifecycleResult[] = [];
  for (const row of (data ?? []) as SupabaseRecord[]) {
    const accountId = readString(row.account_id);
    if (!accountId) continue;
    const idempotencyKey = `pause-expired:${accountId}:${readString(row.pause_expires_at)}`;
    const result = await executeCommercialAccountLifecycle({
      supabase: input.supabase,
      accountId,
      operationType: "cancel",
      idempotencyKey,
      reason: "pause_expired",
      actor: { actorType: "cron", actorId: null, sourceSurface: "commercial_lifecycle_expiry_cron" },
      stripeGateway: input.stripeGateway,
      env: input.env,
    });
    results.push(result);
  }
  return results;
}

function operationTypeForRecoverableState(state: string, lastOperationType: string): CommercialLifecycleOperationType | null {
  if (state === "pause_requested") return "pause";
  if (state === "resume_requested") return "resume";
  if (state === "cancel_requested") return "cancel";
  if (["pause", "resume", "cancel"].includes(lastOperationType)) {
    return lastOperationType as CommercialLifecycleOperationType;
  }
  return null;
}

export async function processRecoverableCommercialLifecycleOperations(input: {
  supabase: SupabaseClient;
  limit?: number;
  stripeGateway?: AccountLifecycleStripeGateway;
  env?: NodeJS.ProcessEnv;
}) {
  const limit = input.limit ?? 50;
  const { data, error } = await input.supabase
    .from("commercial_account_lifecycle_states")
    .select("account_id,commercial_state,last_operation_id,last_idempotency_key,action_required_reason")
    .in("commercial_state", ["pause_requested", "resume_requested", "cancel_requested", "action_required"])
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message || "recoverable_lifecycle_query_failed");

  const results: CommercialLifecycleResult[] = [];
  for (const row of (data ?? []) as SupabaseRecord[]) {
    const accountId = readString(row.account_id);
    if (!accountId) continue;
    let lastOperationType = "";
    const lastOperationId = readString(row.last_operation_id);
    if (lastOperationId) {
      const { data: operation } = await input.supabase
        .from("commercial_account_lifecycle_operations")
        .select("operation_type")
        .eq("id", lastOperationId)
        .maybeSingle<Row>();
      lastOperationType = readString(operation?.operation_type);
    }
    const operationType = operationTypeForRecoverableState(readString(row.commercial_state), lastOperationType);
    if (!operationType) continue;
    const idempotencyKey = readString(row.last_idempotency_key)
      || `lifecycle-recover:${accountId}:${operationType}:${lastOperationId || "unknown"}`;
    const result = await executeCommercialAccountLifecycle({
      supabase: input.supabase,
      accountId,
      operationType,
      idempotencyKey,
      reason: `lifecycle_reconciler:${readString(row.action_required_reason, readString(row.commercial_state))}`,
      actor: { actorType: "cron", actorId: null, sourceSurface: "commercial_lifecycle_reconciler" },
      stripeGateway: input.stripeGateway,
      env: input.env,
    });
    results.push(result);
  }
  return results;
}

export async function loadCommercialLifecycleState(
  supabase: SupabaseClient,
  accountId: string,
) {
  return loadAccountContext(supabase, accountId);
}

export async function executeCommercialCancelForDeletedSubscription(input: {
  supabase: SupabaseClient;
  stripeSubscriptionId: string;
  stripeEventId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const stripeSubscriptionId = readString(input.stripeSubscriptionId);
  const stripeEventId = readString(input.stripeEventId);
  if (!stripeSubscriptionId || !stripeEventId) throw new Error("invalid_deleted_subscription_input");

  const { data: projection } = await input.supabase
    .from("commercial_stripe_subscriptions")
    .select("stripe_subscription_id,client_account_entitlement_id,account_id")
    .eq("stripe_subscription_id", stripeSubscriptionId)
    .maybeSingle<Row>();
  if (!projection?.stripe_subscription_id) throw new Error("commercial_subscription_missing");

  let accountId = readString(projection.account_id);
  const entitlementId = readString(projection.client_account_entitlement_id);
  if (!accountId && entitlementId) {
    const { data: entitlement } = await input.supabase
      .from("client_account_entitlements")
      .select("id,account_id")
      .eq("id", entitlementId)
      .maybeSingle<Row>();
    accountId = readString(entitlement?.account_id);
  }
  if (!accountId || !entitlementId) throw new Error("commercial_entitlement_missing");

  return executeCommercialAccountLifecycle({
    supabase: input.supabase,
    accountId,
    operationType: "cancel",
    idempotencyKey: `stripe-deleted:${stripeSubscriptionId}:${stripeEventId}`,
    reason: "stripe_subscription_deleted",
    actor: { actorType: "system", actorId: null, sourceSurface: "stripe_webhook" },
    knownEntitlementId: entitlementId,
    knownStripeSubscriptionId: stripeSubscriptionId,
    skipStripeCancel: true,
    env: input.env,
  });
}
