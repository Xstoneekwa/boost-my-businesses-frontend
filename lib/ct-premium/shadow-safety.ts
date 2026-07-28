import { CtDomainError } from "./errors.ts";
import type { CtProposalBatch } from "./types.ts";
import type { CtShadowBatch } from "./shadow-types.ts";

export function assertActivatableBatch(batch: CtProposalBatch | CtShadowBatch): asserts batch is CtProposalBatch {
  if ("mode" in batch && batch.mode === "shadow") throw new CtDomainError("activation_blocked");
}
