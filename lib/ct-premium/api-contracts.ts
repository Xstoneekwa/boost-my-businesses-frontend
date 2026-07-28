import type { AccountId, BatchId, CtBatchActionAvailability, CtBatchSummary, CtDomainErrorCode, CtProposal, CtProposalBatch, ProposalId, TenantId } from "./types.ts";

export const CT_PREMIUM_API_CONTRACT_VERSION = "ct-premium-api-v1";
export const CT_PREMIUM_API_PATHS = Object.freeze({
  status: "/api/ct-premium/accounts/:accountId/status",
  batches: "/api/ct-premium/accounts/:accountId/batches",
  batch: "/api/ct-premium/accounts/:accountId/batches/:batchId",
  accept: "/api/ct-premium/accounts/:accountId/batches/:batchId/accept",
  reject: "/api/ct-premium/accounts/:accountId/batches/:batchId/reject",
  bulkAccept: "/api/ct-premium/accounts/:accountId/batches/:batchId/bulk-accept",
  bulkReject: "/api/ct-premium/accounts/:accountId/batches/:batchId/bulk-reject",
  evaluateTimeout: "/api/ct-premium/accounts/:accountId/batches/:batchId/evaluate-timeout",
});

export interface CtApiScopeDto { tenant_id: TenantId; account_id: AccountId }
export interface CtApiErrorDto { ok: false; error: { code: CtDomainErrorCode; message: string; retryable: boolean } }
export interface CtApiSuccessDto<T> { ok: true; data: T; contract_version: typeof CT_PREMIUM_API_CONTRACT_VERSION }
export type CtApiResponseDto<T> = CtApiSuccessDto<T> | CtApiErrorDto;
export interface CtAccountStatusDto extends CtApiScopeDto { eligible_target_count: number; premium_active: boolean; active_batch_id: BatchId | null; actions: CtBatchActionAvailability }
export interface CtBatchListDto extends CtApiScopeDto { batches: readonly CtProposalBatch[] }
export interface CtBatchDetailDto extends CtApiScopeDto { batch: CtProposalBatch; proposals: readonly CtProposal[]; summary: CtBatchSummary; actions: CtBatchActionAvailability }
export interface CtProposalDecisionRequestDto extends CtApiScopeDto { batch_id: BatchId; proposal_id: ProposalId; expected_version: number }
export interface CtBulkDecisionRequestDto extends CtApiScopeDto { batch_id: BatchId; proposal_ids: readonly ProposalId[]; expected_batch_version: number }
export interface CtEvaluateTimeoutRequestDto extends CtApiScopeDto { batch_id: BatchId; expected_batch_version: number; evaluated_at: string }

export function assertApiScope(pathAccountId: string, body: CtApiScopeDto) {
  return pathAccountId === body.account_id && Boolean(body.tenant_id && body.account_id);
}
