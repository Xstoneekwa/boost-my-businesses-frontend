import { createHash } from "node:crypto";

export const ARCHIVE_TRANSITION_CONTRACT = "archive_transition_v1";

export function deterministicArchiveIntentId(parts: readonly string[]) {
  const hex = createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export function archiveTransitionRequest(input: {
  tenantId: string;
  accountId: string;
  archiveIntentId: string;
  targetIds: string[];
  reason: string;
  source: string;
  actorType: "admin" | "client" | "system";
  actorId?: string | null;
  evidenceReference?: string | null;
  targetPatch?: Record<string, unknown>;
}) {
  return {
    contract: ARCHIVE_TRANSITION_CONTRACT,
    tenant_id: input.tenantId,
    account_id: input.accountId,
    archive_intent_id: input.archiveIntentId,
    target_ids: [...new Set(input.targetIds)].sort(),
    reason: input.reason,
    source: input.source,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    evidence_reference: input.evidenceReference ?? null,
    ...(input.targetPatch ? { target_patch: input.targetPatch } : {}),
  };
}
