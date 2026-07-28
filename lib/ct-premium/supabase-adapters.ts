import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CtActivationPort,
  CtBatchRepository,
  CtEmailIntent,
  CtEmailPort,
  CtLifecyclePersistencePort,
  CtNotificationIntent,
  CtNotificationPort,
  CtProposalRepository,
  CtSnapshotRepository,
  CtTargetPerformanceReader,
} from "./ports.ts";
import type {
  AccountId,
  BatchId,
  CtProposal,
  CtProposalBatch,
  CtProposalEvent,
  CtTargetingCriteriaSnapshot,
  ProposalId,
  SnapshotId,
  TargetId,
  TenantId,
} from "./types.ts";

export interface CtSupabaseAdapterOptions {
  enabled: boolean;
}

function requireEnabled(options: CtSupabaseAdapterOptions) {
  if (!options.enabled) throw new Error("ct_database_adapter_disabled");
}

function rpcData<T>(data: T | null, error: { message: string } | null): T {
  if (error) throw new Error(`ct_database_rpc_failed:${error.message}`);
  if (data === null) throw new Error("ct_database_rpc_empty_result");
  return data;
}

/** Infrastructure-only adapter. It is deliberately not imported by any runtime composition root. */
export class SupabaseCtCommandAdapter implements CtActivationPort, CtLifecyclePersistencePort {
  private readonly client: SupabaseClient;
  private readonly options: CtSupabaseAdapterOptions;
  constructor(client: SupabaseClient, options: CtSupabaseAdapterOptions) {
    this.client = client;
    this.options = options;
  }

  async activate(input: {
    tenantId: TenantId;
    accountId: AccountId;
    batchId: BatchId;
    proposalId: ProposalId;
    normalizedUsername: string;
    idempotencyKey: string;
  }) {
    requireEnabled(this.options);
    const { data, error } = await this.client.rpc("ct_activate_premium_proposal_v1", {
      p_account_id: input.accountId,
      p_proposal_id: input.proposalId,
      p_actor_auth_user_id: null,
      p_idempotency_key: input.idempotencyKey,
    });
    const result = rpcData<Record<string, unknown>>(data as Record<string, unknown> | null, error);
    const targetId = result.targetId;
    return typeof targetId === "string"
      ? { ok: true as const, targetId: targetId as TargetId }
      : { ok: false as const, reasonCode: "activation_result_invalid" };
  }

  async recompute(input: {
    accountId: AccountId;
    targetId: TargetId;
    estimatedExploitableAudience: number | null;
    denominatorSource: string;
    denominatorVersion: string;
    confidence: "high" | "medium" | "low" | "unknown";
    assessmentKey: string;
    assessedAt: string;
  }) {
    requireEnabled(this.options);
    const { data, error } = await this.client.rpc("ct_recompute_target_lifecycle_v1", {
      p_account_id: input.accountId,
      p_target_id: input.targetId,
      p_estimated_exploitable_audience: input.estimatedExploitableAudience,
      p_denominator_source: input.denominatorSource,
      p_denominator_version: input.denominatorVersion,
      p_confidence: input.confidence,
      p_assessment_key: input.assessmentKey,
      p_assessed_at: input.assessedAt,
    });
    return rpcData<Record<string, unknown>>(data as Record<string, unknown> | null, error);
  }
}

export class SupabaseCtReadRepository {
  private readonly client: SupabaseClient;
  private readonly options: CtSupabaseAdapterOptions;
  constructor(client: SupabaseClient, options: CtSupabaseAdapterOptions) {
    this.client = client;
    this.options = options;
  }

  async listByBatch(tenantId: TenantId, accountId: AccountId, batchId: BatchId): Promise<readonly CtProposal[]> {
    requireEnabled(this.options);
    const { data, error } = await this.client.from("ct_proposals").select("*")
      .eq("tenant_id", tenantId).eq("account_id", accountId).eq("batch_id", batchId).order("created_at");
    if (error) throw new Error(`ct_database_read_failed:${error.message}`);
    return (data ?? []).map((row) => ({
      id: row.id as ProposalId,
      tenantId: row.tenant_id as TenantId,
      accountId: row.account_id as AccountId,
      batchId: row.batch_id as BatchId,
      normalizedUsername: row.normalized_username,
      displayName: row.display_username,
      followersCount: typeof row.candidate_data?.followersCount === "number" ? row.candidate_data.followersCount : null,
      score: {
        version: row.scoring_version,
        total: Number(row.score),
        band: Number(row.score) >= 70 ? "recommended" : Number(row.score) >= 40 ? "review" : "reject",
        breakdown: row.score_breakdown ?? {}, positiveReasons: [], penalties: [], exclusionFlags: row.exclusion_reasons ?? [],
      },
      status: row.status,
      decision: row.decided_at ? {
        source: row.decision_actor_type === "system_timeout" ? "system_timeout" : "client",
        outcome: row.status,
        actorId: row.decision_actor_id ?? "system",
        decidedAt: row.decided_at,
        reasonCode: row.status,
      } : null,
      createdAt: row.created_at, updatedAt: row.updated_at, version: row.version,
    })) as readonly CtProposal[];
  }

