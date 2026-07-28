import { CtDomainError, assertCt } from "./errors.ts";
import type { CtBatchStatus, CtClock, CtDecisionSource, CtProposal, CtProposalBatch, CtProposalEvent, CtProposalStatus } from "./types.ts";

export type CtBatchAction =
  | "startPreparation" | "markReady" | "expireReview" | "startAutoValidation"
  | "startActivation" | "completeBatch" | "freezeBatch" | "cancelBatch" | "failBatch";
export type CtProposalAction =
  | "acceptProposal" | "rejectProposal" | "autoAcceptEligible" | "invalidateProposal"
  | "markActivationPending" | "markActivated" | "markActivationFailed";

export const CT_BATCH_TRANSITIONS: Readonly<Record<CtBatchAction, readonly CtBatchStatus[]>> = Object.freeze({
  startPreparation: ["preparing"],
  markReady: ["preparing"],
  expireReview: ["ready_for_review", "partially_reviewed"],
  startAutoValidation: ["review_expired"],
  startActivation: ["ready_for_review", "partially_reviewed", "auto_validation_pending"],
  completeBatch: ["activating", "partially_reviewed", "auto_validation_pending"],
  freezeBatch: ["preparing", "ready_for_review", "partially_reviewed", "review_expired", "auto_validation_pending"],
  cancelBatch: ["preparing", "ready_for_review", "partially_reviewed", "review_expired", "auto_validation_pending", "frozen"],
  failBatch: ["preparing", "auto_validation_pending", "activating"],
});

const BATCH_DESTINATION: Record<CtBatchAction, CtBatchStatus> = {
  startPreparation: "preparing",
  markReady: "ready_for_review",
  expireReview: "review_expired",
  startAutoValidation: "auto_validation_pending",
  startActivation: "activating",
  completeBatch: "completed",
  freezeBatch: "frozen",
  cancelBatch: "canceled",
  failBatch: "failed",
};

export const CT_PROPOSAL_TRANSITIONS: Readonly<Record<CtProposalAction, readonly CtProposalStatus[]>> = Object.freeze({
  acceptProposal: ["pending"],
  rejectProposal: ["pending"],
  autoAcceptEligible: ["pending"],
  invalidateProposal: ["pending"],
  markActivationPending: ["accepted", "auto_accepted"],
  markActivated: ["activation_pending"],
  markActivationFailed: ["activation_pending"],
});

const PROPOSAL_DESTINATION: Record<CtProposalAction, CtProposalStatus> = {
  acceptProposal: "accepted",
  rejectProposal: "rejected",
  autoAcceptEligible: "auto_accepted",
  invalidateProposal: "invalidated",
  markActivationPending: "activation_pending",
  markActivated: "activated",
  markActivationFailed: "activation_failed",
};

function eventFor(batch: CtProposalBatch, type: string, actorId: string, source: CtDecisionSource, occurredAt: string, proposal?: CtProposal, reasonCode?: string): CtProposalEvent {
  return { type, tenantId: batch.tenantId, accountId: batch.accountId, batchId: batch.id, proposalId: proposal?.id, actorId, source, occurredAt, metadata: reasonCode ? { reasonCode } : {} };
}

export function transitionBatch(input: { batch: CtProposalBatch; action: CtBatchAction; actorId: string; source: CtDecisionSource; clock: CtClock; reasonCode?: string }) {
  assertCt(CT_BATCH_TRANSITIONS[input.action].includes(input.batch.status), "invalid_transition");
  const occurredAt = input.clock.now().toISOString();
  const batch = Object.freeze({
    ...input.batch,
    status: BATCH_DESTINATION[input.action],
    updatedAt: occurredAt,
    version: input.batch.version + (input.action === "startPreparation" ? 0 : 1),
    frozenReason: input.action === "freezeBatch" ? input.reasonCode ?? "commercial_state_changed" : input.batch.frozenReason,
  });
  return { batch, events: [eventFor(batch, `batch.${batch.status}`, input.actorId, input.source, occurredAt, undefined, input.reasonCode)] };
}

export function transitionProposal(input: { batch: CtProposalBatch; proposal: CtProposal; action: CtProposalAction; actorId: string; source: CtDecisionSource; clock: CtClock; reasonCode: string }) {
  assertCt(input.proposal.batchId === input.batch.id && input.proposal.accountId === input.batch.accountId, "cross_account_access");
  if (!CT_PROPOSAL_TRANSITIONS[input.action].includes(input.proposal.status)) {
    throw new CtDomainError("proposal_not_pending", `Cannot ${input.action} from ${input.proposal.status}`);
  }
  const occurredAt = input.clock.now().toISOString();
  const status = PROPOSAL_DESTINATION[input.action];
  const decision = ["accepted", "rejected", "auto_accepted", "invalidated"].includes(status)
    ? { source: input.source, outcome: status as "accepted" | "rejected" | "auto_accepted" | "invalidated", actorId: input.actorId, decidedAt: occurredAt, reasonCode: input.reasonCode }
    : input.proposal.decision;
  const proposal = Object.freeze({ ...input.proposal, status, decision, updatedAt: occurredAt, version: input.proposal.version + 1 });
  return { proposal, events: [eventFor(input.batch, `proposal.${status}`, input.actorId, input.source, occurredAt, proposal, input.reasonCode)] };
}
