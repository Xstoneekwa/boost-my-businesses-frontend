import { assertCt } from "./errors.ts";
import { evaluateDecisionEligibility } from "./eligibility.ts";
import type {
  AccountId, CtAccountRuntimeState, CtBatchActionAvailability, CtBatchSummary, CtClock, CtCommercialState,
  CtDecisionSource, CtProposal, CtProposalBatch, CtProposalDecision, CtProposalEvent, ProposalId,
  TenantId,
} from "./types.ts";

export function summarizeBatch(proposals: readonly CtProposal[]): CtBatchSummary {
  const count = (statuses: readonly CtProposal["status"][]) => proposals.filter((item) => statuses.includes(item.status)).length;
  const pending = count(["pending"]);
  const accepted = count(["accepted", "auto_accepted", "activation_pending"]);
  const rejected = count(["rejected"]);
  const invalidated = count(["invalidated"]);
  const activated = count(["activated"]);
  const failed = count(["activation_failed"]);
  return { total: proposals.length, pending, accepted, rejected, invalidated, activated, failed, complete: proposals.length > 0 && pending === 0 && accepted === 0 };
}

export function calculateBatchActions(
  batch: CtProposalBatch,
  commercial: CtCommercialState,
  runtime: CtAccountRuntimeState,
  now: Date,
): CtBatchActionAvailability {
  const eligibility = evaluateDecisionEligibility(commercial, runtime);
  const reasons = [...eligibility.reasons];
  if (batch.status === "frozen") reasons.push("batch_frozen");
  if (batch.status === "canceled") reasons.push("batch_canceled");
  if (batch.reviewWindow && now.getTime() >= new Date(batch.reviewWindow.expiresAt).getTime()) reasons.push("review_expired");
  const reviewable = ["ready_for_review", "partially_reviewed"].includes(batch.status) && reasons.length === 0;
  return {
    canAccept: reviewable,
    canReject: reviewable,
    canBulkAccept: reviewable,
    canBulkReject: reviewable,
    canEvaluateTimeout: Boolean(batch.reviewWindow && now.getTime() >= new Date(batch.reviewWindow.expiresAt).getTime()),
    readOnly: !reviewable,
    reasons,
  };
}

export interface CtReviewDecisionResult { proposal: CtProposal; event: CtProposalEvent }

export function decideProposal(input: {
  batch: CtProposalBatch;
  proposal: CtProposal;
  requestedTenantId: TenantId;
  requestedAccountId: AccountId;
  outcome: "accepted" | "rejected";
  source: Extract<CtDecisionSource, "client" | "operator">;
  actorId: string;
  commercial: CtCommercialState;
  runtime: CtAccountRuntimeState;
  clock: CtClock;
}): CtReviewDecisionResult {
  assertCt(input.batch.tenantId === input.requestedTenantId && input.proposal.tenantId === input.requestedTenantId, "cross_account_access");
  assertCt(input.batch.accountId === input.requestedAccountId && input.proposal.accountId === input.requestedAccountId, "cross_account_access");
  assertCt(input.proposal.batchId === input.batch.id, "cross_account_access");
  assertCt(input.batch.status !== "frozen", "batch_frozen");
  assertCt(input.batch.status !== "canceled", "batch_canceled");
  assertCt(input.proposal.status === "pending", "proposal_not_pending");
  const now = input.clock.now();
  const actions = calculateBatchActions(input.batch, input.commercial, input.runtime, now);
  assertCt(input.outcome === "accepted" ? actions.canAccept : actions.canReject, actions.reasons[0] ?? "invalid_transition");
  const decidedAt = now.toISOString();
  const decision: CtProposalDecision = {
    source: input.source,
    outcome: input.outcome,
    actorId: input.actorId,
    decidedAt,
    reasonCode: input.outcome === "accepted" ? "client_accepted" : "client_rejected",
  };
  const proposal: CtProposal = Object.freeze({ ...input.proposal, status: input.outcome, decision, updatedAt: decidedAt, version: input.proposal.version + 1 });
  return {
    proposal,
    event: { type: `proposal.${input.outcome}`, tenantId: proposal.tenantId, accountId: proposal.accountId, batchId: proposal.batchId, proposalId: proposal.id, actorId: input.actorId, source: input.source, occurredAt: decidedAt, metadata: {} },
  };
}

export function decideMany(input: Omit<Parameters<typeof decideProposal>[0], "proposal"> & { proposals: readonly CtProposal[]; proposalIds: readonly ProposalId[] }) {
  const requested = new Set(input.proposalIds);
  const results = input.proposals.filter((proposal) => requested.has(proposal.id)).map((proposal) => decideProposal({ ...input, proposal }));
  assertCt(results.length === requested.size, "cross_account_access");
  return results;
}