  async getSnapshot(tenantId: TenantId, accountId: AccountId, id: SnapshotId) {
    requireEnabled(this.options);
    const { data, error } = await this.client.from("ct_targeting_criteria_snapshots").select("*").eq("tenant_id",tenantId).eq("account_id",accountId).eq("id",id).maybeSingle();
    if (error) throw new Error(`ct_database_read_failed:${error.message}`);
    return data as unknown as CtTargetingCriteriaSnapshot | null;
  }

  async getBatch(tenantId: TenantId, accountId: AccountId, id: BatchId) {
    requireEnabled(this.options);
    const { data, error } = await this.client.from("ct_proposal_batches").select("*").eq("tenant_id",tenantId).eq("account_id",accountId).eq("id",id).maybeSingle();
    if (error) throw new Error(`ct_database_read_failed:${error.message}`);
    return data as unknown as CtProposalBatch | null;
  }

  async list(tenantId: TenantId, accountId: AccountId): Promise<readonly CtProposalBatch[]> {
    requireEnabled(this.options);
    const { data, error } = await this.client.from("ct_proposal_batches").select("*").eq("tenant_id",tenantId).eq("account_id",accountId).order("created_at",{ascending:false});
    if (error) throw new Error(`ct_database_read_failed:${error.message}`);
    return (data ?? []) as unknown as readonly CtProposalBatch[];
  }

  async save(_value: CtProposal | CtProposalBatch | CtTargetingCriteriaSnapshot, _expectedVersion?: number): Promise<void> {
    requireEnabled(this.options);
    throw new Error("ct_direct_save_forbidden_use_transactional_rpc");
  }

  async appendEvents(_events: readonly CtProposalEvent[]): Promise<void> {
    requireEnabled(this.options);
    throw new Error("ct_direct_event_append_forbidden_use_transactional_rpc");
  }

  async readLatest(tenantId: TenantId, accountId: AccountId, targetId: TargetId) {
    requireEnabled(this.options);
    const { data, error } = await this.client.from("ct_target_performance_aggregates").select("*")
      .eq("tenant_id",tenantId).eq("account_id",accountId).eq("source_target_id",targetId)
      .order("window_end_business_date",{ascending:false}).limit(1).maybeSingle();
    if (error) throw new Error(`ct_database_read_failed:${error.message}`);
    return data as Readonly<Record<string, unknown>> | null;
  }
}

export function createCtSnapshotRepository(adapter: SupabaseCtReadRepository): CtSnapshotRepository {
  return {
    get: (tenantId,accountId,snapshotId) => adapter.getSnapshot(tenantId,accountId,snapshotId),
    save: (snapshot) => adapter.save(snapshot),
  };
}

export function createCtBatchRepository(adapter: SupabaseCtReadRepository): CtBatchRepository {
  return {
    list: (tenantId,accountId) => adapter.list(tenantId,accountId),
    get: (tenantId,accountId,batchId) => adapter.getBatch(tenantId,accountId,batchId),
    save: (batch,expectedVersion) => adapter.save(batch,expectedVersion),
    appendEvents: (events) => adapter.appendEvents(events),
  };
}

export function createCtProposalRepository(adapter: SupabaseCtReadRepository): CtProposalRepository {
  return {
    listByBatch: (tenantId,accountId,batchId) => adapter.listByBatch(tenantId,accountId,batchId),
    save: (proposal,expectedVersion) => adapter.save(proposal,expectedVersion),
  };
}

export function createCtTargetPerformanceReader(adapter: SupabaseCtReadRepository): CtTargetPerformanceReader {
  return { readLatest: (tenantId,accountId,targetId) => adapter.readLatest(tenantId,accountId,targetId) };
}

export class SupabaseCtIntentAdapter implements CtNotificationPort, CtEmailPort {
  private readonly client: SupabaseClient;
  private readonly options: CtSupabaseAdapterOptions;
  constructor(client: SupabaseClient, options: CtSupabaseAdapterOptions) {
    this.client = client;
    this.options = options;
  }
  async record(intent: CtNotificationIntent | CtEmailIntent): Promise<void> {
    requireEnabled(this.options);
    if ("locale" in intent) throw new Error("ct_email_send_intent_disabled_contract_reference_only");
    const { error } = await this.client.from("client_account_notifications").insert({
      client_id: intent.tenantId,
      account_id: intent.accountId,
      category: intent.kind === "batch_ready" ? "premium_ct_batch_ready" : "premium_ct_review_required",
      notification_key: `ct:${intent.kind}:${intent.batchId}`,
      action_required: true,
      action_ref_type: "proposal_batch",
      action_ref_id: intent.batchId,
      metadata_safe: { source: "ct_premium_adapter" },
    });
    if (error) throw new Error(`ct_notification_intent_failed:${error.message}`);
  }
}
