import type { CtAccountRuntimeState, CtClock, CtCommercialState, CtPlan, CtProposalBatch, CtProposalEvent } from "./types.ts";

export type CtCommercialTransitionKind = "premium_active" | "downgrade_pro" | "downgrade_growth" | "pause" | "cancel" | "reactivate_premium" | "entitlement_expired" | "entitlement_replaced";

export interface CtCommercialTransitionResult {
  commercial: CtCommercialState;
  runtime: CtAccountRuntimeState;
  batch: CtProposalBatch;
  actionsAllowed: boolean;
  blockingReasons: readonly string[];
  requiresNewBatch: boolean;
  events: readonly CtProposalEvent[];
}

export function applyCommercialTransition(input: {
  kind: CtCommercialTransitionKind;
  batch: CtProposalBatch;
  commercial: CtCommercialState;
  runtime: CtAccountRuntimeState;
  clock: CtClock;
  newEntitlementId?: string;
}): CtCommercialTransitionResult {
  const occurredAt = input.clock.now().toISOString();
  let commercial = { ...input.commercial };
  let runtime = { ...input.runtime };
  let status = input.batch.status;
  let frozenReason = input.batch.frozenReason;
  let actionsAllowed = true;
  let requiresNewBatch = false;
  const blockingReasons: string[] = [];
  const freeze = (reason: string) => { status = "frozen"; frozenReason = reason; actionsAllowed = false; blockingReasons.push(reason); };
  if (input.kind === "downgrade_pro" || input.kind === "downgrade_growth") {
    commercial = { ...commercial, plan: input.kind === "downgrade_pro" ? "pro" : "growth", premiumEntitlementActive: false };
    freeze("premium_required");
  } else if (input.kind === "pause") {
    runtime = { ...runtime, paused: true };
    freeze("account_paused");
  } else if (input.kind === "cancel") {
    runtime = { ...runtime, canceled: true };
    status = "canceled";
    actionsAllowed = false;
    blockingReasons.push("account_canceled");
  } else if (input.kind === "entitlement_expired") {
    commercial = { ...commercial, premiumEntitlementActive: false };
    freeze("premium_required");
  } else if (input.kind === "entitlement_replaced") {
    commercial = { ...commercial, entitlementId: input.newEntitlementId ?? null, premiumEntitlementActive: Boolean(input.newEntitlementId), plan: input.newEntitlementId ? "premium" : commercial.plan };
    freeze("entitlement_replaced");
    requiresNewBatch = Boolean(input.newEntitlementId && runtime.eligibleTargetCount <= 5);
  } else if (input.kind === "reactivate_premium") {
    commercial = { ...commercial, plan: "premium", premiumEntitlementActive: true, entitlementId: input.newEntitlementId ?? commercial.entitlementId };
    runtime = { ...runtime, paused: false, canceled: false };
    actionsAllowed = false;
    blockingReasons.push("old_batch_read_only");
    requiresNewBatch = runtime.eligibleTargetCount <= 5;
  }
  const batch = Object.freeze({ ...input.batch, status, frozenReason, updatedAt: occurredAt, version: input.batch.version + (status === input.batch.status ? 0 : 1) });
  const event: CtProposalEvent = { type: `commercial.${input.kind}`, tenantId: batch.tenantId, accountId: batch.accountId, batchId: batch.id, actorId: "system", source: "system_revalidation", occurredAt, metadata: { previousPlan: input.commercial.plan, nextPlan: commercial.plan, requiresNewBatch } };
  return { commercial, runtime, batch, actionsAllowed, blockingReasons, requiresNewBatch, events: [event] };
}

export function planForTransition(kind: CtCommercialTransitionKind): CtPlan | null {
  if (kind === "downgrade_pro") return "pro";
  if (kind === "downgrade_growth") return "growth";
  if (kind === "reactivate_premium" || kind === "premium_active") return "premium";
  return null;
}
