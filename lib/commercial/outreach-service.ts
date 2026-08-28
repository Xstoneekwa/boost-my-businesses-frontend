import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCommercialCrmAccess } from "./crm-access";
import {
  COMMERCIAL_OUTREACH_ANGLES,
  COMMERCIAL_OUTREACH_CHANNELS,
  COMMERCIAL_OUTREACH_STATES,
  COMMERCIAL_OUTREACH_TEMPLATE_KEYS,
  type CommercialOutreachAngle,
  type CommercialOutreachChannel,
  type CommercialOutreachItem,
  type CommercialOutreachMutation,
  type CommercialOutreachMutationAction,
  type CommercialOutreachReadModel,
  type CommercialOutreachReadFilters,
  type CommercialOutreachState,
  type CommercialOutreachTemplateKey,
} from "./outreach-contract";
import { buildCommercialOutreachFactLedger } from "./outreach-facts";
import { commercialOutreachContentHash, validateCommercialOutreachMessage } from "./outreach-validation";

type Row = Record<string, unknown>;

export class CommercialOutreachError extends Error {
  readonly status: 400 | 404 | 409 | 503;
  readonly code: string;
  constructor(code: string, status: 400 | 404 | 409 | 503 = 503) {
    super(code); this.name = "CommercialOutreachError"; this.code = code; this.status = status;
  }
}

