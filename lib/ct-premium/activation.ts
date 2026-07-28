import { assertCt } from "./errors.ts";
import { evaluateDecisionEligibility } from "./eligibility.ts";
import type { CtActivationPort } from "./ports.ts";
import { transitionProposal } from "./state-machine.ts";
import type { CtAccountRuntimeState, CtClock, CtCommercialState, CtProposal, CtProposalBatch, CtProposalEvent } from "./types.ts";

export async function activateProposal(input: {
  batch: CtProposalBatch;
  proposal: CtProposal;
  commercial: CtCommercialState;
  runtime: CtAccountRuntimeState;
  port: CtActivationPort;
  clock: CtClock;
}): Promise<{ proposal: CtProposal; events: readonly CtProposalEvent[]; targetId: string | null }> {
  const eligibility = evaluateDecisionEligibility(input.commercial, input.runtime);
  assertCt(eligibility.eligible, eligibility.reasons[0] ?? "activation_blocked");
  assertCt(input.proposal.accountId === input.batch.accountId && input.proposal.batchId === input.batch.id, "cross_account_access");
  assertCt(["accepted", "auto_accepted"].includes(input.proposal.status), "activation_blocked");
  const pending = transitionProposal({ batch: input.batch, proposal: input.proposal, action: "markActivationPending", actorId: "system", source: "system_revalidation", clock: input.clock, reasonCode: "activation_started" });
  const result = await input.port.activate({
    tenantId: input.batch.tenantId,
    accountId: input.batch.accountId,
    batchId: input.batch.id,
    proposalId: input.proposal.id,
    normalizedUsername: input.proposal.normalizedUsername,
    idempotencyKey: `${input.batch.idempotencyKey}:${input.proposal.id}`,
  });
  const completed = transitionProposal({ batch: input.batch, proposal: pending.proposal, action: result.ok ? "markActivated" : "markActivationFailed", actorId: "system", source: "system_revalidation", clock: input.clock, reasonCode: result.ok ? "mock_activation_succeeded" : result.reasonCode });
  return { proposal: completed.proposal, events: [...pending.events, ...completed.events], targetId: result.ok ? result.targetId : null };
}
