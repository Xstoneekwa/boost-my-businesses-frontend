import "server-only";

import { requireCommercialCrmAccess } from "./crm-access";
import { commercialFiltersToRpc } from "./dashboard-query";
import type { CommercialDashboardFilters } from "./dashboard-read-model-types";
import {
  COMMERCIAL_REJECTION_REASONS,
  COMMERCIAL_REVIEW_ANGLES,
  COMMERCIAL_REVIEW_CHANNELS,
  COMMERCIAL_REVIEW_PRIORITIES,
  type CommercialReviewLead,
  type CommercialReviewMutation,
  type CommercialReviewMutationResult,
  type CommercialReviewPatch,
  type CommercialReviewQueue,
} from "./lead-review-contract";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

export class CommercialReviewError extends Error {
  readonly status: 400 | 404 | 409 | 503;
  readonly code: string;

  constructor(code: string, status: 400 | 404 | 409 | 503 = 503) {
    super(code);
    this.name = "CommercialReviewError";
    this.code = code;
    this.status = status;
  }
}

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function integer(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  return fallback;
}

function reviewLead(value: unknown): CommercialReviewLead {
  const row = object(value);
  return {
    id: text(row.id),
    campaignId: text(row.campaign_id),
    campaignName: text(row.campaign_name),
    businessName: text(row.business_name, "Unknown business"),
    city: nullableText(row.city),
    subsegment: nullableText(row.subsegment),
    website: nullableText(row.website),
    instagramHandle: nullableText(row.instagram_handle),
    score: row.score === null || row.score === undefined ? null : integer(row.score),
    priority: text(row.priority, "normal"),
    qualificationStatus: text(row.qualification_status),
    outreachStatus: text(row.outreach_status),
    outreachChannel: nullableText(row.outreach_channel),
    messageAngle: nullableText(row.message_angle),
    personalizationContext: object(row.personalization_context_safe),
    audienceContext: object(row.audience_context_safe),
    lastActivityType: nullableText(row.last_activity_type),
    lastActivityAt: nullableText(row.last_activity_at),
    version: integer(row.version, 1),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function queuePart(value: unknown) {
  const part = object(value);
  return {
    rows: rows(part.rows).map(reviewLead),
    total: Math.max(0, integer(part.total)),
    page: Math.max(1, integer(part.page, 1)),
    pageSize: Math.max(1, integer(part.page_size, 12)),
  };
}

export function normalizeCommercialReviewQueue(value: unknown): CommercialReviewQueue {
  const root = object(value);
  return {
    needsApproval: queuePart(root.needs_approval),
    readyForOutreach: queuePart(root.ready_for_outreach),
  };
}

function oneOf<T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
  return typeof value === "string" && allowed.includes(value as T[number]) ? value as T[number] : undefined;
}

function cleanNote(value: unknown, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new CommercialReviewError("commercial_review_note_invalid", 400);
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (clean.length > max) throw new CommercialReviewError("commercial_review_note_too_long", 400);
  return clean;
}

export function parseCommercialReviewMutation(value: unknown): CommercialReviewMutation {
  const root = object(value);
  const patchInput = object(root.patch);
  const action = oneOf(root.action, ["approve", "reject", "update_context"] as const);
  const expectedVersion = integer(root.expectedVersion);
  const idempotencyKey = text(root.idempotencyKey).trim();
  if (!action) throw new CommercialReviewError("commercial_review_action_invalid", 400);
  if (expectedVersion < 1) throw new CommercialReviewError("commercial_review_expected_version_invalid", 400);
  if (!idempotencyKey || idempotencyKey.length > 200) throw new CommercialReviewError("commercial_review_idempotency_key_invalid", 400);

  const patch: CommercialReviewPatch = {};
  if ("outreachChannel" in patchInput) {
    const channel = patchInput.outreachChannel === null ? null : oneOf(patchInput.outreachChannel, COMMERCIAL_REVIEW_CHANNELS);
    if (channel === undefined) throw new CommercialReviewError("commercial_review_channel_invalid", 400);
    patch.outreachChannel = channel;
  }
  if ("messageAngle" in patchInput) {
    const angle = patchInput.messageAngle === null ? null : oneOf(patchInput.messageAngle, COMMERCIAL_REVIEW_ANGLES);
    if (angle === undefined) throw new CommercialReviewError("commercial_review_angle_invalid", 400);
    patch.messageAngle = angle;
  }
  if ("priority" in patchInput) {
    const priority = oneOf(patchInput.priority, COMMERCIAL_REVIEW_PRIORITIES);
    if (!priority) throw new CommercialReviewError("commercial_review_priority_invalid", 400);
    patch.priority = priority;
  }
  if ("rejectionReason" in patchInput) {
    const reasons = COMMERCIAL_REJECTION_REASONS.map(([key]) => key);
    const reason = oneOf(patchInput.rejectionReason, reasons);
    if (!reason) throw new CommercialReviewError("commercial_review_rejection_reason_invalid", 400);
    patch.rejectionReason = reason;
  }
  patch.personalizationNote = cleanNote(patchInput.personalizationNote, 1000);
  patch.audienceNote = cleanNote(patchInput.audienceNote, 1000);
  patch.rejectionNote = cleanNote(patchInput.rejectionNote, 500);
  return { action, expectedVersion, idempotencyKey, patch };
}

function toRpcPatch(patch: CommercialReviewPatch): Row {
  const result: Row = {};
  if (patch.outreachChannel !== undefined) result.outreach_channel = patch.outreachChannel;
  if (patch.messageAngle !== undefined) result.message_angle = patch.messageAngle;
  if (patch.priority !== undefined) result.priority = patch.priority;
  if (patch.personalizationNote !== undefined) result.personalization_note = patch.personalizationNote;
  if (patch.audienceNote !== undefined) result.audience_note = patch.audienceNote;
  if (patch.rejectionReason !== undefined) result.rejection_reason = patch.rejectionReason;
  if (patch.rejectionNote !== undefined) result.rejection_note = patch.rejectionNote;
  return result;
}

function rpcError(message: string): CommercialReviewError {
  if (/stale_version|invalid_transition|lead_not_eligible|idempotency_conflict/i.test(message)) {
    return new CommercialReviewError("commercial_review_conflict", 409);
  }
  if (/lead_not_found/i.test(message)) return new CommercialReviewError("commercial_review_lead_not_found", 404);
  if (/invalid|required|not_allowed|patch_empty|too_long/i.test(message)) {
    return new CommercialReviewError("commercial_review_request_invalid", 400);
  }
  return new CommercialReviewError("commercial_review_unavailable", 503);
}

export async function getCommercialReviewQueueReadModel(
  filters: CommercialDashboardFilters,
  page = 1,
  pageSize = 12,
): Promise<CommercialReviewQueue> {
  await requireCommercialCrmAccess();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("commercial_review_queue_read_model_v1", {
    p_filters: commercialFiltersToRpc(filters),
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) throw rpcError(error.message);
  return normalizeCommercialReviewQueue(data);
}

export async function reviewCommercialLead(
  leadId: string,
  mutation: CommercialReviewMutation,
): Promise<CommercialReviewMutationResult> {
  const actor = await requireCommercialCrmAccess();
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw new CommercialReviewError("commercial_review_lead_not_found", 404);
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("review_commercial_lead_v1", {
    p_actor_user_id: actor.userId,
    p_lead_id: leadId,
    p_action: mutation.action,
    p_expected_version: mutation.expectedVersion,
    p_idempotency_key: mutation.idempotencyKey,
    p_review_patch: toRpcPatch(mutation.patch),
  });
  if (error) throw rpcError(error.message);
  const result = object(data);
  return {
    ok: true,
    idempotentReplay: result.idempotent_replay === true,
    reviewAction: oneOf(result.review_action, ["approve", "reject", "update_context"] as const) ?? mutation.action,
    leadId: text(result.lead_id, leadId),
    eventId: text(result.event_id),
    qualificationStatus: text(result.qualification_status),
    outreachStatus: text(result.outreach_status),
    outreachChannel: nullableText(result.outreach_channel) ?? mutation.patch.outreachChannel ?? null,
    messageAngle: nullableText(result.message_angle) ?? mutation.patch.messageAngle ?? null,
    priority: text(result.priority, mutation.patch.priority ?? "normal"),
    version: integer(result.version, mutation.expectedVersion),
  };
}
