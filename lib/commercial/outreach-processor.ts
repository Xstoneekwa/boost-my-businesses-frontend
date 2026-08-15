import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateCommercialOutreachMessage } from "./outreach-ai";
import { COMMERCIAL_OUTREACH_PROMPT_VERSION, type CommercialOutreachAngle, type CommercialOutreachChannel, type CommercialOutreachTemplateKey } from "./outreach-contract";
import { buildCommercialOutreachFactLedger } from "./outreach-facts";
import { commercialOutreachContentHash, validateCommercialOutreachMessage } from "./outreach-validation";

type Row = Record<string, unknown>;
type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function text(value: unknown) { return typeof value === "string" ? value : ""; }
function number(value: unknown) { return typeof value === "number" ? value : Number(value) || 0; }

export type CommercialOutreachProcessorDependencies = {
  supabase?: SupabaseAdmin;
  generate?: typeof generateCommercialOutreachMessage;
  batchLimit?: number;
  workerId?: string;
};

async function completeFailure(supabase: SupabaseAdmin, item: Row, workerId: string, codes: string[], model?: string) {
  const { error } = await supabase.rpc("complete_commercial_outreach_generation_v1", {
    p_item_id: text(item.id),
    p_worker_id: workerId,
    p_success: false,
    p_payload: { model: model ?? null, prompt_version: COMMERCIAL_OUTREACH_PROMPT_VERSION },
    p_validation_codes: codes.slice(0, 20),
  });
  if (error) {
    const { data } = await supabase.from("commercial_outreach_items").select("state").eq("id", text(item.id)).maybeSingle<Row>();
    if (row(data).state === "cancelled") return;
    throw new Error("commercial_outreach_finalize_failed");
  }
}

async function processItem(
  supabase: SupabaseAdmin,
  item: Row,
  workerId: string,
  generate: typeof generateCommercialOutreachMessage,
) {
  const [{ data: leadData, error: leadError }, { data: templateData, error: templateError }] = await Promise.all([
    supabase.from("commercial_leads").select("id,campaign_id,business_id,qualification_status,outreach_status,priority,city_snapshot,subsegment_snapshot,outreach_channel,message_angle").eq("id", text(item.lead_id)).single<Row>(),
    supabase.from("commercial_outreach_templates").select("template_key,channel,angle,intent,active").eq("template_key", text(item.template_key)).single<Row>(),
  ]);
  if (leadError || templateError || !leadData || !templateData) {
    await completeFailure(supabase, item, workerId, ["generation_context_unavailable"]);
    return "failed";
  }
  const lead = row(leadData); const template = row(templateData);
  if (lead.qualification_status !== "approved" || !["not_started", "queued"].includes(text(lead.outreach_status)) || template.active !== true) {
    await completeFailure(supabase, item, workerId, ["lead_no_longer_eligible"]);
    return "failed";
  }

  const [{ data: businessData, error: businessError }, { data: otherBusinesses }] = await Promise.all([
    supabase.from("commercial_businesses").select("id,business_name,city,subsegment,instagram_handle,website,booking_url,booking_provider,enrichment_snapshot_safe").eq("id", text(lead.business_id)).single<Row>(),
    supabase.from("commercial_businesses").select("business_name").neq("id", text(lead.business_id)).limit(250),
  ]);
  if (businessError || !businessData) {
    await completeFailure(supabase, item, workerId, ["business_context_unavailable"]);
    return "failed";
  }
  const business = row(businessData);
  const businessName = text(business.business_name).trim();
  const verifiedFacts = buildCommercialOutreachFactLedger({ lead, business });
  if (!businessName || verifiedFacts.filter((fact) => fact.key !== "business_name").length === 0) {
    await completeFailure(supabase, item, workerId, ["verified_fact_ledger_insufficient"]);
    return "failed";
  }

  const generated = await generate({
    channel: text(item.channel) as CommercialOutreachChannel,
    angle: text(item.angle) as CommercialOutreachAngle,
    templateKey: text(item.template_key) as CommercialOutreachTemplateKey,
    templateIntent: text(template.intent),
    businessName,
    verifiedFacts,
  });
  if (!generated.ok || !generated.message) {
    await completeFailure(supabase, item, workerId, [generated.errorCode], generated.model);
    return "failed";
  }

  const validation = validateCommercialOutreachMessage({
    message: generated.message,
    businessName,
    city: text(lead.city_snapshot || business.city).trim() || null,
    verifiedFacts,
    otherBusinessNames: (otherBusinesses ?? []).map((candidate) => text(row(candidate).business_name)).filter(Boolean),
  });
  if (!validation.ok) {
    await completeFailure(supabase, item, workerId, validation.codes, generated.model);
    return "failed";
  }

  const { error } = await supabase.rpc("complete_commercial_outreach_generation_v1", {
    p_item_id: text(item.id),
    p_worker_id: workerId,
    p_success: true,
    p_payload: {
      ...generated.message,
      model: generated.model,
      prompt_version: COMMERCIAL_OUTREACH_PROMPT_VERSION,
      content_hash: commercialOutreachContentHash(generated.message.subject, generated.message.body),
    },
    p_validation_codes: [],
  });
  if (error) {
    const { data } = await supabase.from("commercial_outreach_items").select("state").eq("id", text(item.id)).maybeSingle<Row>();
    if (row(data).state === "cancelled") return "cancelled";
    throw new Error("commercial_outreach_finalize_failed");
  }
  return "ready";
}

export async function processCommercialOutreachBatch(dependencies: CommercialOutreachProcessorDependencies = {}) {
  const supabase = dependencies.supabase ?? createSupabaseAdminClient();
  const generate = dependencies.generate ?? generateCommercialOutreachMessage;
  const workerId = dependencies.workerId ?? `commercial-outreach:${process.env.VERCEL_REGION ?? "local"}:${crypto.randomUUID().slice(0, 8)}`;
  const configuredBatchLimit = dependencies.batchLimit ?? (number(process.env.COMMERCIAL_OUTREACH_BATCH_SIZE) || 5);
  const batchLimit = Math.min(Math.max(Math.trunc(configuredBatchLimit), 1), 20);
  const { data, error } = await supabase.rpc("claim_commercial_outreach_items_v1", { batch_limit: batchLimit, worker_id: workerId });
  if (error) throw new Error("commercial_outreach_claim_failed");
  const items = Array.isArray(data) ? data.map(row) : [];
  let ready = 0; let failed = 0;
  for (const item of items) {
    const outcome = await processItem(supabase, item, workerId, generate);
    if (outcome === "ready") ready += 1;
    else if (outcome === "failed") failed += 1;
  }
  return { workerId, claimed: items.length, ready, failed, realEmailSend: false, realInstagramDmSend: false, phoneFarmDmExecution: false };
}
