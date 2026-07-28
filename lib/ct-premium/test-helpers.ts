import type {
  AccountId, BatchId, CtAccountRuntimeState, CtClock, CtCommercialState, CtIdGenerator,
  CtProposal, CtProposalBatch, ProposalId, SnapshotId, TenantId,
} from "./types.ts";

export const TENANT_A = "tenant_fixture_a" as TenantId;
export const ACCOUNT_A = "account_fixture_a" as AccountId;
export const ACCOUNT_B = "account_fixture_b" as AccountId;

export class FixedClock implements CtClock {
  private readonly value: string;
  constructor(value: string) { this.value = value; }
  now() { return new Date(this.value); }
}

export class SequenceIds implements CtIdGenerator {
  private sequence = 0;
  next(kind: "batch" | "proposal" | "snapshot" | "target") {
    this.sequence += 1;
    return `${kind}_fixture_${this.sequence}`;
  }
}

export function premiumCommercial(overrides: Partial<CtCommercialState> = {}): CtCommercialState {
  return { plan: "premium", premiumEntitlementActive: true, entitlementId: "entitlement_fixture_premium", entitlementExpiresAt: null, ...overrides };
}

export function readyRuntime(overrides: Partial<CtAccountRuntimeState> = {}): CtAccountRuntimeState {
  return { exists: true, ownershipActive: true, paused: false, canceled: false, campaignBlocked: false, lifecycleCompatible: true, eligibleTargetCount: 5, ...overrides };
}

export function reviewBatch(overrides: Partial<CtProposalBatch> = {}): CtProposalBatch {
  return {
    id: "batch_fixture_1" as BatchId,
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    snapshotId: "snapshot_fixture_1" as SnapshotId,
    entitlementId: "entitlement_fixture_premium",
    status: "ready_for_review",
    proposalIds: ["proposal_fixture_1" as ProposalId],
    reviewWindow: { startedAt: "2026-07-01T00:00:00.000Z", expiresAt: "2026-07-06T00:00:00.000Z", durationDays: 5 },
    idempotencyKey: "fixture_key",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    version: 1,
    frozenReason: null,
    ...overrides,
  };
}

export function pendingProposal(overrides: Partial<CtProposal> = {}): CtProposal {
  return {
    id: "proposal_fixture_1" as ProposalId,
    tenantId: TENANT_A,
    accountId: ACCOUNT_A,
    batchId: "batch_fixture_1" as BatchId,
    normalizedUsername: "synthetic_target",
    displayName: "Synthetic Target",
    followersCount: 2200,
    score: { version: "ct-premium-v1", total: 82, band: "recommended", breakdown: {}, positiveReasons: [], penalties: [], exclusionFlags: [] },
    status: "pending",
    decision: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}