function row(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function nullableText(value: unknown) { const clean = text(value).trim(); return clean || null; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function stringArray(value: unknown) { return Array.isArray(value) ? value.map(text).filter(Boolean) : []; }
function oneOf<T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === "string" && allowed.includes(value as T[number]) ? value as T[number] : null;
}

function parseFacts(value: unknown) {
  return Array.isArray(value) ? value.flatMap((candidate) => {
    const fact = row(candidate); const key = text(fact.key).trim(); const factValue = text(fact.value).trim();
    return key && factValue ? [{ key, value: factValue }] : [];
  }).slice(0, 5) : [];
}

function contextValue(value: unknown): string {
  if (typeof value === "string") return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(contextValue).filter(Boolean).slice(0, 6).join(" · ").slice(0, 500);
  if (value && typeof value === "object") return Object.values(value as Row).map(contextValue).filter(Boolean).slice(0, 6).join(" · ").slice(0, 500);
  return "";
}

function contextEntries(value: unknown) {
  return Object.entries(row(value)).flatMap(([key, raw]) => {
    const clean = contextValue(raw);
    return clean ? [{ label: key.replaceAll("_", " "), value: clean }] : [];
  }).slice(0, 10);
}

function cleanPatchText(value: unknown, max: number, required = false) {
  if (value === undefined || value === null) {
    if (required) throw new CommercialOutreachError("commercial_outreach_patch_required", 400);
    return value === null ? null : undefined;
  }
  if (typeof value !== "string") throw new CommercialOutreachError("commercial_outreach_patch_invalid", 400);
  const clean = value.normalize("NFKC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
  if ((required && !clean) || clean.length > max) throw new CommercialOutreachError("commercial_outreach_patch_invalid", 400);
  return clean;
}

export function parseCommercialOutreachMutation(value: unknown): CommercialOutreachMutation {
  const source = row(value); const patch = row(source.patch);
  const action = oneOf(source.action, ["approve_message", "regenerate", "cancel", "change_selection", "edit_message"] as const) as CommercialOutreachMutationAction | null;
  const expectedVersion = Math.trunc(number(source.expectedVersion));
  const idempotencyKey = text(source.idempotencyKey).trim();
  if (!action || expectedVersion < 1 || !idempotencyKey || idempotencyKey.length > 200) throw new CommercialOutreachError("commercial_outreach_mutation_invalid", 400);
  const parsed: CommercialOutreachMutation = { action, expectedVersion, idempotencyKey, patch: {} };
  if (action === "change_selection") {
    const channel = oneOf(patch.channel, COMMERCIAL_OUTREACH_CHANNELS);
    const angle = oneOf(patch.angle, COMMERCIAL_OUTREACH_ANGLES);
    if (!channel || !angle) throw new CommercialOutreachError("commercial_outreach_selection_invalid", 400);
    parsed.patch.channel = channel; parsed.patch.angle = angle;
  }
  if (action === "edit_message") {
    parsed.patch.subject = cleanPatchText(patch.subject, 120) as string | null | undefined;
    parsed.patch.body = cleanPatchText(patch.body, 2000, true) as string;
  }
  if (action === "cancel") parsed.patch.reason = cleanPatchText(patch.reason, 200) as string | undefined;
  return parsed;
}

function rpcError(message: string) {
  if (/not_found/i.test(message)) return new CommercialOutreachError("commercial_outreach_item_not_found", 404);
  if (/stale|claim_mismatch|idempotency/i.test(message)) return new CommercialOutreachError("commercial_outreach_conflict", 409);
  if (/invalid|required|not_ready|not_approved|already_cancelled/i.test(message)) return new CommercialOutreachError("commercial_outreach_request_invalid", 400);
  return new CommercialOutreachError("commercial_outreach_unavailable", 503);
}

export async function getCommercialOutreachReadModel(filters: CommercialOutreachReadFilters): Promise<CommercialOutreachReadModel> {
  await requireCommercialCrmAccess();
  const supabase = createSupabaseAdminClient();
  const offset = (filters.page - 1) * filters.pageSize;
  let itemsQuery = supabase.from("commercial_outreach_items").select("id,lead_id,campaign_id,channel,angle,template_key,template_version,state,subject,body,personalization_summary,facts_used,confidence,validation_codes,generation_attempt_count,max_generation_attempts,generation_model,generation_prompt_version,generated_at,approved_at,owner_edited,version,created_at,updated_at", { count: "exact" });
  const stateByTab = { ready: "ready_for_review", approved: "queued_dry_run", failed: "generation_failed", cancelled: "cancelled" } as const;
  if (filters.status !== "all") itemsQuery = itemsQuery.eq("state", stateByTab[filters.status]);
  if (filters.channel) itemsQuery = itemsQuery.eq("channel", filters.channel);
  if (filters.angle) itemsQuery = itemsQuery.eq("angle", filters.angle);
  if (filters.template) itemsQuery = itemsQuery.eq("template_key", filters.template);
  itemsQuery = filters.sort === "confidence"
    ? itemsQuery.order("confidence", { ascending: false, nullsFirst: false }).order("updated_at", { ascending: false })
    : itemsQuery.order("updated_at", { ascending: false });
  const [itemsResult, generatedResult, failedResult, readyResult, approvedResult, cancelledResult, dimensionsResult] = await Promise.all([
    itemsQuery.range(offset, offset + filters.pageSize - 1),
    supabase.from("commercial_outreach_items").select("id", { count: "exact", head: true }).not("generated_at", "is", null),
    supabase.from("commercial_outreach_items").select("id", { count: "exact", head: true }).eq("state", "generation_failed"),
    supabase.from("commercial_outreach_items").select("id", { count: "exact", head: true }).eq("state", "ready_for_review"),
    supabase.from("commercial_outreach_items").select("id", { count: "exact", head: true }).eq("state", "queued_dry_run"),
    supabase.from("commercial_outreach_items").select("id", { count: "exact", head: true }).eq("state", "cancelled"),
    supabase.from("commercial_outreach_items").select("channel,angle,template_key").limit(5000),
  ]);
  if (itemsResult.error || generatedResult.error || failedResult.error || readyResult.error || approvedResult.error || cancelledResult.error || dimensionsResult.error) throw new CommercialOutreachError("commercial_outreach_read_unavailable", 503);
  const itemRows = (itemsResult.data ?? []).map(row);
  const leadIds = [...new Set(itemRows.map((item) => text(item.lead_id)).filter(Boolean))];
  const { data: leadsData, error: leadsError } = leadIds.length
    ? await supabase.from("commercial_leads").select("id,business_id,priority,score,city_snapshot,subsegment_snapshot,personalization_context_safe,audience_context_safe").in("id", leadIds)
    : { data: [], error: null };
  if (leadsError) throw new CommercialOutreachError("commercial_outreach_read_unavailable", 503);
  const leads = new Map((leadsData ?? []).map((value) => { const lead = row(value); return [text(lead.id), lead]; }));
  const businessIds = [...new Set([...leads.values()].map((lead) => text(lead.business_id)).filter(Boolean))];
  const { data: businessesData, error: businessesError } = businessIds.length
    ? await supabase.from("commercial_businesses").select("id,business_name,city,subsegment,instagram_handle,website,booking_url,enrichment_snapshot_safe").in("id", businessIds)
    : { data: [], error: null };
  if (businessesError) throw new CommercialOutreachError("commercial_outreach_read_unavailable", 503);
  const businesses = new Map((businessesData ?? []).map((value) => { const business = row(value); return [text(business.id), business]; }));
  const items = itemRows.map((item) => {
    const lead = leads.get(text(item.lead_id)) ?? {}; const business = businesses.get(text(lead.business_id)) ?? {};
    return {
      id: text(item.id), businessName: text(business.business_name) || "Unknown business",
      city: nullableText(lead.city_snapshot || business.city), subsegment: nullableText(lead.subsegment_snapshot || business.subsegment), priority: text(lead.priority) || "normal", score: lead.score === null || lead.score === undefined ? null : number(lead.score),
      channel: oneOf(item.channel, COMMERCIAL_OUTREACH_CHANNELS) ?? "instagram", angle: oneOf(item.angle, COMMERCIAL_OUTREACH_ANGLES) ?? "A",
      templateKey: oneOf(item.template_key, COMMERCIAL_OUTREACH_TEMPLATE_KEYS) ?? "IG_BEAUTY_ANGLE_A_V1", templateVersion: text(item.template_version) || "V1",
      state: oneOf(item.state, COMMERCIAL_OUTREACH_STATES) as CommercialOutreachState ?? "generation_failed", confidence: item.confidence === null ? null : number(item.confidence),
      attemptCount: number(item.generation_attempt_count), maxAttempts: number(item.max_generation_attempts), messageExcerpt: nullableText(item.body)?.slice(0, 220) ?? nullableText(item.subject),
      ownerEdited: item.owner_edited === true, version: number(item.version), updatedAt: text(item.updated_at),
    };
  });
  const visibleItems = filters.search ? items.filter((item) => `${item.businessName} ${item.city ?? ""} ${item.subsegment ?? ""} ${item.messageExcerpt ?? ""}`.toLocaleLowerCase("en-ZA").includes(filters.search!.toLocaleLowerCase("en-ZA"))) : items;
  const selectedQueueItem = visibleItems.find((item) => item.id === filters.selectedItemId) ?? visibleItems[0] ?? null;
  const selectedRow = selectedQueueItem ? itemRows.find((item) => text(item.id) === selectedQueueItem.id) ?? null : null;
  let selectedItem: CommercialOutreachItem | null = null;
  if (selectedRow) {
    const lead = leads.get(text(selectedRow.lead_id)) ?? {}; const business = businesses.get(text(lead.business_id)) ?? {};
    const { data: eventsData, error: eventsError } = await supabase.from("commercial_outreach_events").select("id,event_type,actor_type,occurred_at").eq("item_id", text(selectedRow.id)).order("occurred_at", { ascending: false }).limit(50);
    if (eventsError) throw new CommercialOutreachError("commercial_outreach_read_unavailable", 503);
    const enrichment = row(business.enrichment_snapshot_safe); const instagram = row(enrichment.instagram); const metadata = row(instagram.metadata);
    selectedItem = {
      ...selectedQueueItem,
      leadId: text(selectedRow.lead_id), campaignId: text(selectedRow.campaign_id), subject: nullableText(selectedRow.subject), body: nullableText(selectedRow.body),
      personalizationSummary: nullableText(selectedRow.personalization_summary), factsUsed: parseFacts(selectedRow.facts_used), validationCodes: stringArray(selectedRow.validation_codes),
      generationModel: nullableText(selectedRow.generation_model), generationPromptVersion: nullableText(selectedRow.generation_prompt_version), generatedAt: nullableText(selectedRow.generated_at), approvedAt: nullableText(selectedRow.approved_at), createdAt: text(selectedRow.created_at),
      instagramHandle: nullableText(business.instagram_handle), website: nullableText(business.website), bookingUrl: nullableText(business.booking_url), instagramBio: nullableText(metadata.biography),
      personalizationContext: contextEntries(lead.personalization_context_safe), audienceContext: contextEntries(lead.audience_context_safe),
      history: (eventsData ?? []).map((value) => { const event = row(value); return { id: text(event.id), eventType: text(event.event_type), actorType: text(event.actor_type), occurredAt: text(event.occurred_at) }; }),
    };
  }
  const byChannel: Record<string, number> = {}; const byAngle: Record<string, number> = {}; const byTemplate: Record<string, number> = {};
  for (const raw of dimensionsResult.data ?? []) {
    const dimension = row(raw); const channel = text(dimension.channel); const angle = text(dimension.angle); const template = text(dimension.template_key);
    if (channel) byChannel[channel] = (byChannel[channel] ?? 0) + 1;
    if (angle) byAngle[angle] = (byAngle[angle] ?? 0) + 1;
    if (template) byTemplate[template] = (byTemplate[template] ?? 0) + 1;
  }
  const total = itemsResult.count ?? 0;
  return {
    items: visibleItems,
    selectedItem,
    filters,
    pagination: { page: filters.page, pageSize: filters.pageSize, pageCount: total ? Math.ceil(total / filters.pageSize) : 0, total },
    facets: {
      channels: COMMERCIAL_OUTREACH_CHANNELS.filter((value) => (byChannel[value] ?? 0) > 0),
      angles: COMMERCIAL_OUTREACH_ANGLES.filter((value) => (byAngle[value] ?? 0) > 0),
      templates: COMMERCIAL_OUTREACH_TEMPLATE_KEYS.filter((value) => (byTemplate[value] ?? 0) > 0),
    },
    metrics: { generated: generatedResult.count ?? 0, generationFailed: failedResult.count ?? 0, readyForReview: readyResult.count ?? 0, approvedDryRun: approvedResult.count ?? 0, cancelled: cancelledResult.count ?? 0, byChannel, byAngle, byTemplate },
    delivery: { realEmailSend: false, realInstagramDmSend: false, phoneFarmDmExecution: false },
  };
}

async function validateOwnerMessage(itemId: string, mutation: CommercialOutreachMutation) {
  const supabase = createSupabaseAdminClient();
  const { data: itemData, error: itemError } = await supabase.from("commercial_outreach_items").select("id,lead_id,channel,angle,template_key,facts_used,subject,body,confidence").eq("id", itemId).single<Row>();
  if (itemError || !itemData) throw rpcError(itemError?.message ?? "not_found");
  const item = row(itemData);
  const { data: leadData, error: leadError } = await supabase.from("commercial_leads").select("id,business_id,city_snapshot,subsegment_snapshot").eq("id", text(item.lead_id)).single<Row>();
  if (leadError || !leadData) throw new CommercialOutreachError("commercial_outreach_edit_context_unavailable", 503);
  const lead = row(leadData);
  const [{ data: businessData, error: businessError }, { data: otherBusinesses }] = await Promise.all([
    supabase.from("commercial_businesses").select("id,business_name,city,subsegment,instagram_handle,website,booking_url,booking_provider,enrichment_snapshot_safe").eq("id", text(lead.business_id)).single<Row>(),
    supabase.from("commercial_businesses").select("business_name").neq("id", text(lead.business_id)).limit(250),
  ]);
  if (businessError || !businessData) throw new CommercialOutreachError("commercial_outreach_edit_context_unavailable", 503);
  const business = row(businessData); const verifiedFacts = buildCommercialOutreachFactLedger({ lead, business });
  const editing = mutation.action === "edit_message";
  const subject = editing ? mutation.patch.subject ?? null : nullableText(item.subject);
  const body = editing ? mutation.patch.body ?? "" : text(item.body);
  const result = validateCommercialOutreachMessage({
    message: {
      subject, body, channel: text(item.channel) as CommercialOutreachChannel,
      angle: text(item.angle) as CommercialOutreachAngle, template_version: text(item.template_key) as CommercialOutreachTemplateKey,
      personalization_summary: "Owner message quality check.", facts_used: parseFacts(item.facts_used), confidence: editing ? 1 : Number(item.confidence),
    },
    businessName: text(business.business_name), city: nullableText(lead.city_snapshot || business.city), verifiedFacts,
    otherBusinessNames: (otherBusinesses ?? []).map((candidate) => text(row(candidate).business_name)).filter(Boolean),
  });
  if (!result.ok) throw new CommercialOutreachError(`commercial_outreach_${editing ? "edit" : "approval"}_rejected:${result.codes.join(",")}`, 400);
  if (editing) mutation.patch.contentHash = commercialOutreachContentHash(subject, body);
}

export async function mutateCommercialOutreachItem(itemId: string, mutation: CommercialOutreachMutation) {
  const actor = await requireCommercialCrmAccess();
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) throw new CommercialOutreachError("commercial_outreach_item_not_found", 404);
  if (mutation.action === "edit_message" || mutation.action === "approve_message") await validateOwnerMessage(itemId, mutation);
  const patch: Row = {};
  if (mutation.patch.channel) patch.channel = mutation.patch.channel;
  if (mutation.patch.angle) patch.angle = mutation.patch.angle;
  if (mutation.patch.subject !== undefined) patch.subject = mutation.patch.subject;
  if (mutation.patch.body !== undefined) patch.body = mutation.patch.body;
  if (mutation.patch.reason !== undefined) patch.reason = mutation.patch.reason;
  if (mutation.patch.contentHash !== undefined) patch.content_hash = mutation.patch.contentHash;
  const { data, error } = await createSupabaseAdminClient().rpc("mutate_commercial_outreach_item_v1", {
    p_actor_user_id: actor.userId, p_item_id: itemId, p_action: mutation.action, p_expected_version: mutation.expectedVersion,
    p_idempotency_key: mutation.idempotencyKey, p_patch: patch,
  });
  if (error) throw rpcError(error.message);
  return row(data);
}
