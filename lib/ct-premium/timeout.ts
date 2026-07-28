import { calculateBatchActions, summarizeBatch } from "./review.ts";
import { transitionBatch, transitionProposal } from "./state-machine.ts";
import type { CtAccountRuntimeState, CtClock, CtCommercialState, CtProposal, CtProposalBatch, CtProposalEvent, CtRevalidationResult } from "./types.ts";

export interface CtExpiredBatchEvaluation {
  batch: CtProposalBatch;
  proposals: readonly CtProposal[];
  actions: readonly { proposalId: string; action: "auto_accept" | "invalidate"; reasonCode: string }[];
  events: readonly CtProposalEvent[];
  summary: ReturnType<typeof summarizeBatch>;
  blockedReasons: readonly string[];
  idempotent: boolean;
}

export function evaluateExpiredBatch(input: {
  batch: CtProposalBatch;
  proposals: readonly CtProposal[];
  commercial: CtCommercialState;
  runtime: CtAccountRuntimeState;
  revalidation: readonly CtRevalidationResult[];
  clock: CtClock;
}): CtExpiredBatchEvaluation {
  const now = input.clock.now();
  const availability = calculateBatchActions(input.batch, input.commercial, input.runtime, now);
  const commercialBlocks = availability.reasons.filter((reason) => reason !== "review_expired");
  if (commercialBlocks.length || input.batch.status === "frozen" || input.batch.status === "canceled") {
    return { batch: input.batch, proposals: input.proposals, actions: [], events: [], summary: summarizeBatch(input.proposals), blockedReasons: commercialBlocks, idempotent: true };
  }
  if (!input.batch.reviewWindow || now.getTime() < new Date(input.batch.reviewWindow.expiresAt).getTime()) {
    return { batch: input.batch, proposals: input.proposals, actions: [], events: [], summary: summarizeBatch(input.proposals), blockedReasons: [], idempotent: true };
  }
  if (["auto_validation_pending", "activating", "completed"].includes(input.batch.status) && !input.proposals.some((proposal) => proposal.status === "pending")) {
    return { batch: input.batch, proposals: input.proposals, actions: [], events: [], summary: summarizeBatch(input.proposals), blockedReasons: [], idempotent: true };
  }
  let batch = input.batch;
  const events: CtProposalEvent[] = [];
  if (["ready_for_review", "partially_reviewed"].includes(batch.status)) {
    const expired = transitionBatch({ batch, action: "expireReview", actorId: "system", source: "system_timeout", clock: input.clock });
    batch = expired.batch;
    events.push(...expired.events);
  }
  if (batch.status === "review_expired") {
    const started = transitionBatch({ batch, action: "startAutoValidation", actorId: "system", source: "system_timeout", clock: input.clock });
    batch = started.batch;
    events.push(...started.events);
  }
  const validations = new Map(input.revalidation.map((entry) => [entry.proposalId, entry]));
  const actions: Array<{ proposalId: string; action: "auto_accept" | "invalidate"; reasonCode: string }> = [];
  const proposals = input.proposals.map((proposal) => {
    if (proposal.status !== "pending") return proposal;
    const validation = validations.get(proposal.id);
    const eligible = validation?.eligible === true;
    const action = eligible ? "autoAcceptEligible" as const : "invalidateProposal" as const;
    const reasonCode = validation?.reasonCode ?? "revalidation_failed";
    const transitioned = transitionProposal({ batch, proposal, action, actorId: "system", source: eligible ? "system_timeout" : "system_revalidation", clock: input.clock, reasonCode });
    events.push(...transitioned.events);
    actions.push({ proposalId: proposal.id, action: eligible ? "auto_accept" : "invalidate", reasonCode });
    return transitioned.proposal;
  });
  return { batch, proposals, actions, events, summary: summarizeBatch(proposals), blockedReasons: [], idempotent: actions.length === 0 };
}
