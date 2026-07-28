import type {
  AccountId, BatchId, CtAccountRuntimeState, CtCommercialState, CtProposal, CtProposalBatch,
  CtProposalEvent, CtTargetingCriteriaSnapshot, ProposalId, SnapshotId, TargetId, TenantId,
} from "./types.ts";

export interface CtProposalRepository {
  listByBatch(tenantId: TenantId, accountId: AccountId, batchId: BatchId): Promise<readonly CtProposal[]>;
  save(proposal: CtProposal, expectedVersion: number): Promise<void>;
}
export interface CtSnapshotRepository {
  get(tenantId: TenantId, accountId: AccountId, snapshotId: SnapshotId): Promise<CtTargetingCriteriaSnapshot | null>;
  save(snapshot: CtTargetingCriteriaSnapshot): Promise<void>;
}
export interface CtBatchRepository {
  list(tenantId: TenantId, accountId: AccountId): Promise<readonly CtProposalBatch[]>;
  get(tenantId: TenantId, accountId: AccountId, batchId: BatchId): Promise<CtProposalBatch | null>;
  save(batch: CtProposalBatch, expectedVersion: number): Promise<void>;
  appendEvents(events: readonly CtProposalEvent[]): Promise<void>;
}
export interface CtTargetReader {
  listActiveUsernames(tenantId: TenantId, accountId: AccountId): Promise<readonly string[]>;
}
export interface CtBlacklistReader {
  listBlacklistedUsernames(tenantId: TenantId, accountId: AccountId): Promise<readonly string[]>;
}
export interface CtEntitlementReader {
  readCommercialState(tenantId: TenantId, accountId: AccountId): Promise<CtCommercialState>;
  readRuntimeState(tenantId: TenantId, accountId: AccountId): Promise<CtAccountRuntimeState>;
}
export interface CtNotificationIntent {
  tenantId: TenantId;
  accountId: AccountId;
  batchId: BatchId;
  kind: "batch_ready" | "review_expiring" | "batch_completed";
  createdAt: string;
}
export interface CtEmailIntent extends CtNotificationIntent {
  locale: "fr" | "en";
}
export interface CtNotificationPort { record(intent: CtNotificationIntent): Promise<void> }
export interface CtEmailPort { record(intent: CtEmailIntent): Promise<void> }
export interface CtActivationPort {
  activate(input: { tenantId: TenantId; accountId: AccountId; batchId: BatchId; proposalId: ProposalId; normalizedUsername: string; idempotencyKey: string }): Promise<{ ok: true; targetId: TargetId } | { ok: false; reasonCode: string }>;
}

export interface CtLifecyclePersistencePort {
  recompute(input: {
    accountId: AccountId;
    targetId: TargetId;
    estimatedExploitableAudience: number | null;
    denominatorSource: string;
    denominatorVersion: string;
    confidence: "high" | "medium" | "low" | "unknown";
    assessmentKey: string;
    assessedAt: string;
  }): Promise<Readonly<Record<string, unknown>>>;
}

export interface CtTargetPerformanceReader {
  readLatest(tenantId: TenantId, accountId: AccountId, targetId: TargetId): Promise<Readonly<Record<string, unknown>> | null>;
}
