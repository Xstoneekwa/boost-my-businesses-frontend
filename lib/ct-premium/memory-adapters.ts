import { CtDomainError } from "./errors.ts";
import type {
  CtActivationPort, CtBatchRepository, CtBlacklistReader, CtEmailIntent, CtEmailPort, CtEntitlementReader,
  CtNotificationIntent, CtNotificationPort, CtProposalRepository, CtSnapshotRepository, CtTargetReader,
} from "./ports.ts";
import type {
  AccountId, BatchId, CtAccountRuntimeState, CtCommercialState, CtProposal, CtProposalBatch,
  CtProposalEvent, CtTargetingCriteriaSnapshot, ProposalId, SnapshotId, TargetId, TenantId,
} from "./types.ts";

const scopeKey = (tenantId: TenantId, accountId: AccountId) => `${tenantId}::${accountId}`;
const entityKey = (tenantId: TenantId, accountId: AccountId, id: string) => `${scopeKey(tenantId, accountId)}::${id}`;

export class InMemoryCtStore implements CtProposalRepository, CtSnapshotRepository, CtBatchRepository, CtTargetReader, CtBlacklistReader, CtEntitlementReader {
  readonly events: CtProposalEvent[] = [];
  private readonly proposals = new Map<string, CtProposal>();
  private readonly snapshots = new Map<string, CtTargetingCriteriaSnapshot>();
  private readonly batches = new Map<string, CtProposalBatch>();
  private readonly activeTargets = new Map<string, readonly string[]>();
  private readonly blacklists = new Map<string, readonly string[]>();
  private readonly commercial = new Map<string, CtCommercialState>();
  private readonly runtime = new Map<string, CtAccountRuntimeState>();

  seedScope(tenantId: TenantId, accountId: AccountId, input: { activeTargets?: readonly string[]; blacklist?: readonly string[]; commercial: CtCommercialState; runtime: CtAccountRuntimeState }) {
    const key = scopeKey(tenantId, accountId);
    this.activeTargets.set(key, [...(input.activeTargets ?? [])]);
    this.blacklists.set(key, [...(input.blacklist ?? [])]);
    this.commercial.set(key, { ...input.commercial });
    this.runtime.set(key, { ...input.runtime });
  }

  async listByBatch(tenantId: TenantId, accountId: AccountId, batchId: BatchId) {
    return [...this.proposals.values()].filter((proposal) => proposal.tenantId === tenantId && proposal.accountId === accountId && proposal.batchId === batchId);
  }
  async save(entity: CtProposal | CtProposalBatch | CtTargetingCriteriaSnapshot, expectedVersion?: number) {
    if ("normalizedUsername" in entity) {
      const key = entityKey(entity.tenantId, entity.accountId, entity.id);
      const existing = this.proposals.get(key);
      if ((existing?.version ?? 0) !== (expectedVersion ?? 0)) throw new CtDomainError("idempotency_conflict", "proposal_version_conflict");
      this.proposals.set(key, structuredClone(entity));
      return;
    }
    if ("proposalIds" in entity) {
      const key = entityKey(entity.tenantId, entity.accountId, entity.id);
      const existing = this.batches.get(key);
      if ((existing?.version ?? 0) !== (expectedVersion ?? 0)) throw new CtDomainError("idempotency_conflict", "batch_version_conflict");
      this.batches.set(key, structuredClone(entity));
      return;
    }
    this.snapshots.set(entityKey(entity.tenantId, entity.accountId, entity.id), structuredClone(entity));
  }
  async list(tenantId: TenantId, accountId: AccountId) {
    return [...this.batches.values()].filter((batch) => batch.tenantId === tenantId && batch.accountId === accountId);
  }
  async get(tenantId: TenantId, accountId: AccountId, id: BatchId): Promise<CtProposalBatch | null>;
  async get(tenantId: TenantId, accountId: AccountId, id: SnapshotId): Promise<CtTargetingCriteriaSnapshot | null>;
  async get(tenantId: TenantId, accountId: AccountId, id: BatchId | SnapshotId): Promise<CtProposalBatch | CtTargetingCriteriaSnapshot | null> {
    const key = entityKey(tenantId, accountId, id);
    return this.batches.get(key) ?? this.snapshots.get(key) ?? null;
  }
  async appendEvents(events: readonly CtProposalEvent[]) { this.events.push(...structuredClone(events)); }
  async listActiveUsernames(tenantId: TenantId, accountId: AccountId) { return this.activeTargets.get(scopeKey(tenantId, accountId)) ?? []; }
  async listBlacklistedUsernames(tenantId: TenantId, accountId: AccountId) { return this.blacklists.get(scopeKey(tenantId, accountId)) ?? []; }
  async readCommercialState(tenantId: TenantId, accountId: AccountId) {
    const value = this.commercial.get(scopeKey(tenantId, accountId));
    if (!value) throw new CtDomainError("account_not_found");
    return structuredClone(value);
  }
  async readRuntimeState(tenantId: TenantId, accountId: AccountId) {
    const value = this.runtime.get(scopeKey(tenantId, accountId));
    if (!value) throw new CtDomainError("account_not_found");
    return structuredClone(value);
  }
}

export class InMemoryCtNotificationPort implements CtNotificationPort {
  readonly intents: CtNotificationIntent[] = [];
  async record(intent: CtNotificationIntent) { this.intents.push(structuredClone(intent)); }
}
export class InMemoryCtEmailPort implements CtEmailPort {
  readonly intents: CtEmailIntent[] = [];
  async record(intent: CtEmailIntent) { this.intents.push(structuredClone(intent)); }
}
export class InMemoryCtActivationPort implements CtActivationPort {
  readonly attempts: Array<{ tenantId: TenantId; accountId: AccountId; batchId: BatchId; proposalId: ProposalId; normalizedUsername: string; idempotencyKey: string }> = [];
  private readonly outcomes = new Map<string, { ok: true; targetId: TargetId } | { ok: false; reasonCode: string }>();
  setOutcome(proposalId: ProposalId, outcome: { ok: true; targetId: TargetId } | { ok: false; reasonCode: string }) { this.outcomes.set(proposalId, outcome); }
  async activate(input: { tenantId: TenantId; accountId: AccountId; batchId: BatchId; proposalId: ProposalId; normalizedUsername: string; idempotencyKey: string }) {
    const previous = this.attempts.find((attempt) => attempt.idempotencyKey === input.idempotencyKey);
    if (!previous) this.attempts.push(structuredClone(input));
    return this.outcomes.get(input.proposalId) ?? { ok: true as const, targetId: `target_fixture_${input.proposalId}` as TargetId };
  }
}
