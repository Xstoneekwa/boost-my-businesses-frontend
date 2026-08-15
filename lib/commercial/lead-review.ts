import "server-only";

import { requireCommercialCrmAccess } from "./crm-access";
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
  type CommercialReviewQueueItem,
  type CommercialReviewReadFilters,
  type CommercialReviewReadModel,
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

function firstContextValue(value: Record<string, unknown>): string | null {
  for (const [key, raw] of Object.entries(value)) {
    if (key === "review_note") continue;
    if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 180);
    if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  }
  return null;
}

function queueItem(lead: CommercialReviewLead): CommercialReviewQueueItem {
  return {
    id: lead.id,
    campaignId: lead.campaignId,
    campaignName: lead.campaignName,
    businessName: lead.businessName,
    city: lead.city,
    subsegment: lead.subsegment,
    instagramHandle: lead.instagramHandle,
    score: lead.score,
    priority: lead.priority,
    qualificationStatus: lead.qualificationStatus,
    outreachStatus: lead.outreachStatus,
    outreachChannel: lead.outreachChannel,
    messageAngle: lead.messageAngle,
    lastActivityType: lead.lastActivityType,
    lastActivityAt: lead.lastActivityAt,
    version: lead.version,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    reasoningExcerpt: firstContextValue(lead.personalizationContext),
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

const REVIEW_LEAD_FIELDS = "id,campaign_id,business_id,city_snapshot,subsegment_snapshot,score,priority,qualification_status,outreach_status,outreach_channel,message_angle,version,created_at,updated_at";

export async function getCommercialReviewQueueReadModel(
  filters: CommercialDashboardFilters,
  reviewFilters: CommercialReviewReadFilters,
): Promise<CommercialReviewReadModel> {
  await requireCommercialCrmAccess();
  const supabase = createSupabaseAdminClient();
  const city = reviewFilters.city ?? filters.city;
  const subsegment = reviewFilters.subsegment ?? filters.subsegment;
  const search = reviewFilters.search ?? filters.search;
  const needsBusinessFilter = Boolean(filters.country || filters.vertical || city || subsegment || search);

  const buildBusinessQuery = (searchField?: "business_name" | "instagram_handle") => {
    let query = supabase
      .from("commercial_businesses")
      .select("id,business_name,city,subsegment,instagram_handle,website");
    if (filters.country) query = query.eq("country_code", filters.country);
    if (filters.vertical) query = query.eq("vertical", filters.vertical);
    if (city) query = query.eq("city", city);
    if (subsegment) query = query.eq("subsegment", subsegment);
    if (search && searchField) query = query.ilike(searchField, `%${search}%`);
    return query.range(0, 9999);
  };

  let matchingBusinesses: Row[] | null = null;
  if (needsBusinessFilter) {
    if (search) {
      const [nameResult, instagramResult] = await Promise.all([
        buildBusinessQuery("business_name"),
        buildBusinessQuery("instagram_handle"),
      ]);
      if (nameResult.error || instagramResult.error) throw new CommercialReviewError("commercial_review_unavailable", 503);
      const unique = new Map<string, Row>();
      for (const candidate of [...(nameResult.data ?? []), ...(instagramResult.data ?? [])]) {
        const business = object(candidate);
        if (text(business.id)) unique.set(text(business.id), business);
      }
      matchingBusinesses = [...unique.values()];
    } else {
      const result = await buildBusinessQuery();
      if (result.error) throw new CommercialReviewError("commercial_review_unavailable", 503);
      matchingBusinesses = (result.data ?? []).map(object);
    }
  }
  const matchingBusinessIds = matchingBusinesses?.map((business) => text(business.id)).filter(Boolean) ?? null;

  const buildLeadQuery = ({
    approved = false,
    priority,
    includeReviewPriority = true,
    head = false,
  }: {
    approved?: boolean;
    priority?: string;
    includeReviewPriority?: boolean;
    head?: boolean;
  } = {}) => {
    let query = supabase.from("commercial_leads").select(head ? "id" : REVIEW_LEAD_FIELDS, { count: "exact", head });
    if (approved) query = query.eq("qualification_status", "approved").eq("outreach_status", "not_started");
    else query = query.eq("qualification_status", "qualified").is("approved_at", null);
    if (filters.campaign) query = query.eq("campaign_id", filters.campaign);
    if (filters.dateFrom) query = query.gte("created_at", filters.dateFrom);
    if (filters.dateTo) query = query.lt("created_at", filters.dateTo);
    const channel = reviewFilters.channel ?? filters.channel;
    const angle = reviewFilters.angle ?? filters.messageAngle;
    if (channel) query = query.eq("outreach_channel", channel);
    if (angle) query = query.eq("message_angle", angle);
    if (reviewFilters.minimumScore !== undefined) query = query.gte("score", reviewFilters.minimumScore);
    if (matchingBusinessIds) query = query.in("business_id", matchingBusinessIds.length ? matchingBusinessIds : ["00000000-0000-0000-0000-000000000000"]);
    if (priority) query = query.eq("priority", priority);
    else if (includeReviewPriority && reviewFilters.priority) query = query.eq("priority", reviewFilters.priority);
    return query;
  };

  const priorityOrder = reviewFilters.priority ? [reviewFilters.priority] : [...COMMERCIAL_REVIEW_PRIORITIES];
  const [priorityCounts, p1Result, p2Result, readyResult] = await Promise.all([
    Promise.all(priorityOrder.map(async (priority) => {
      const result = await buildLeadQuery({ priority, includeReviewPriority: false, head: true });
      if (result.error) throw new CommercialReviewError("commercial_review_unavailable", 503);
      return { priority, count: result.count ?? 0 };
    })),
    buildLeadQuery({ priority: "urgent", includeReviewPriority: false, head: true }),
    buildLeadQuery({ priority: "high", includeReviewPriority: false, head: true }),
    buildLeadQuery({ approved: true, head: true }),
  ]);
  if (p1Result.error || p2Result.error || readyResult.error) throw new CommercialReviewError("commercial_review_unavailable", 503);

  const offset = (reviewFilters.page - 1) * reviewFilters.pageSize;
  let pageRows: Row[] = [];
  let total = priorityCounts.reduce((sum, item) => sum + item.count, 0);
  if (reviewFilters.sort === "priority") {
    let remainingOffset = offset;
    let remainingLimit = reviewFilters.pageSize;
    for (const group of priorityCounts) {
      if (remainingLimit <= 0) break;
      if (remainingOffset >= group.count) {
        remainingOffset -= group.count;
        continue;
      }
      const take = Math.min(remainingLimit, group.count - remainingOffset);
      const result = await buildLeadQuery({ priority: group.priority, includeReviewPriority: false })
        .order("score", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(remainingOffset, remainingOffset + take - 1);
      if (result.error) throw new CommercialReviewError("commercial_review_unavailable", 503);
      pageRows.push(...(result.data ?? []).map(object));
      remainingLimit -= take;
      remainingOffset = 0;
    }
  } else {
    let query = buildLeadQuery();
    if (reviewFilters.sort === "score") {
      query = query.order("score", { ascending: false, nullsFirst: false }).order("created_at", { ascending: true });
    } else {
      query = query.order("created_at", { ascending: reviewFilters.sort === "oldest" });
    }
    const result = await query.order("id", { ascending: true }).range(offset, offset + reviewFilters.pageSize - 1);
    if (result.error) throw new CommercialReviewError("commercial_review_unavailable", 503);
    pageRows = (result.data ?? []).map(object);
    total = result.count ?? total;
  }

  const businessIds = [...new Set(pageRows.map((lead) => text(lead.business_id)).filter(Boolean))];
  const campaignIds = [...new Set(pageRows.map((lead) => text(lead.campaign_id)).filter(Boolean))];
  const leadIds = pageRows.map((lead) => text(lead.id)).filter(Boolean);
  const cachedBusinesses = new Map((matchingBusinesses ?? []).map((business) => [text(business.id), business]));
  const [businessesResult, campaignsResult, eventsResult] = await Promise.all([
    businessIds.length
      ? supabase.from("commercial_businesses").select("id,business_name,city,subsegment,instagram_handle,website").in("id", businessIds)
      : Promise.resolve({ data: [], error: null }),
    campaignIds.length
      ? supabase.from("commercial_campaigns").select("id,name").in("id", campaignIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length
      ? supabase.from("commercial_events").select("id,lead_id,event_type,occurred_at").in("lead_id", leadIds).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(reviewFilters.pageSize * 20)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (businessesResult.error || campaignsResult.error || eventsResult.error) throw new CommercialReviewError("commercial_review_unavailable", 503);
  for (const candidate of businessesResult.data ?? []) {
    const business = object(candidate);
    cachedBusinesses.set(text(business.id), business);
  }
  const campaigns = new Map((campaignsResult.data ?? []).map((candidate) => {
    const campaign = object(candidate);
    return [text(campaign.id), campaign];
  }));
  const latestEvents = new Map<string, Row>();
  for (const candidate of eventsResult.data ?? []) {
    const event = object(candidate);
    const leadId = text(event.lead_id);
    if (leadId && !latestEvents.has(leadId)) latestEvents.set(leadId, event);
  }

  const enrichedRows = pageRows.map((lead) => {
    const business = cachedBusinesses.get(text(lead.business_id)) ?? {};
    const campaign = campaigns.get(text(lead.campaign_id)) ?? {};
    const event = latestEvents.get(text(lead.id)) ?? {};
    return {
      ...lead,
      campaign_name: text(campaign.name),
      business_name: text(business.business_name, "Unknown business"),
      city: nullableText(lead.city_snapshot) ?? nullableText(business.city),
      subsegment: nullableText(lead.subsegment_snapshot) ?? nullableText(business.subsegment),
      instagram_handle: nullableText(business.instagram_handle),
      website: nullableText(business.website),
      last_activity_type: nullableText(event.event_type),
      last_activity_at: nullableText(event.occurred_at),
    };
  });
  const summaries = enrichedRows.map((lead) => queueItem(reviewLead(lead)));
  const selectedSummary = summaries.find((lead) => lead.id === reviewFilters.selectedLeadId) ?? summaries[0] ?? null;
  let selectedLead: CommercialReviewLead | null = null;
  if (selectedSummary) {
    const detailResult = await supabase
      .from("commercial_leads")
      .select("personalization_context_safe,audience_context_safe")
      .eq("id", selectedSummary.id)
      .single<Row>();
    if (detailResult.error) throw new CommercialReviewError("commercial_review_unavailable", 503);
    const selectedRow = enrichedRows.find((lead) => text((lead as Row).id) === selectedSummary.id) ?? {};
    selectedLead = reviewLead({ ...selectedRow, ...object(detailResult.data) });
  }

  return {
    items: summaries,
    selectedLead,
    filters: reviewFilters,
    pagination: {
      total,
      page: reviewFilters.page,
      pageSize: reviewFilters.pageSize,
      pageCount: total ? Math.ceil(total / reviewFilters.pageSize) : 0,
    },
    metrics: { p1: p1Result.count ?? 0, p2: p2Result.count ?? 0, readyForOutreach: readyResult.count ?? 0 },
  };
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
