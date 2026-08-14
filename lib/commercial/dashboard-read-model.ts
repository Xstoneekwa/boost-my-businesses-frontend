import "server-only";

import { requireCommercialCrmAccess } from "./crm-access";
import { commercialFiltersToRpc } from "./dashboard-query";
import type {
  CommercialBreakdownRow,
  CommercialDashboardFilters,
  CommercialDashboardReadModel,
  CommercialFacetCampaign,
  CommercialFunnelStep,
  CommercialLeadDetail,
  CommercialLeadRow,
  CommercialQueueLead,
} from "./dashboard-read-model-types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Row = Record<string, unknown>;

export class CommercialReadModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommercialReadModelError";
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

function number(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : number(value);
}

function boolean(value: unknown): boolean {
  return value === true;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function queueLead(row: Row): CommercialQueueLead {
  return {
    id: text(row.id),
    businessName: text(row.business_name, "Unknown business"),
    city: nullableText(row.city),
    subsegment: nullableText(row.subsegment),
    score: nullableNumber(row.score),
    priority: text(row.priority, "normal"),
    instagramHandle: nullableText(row.instagram_handle),
    outreachChannel: nullableText(row.outreach_channel),
    messageAngle: nullableText(row.message_angle),
    salesStatus: text(row.sales_status, "not_started"),
    updatedAt: text(row.updated_at),
  };
}

function leadRow(row: Row): CommercialLeadRow {
  return {
    ...queueLead(row),
    campaignId: text(row.campaign_id),
    campaignName: text(row.campaign_name),
    campaignCode: text(row.campaign_code),
    businessId: text(row.business_id),
    countryCode: text(row.country_code),
    vertical: text(row.vertical),
    qualificationStatus: text(row.qualification_status),
    outreachStatus: text(row.outreach_status),
    templateVersion: nullableText(row.template_version),
    lastActivityAt: nullableText(row.last_activity_at),
    lastActivityType: nullableText(row.last_activity_type),
    createdAt: text(row.created_at),
  };
}

function breakdownRow(row: Row): CommercialBreakdownRow {
  return {
    label: text(row.label, "Unassigned"),
    qualified: number(row.qualified),
    contacted: number(row.contacted),
    replies: number(row.replies),
    salesQualified: number(row.sales_qualified),
    demos: number(row.demos),
    paid: number(row.paid),
    paidPer100Qualified: nullableNumber(row.paid_per_100_qualified),
    sampleSufficient: boolean(row.sample_sufficient),
  };
}

function funnelStep(row: Row): CommercialFunnelStep {
  return {
    key: text(row.key),
    label: text(row.label),
    count: number(row.count),
    fromPrevious: nullableNumber(row.from_previous),
    fromQualified: nullableNumber(row.from_qualified),
  };
}

function facetCampaign(row: Row): CommercialFacetCampaign {
  return { id: text(row.id), name: text(row.name), code: text(row.code) };
}

export function normalizeCommercialDashboardReadModel(
  value: unknown,
  filters: CommercialDashboardFilters,
): CommercialDashboardReadModel {
  const root = object(value);
  const metric = object(root.metric_contract);
  const kpis = object(root.kpis);
  const breakdowns = object(root.breakdowns);
  const queues = object(root.queues);
  const leads = object(root.leads);
  const facets = object(root.facets);
  const pageSize = Math.max(1, number(leads.page_size, filters.pageSize));
  const total = number(leads.total);

  return {
    filters,
    metricContract: {
      cohort: "lead_created_at",
      paidSource: "commercial_conversions",
      minimumQualifiedSample: number(metric.minimum_qualified_sample, 20),
    },
    kpis: {
      discovered: number(kpis.discovered),
      qualified: number(kpis.qualified),
      approved: number(kpis.approved),
      contacted: number(kpis.contacted),
      replies: number(kpis.replies),
      hotLeads: number(kpis.hot_leads),
      demos: number(kpis.demos),
      paid: number(kpis.paid),
      paidPer100Qualified: nullableNumber(kpis.paid_per_100_qualified),
      paidPer100SampleSufficient: boolean(kpis.paid_per_100_sample_sufficient),
    },
    funnel: rows(root.funnel).map(funnelStep),
    breakdowns: {
      channel: rows(breakdowns.channel).map(breakdownRow),
      angle: rows(breakdowns.angle).map(breakdownRow),
      city: rows(breakdowns.city).map(breakdownRow),
      subsegment: rows(breakdowns.subsegment).map(breakdownRow),
      template: rows(breakdowns.template).map(breakdownRow),
    },
    queues: {
      needsApproval: rows(queues.needs_approval).map(queueLead),
      hotResponses: rows(queues.hot_responses).map(queueLead),
      upcomingDemos: rows(queues.upcoming_demos).map(queueLead),
      needsSalesAction: rows(queues.needs_sales_action).map(queueLead),
    },
    leads: {
      rows: rows(leads.rows).map(leadRow),
      total,
      page: Math.max(1, number(leads.page, filters.page)),
      pageSize,
      pageCount: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
    facets: {
      campaigns: rows(facets.campaigns).map(facetCampaign),
      countries: stringArray(facets.countries),
      cities: stringArray(facets.cities),
      verticals: stringArray(facets.verticals),
      subsegments: stringArray(facets.subsegments),
      channels: stringArray(facets.channels),
      angles: stringArray(facets.angles),
      templates: stringArray(facets.templates),
    },
  };
}

/** Canonical owner-gated dashboard loader. Never call Supabase from a browser component. */
export async function getCommercialDashboardReadModel(
  filters: CommercialDashboardFilters,
): Promise<CommercialDashboardReadModel> {
  await requireCommercialCrmAccess();
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.rpc("commercial_dashboard_read_model_v1", {
    p_filters: commercialFiltersToRpc(filters),
    p_page: filters.page,
    p_page_size: filters.pageSize,
  });
  if (error) throw new CommercialReadModelError("Commercial dashboard data is unavailable.");
  return normalizeCommercialDashboardReadModel(data, filters);
}

function safeMetadataSummary(value: unknown): Array<{ key: string; value: string }> {
  const sensitive = /secret|token|password|credential|authorization|api.?key/i;
  return Object.entries(object(value)).slice(0, 8).map(([key, raw]) => {
    if (sensitive.test(key)) return { key, value: "[redacted]" };
    if (raw === null || raw === undefined) return { key, value: "—" };
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      return { key, value: String(raw).slice(0, 160) };
    }
    return { key, value: Array.isArray(raw) ? `[${raw.length} items]` : "[structured data]" };
  });
}

/** Canonical owner-gated detail loader with bounded timeline and explicit selects. */
export async function getCommercialLeadDetail(leadId: string): Promise<CommercialLeadDetail | null> {
  await requireCommercialCrmAccess();
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return null;
  const supabase = createSupabaseAdminClient();
  const { data: leadData, error: leadError } = await supabase
    .from("commercial_leads")
    .select("id,campaign_id,business_id,primary_contact_id,qualification_status,outreach_status,sales_status,score,priority,outreach_channel,message_angle,template_version,personalization_context_safe,audience_context_safe,approved_by,approved_at,sales_owner_auth_user_id,created_at,updated_at")
    .eq("id", leadId)
    .maybeSingle<Row>();
  if (leadError) throw new CommercialReadModelError("Commercial lead detail is unavailable.");
  if (!leadData) return null;

  const [campaignResult, businessResult, contactResult, conversionResult, eventsResult] = await Promise.all([
    supabase.from("commercial_campaigns").select("id,name,campaign_code").eq("id", text(leadData.campaign_id)).single<Row>(),
    supabase.from("commercial_businesses").select("id,business_name,website,instagram_handle,city,country_code,vertical,subsegment,source").eq("id", text(leadData.business_id)).single<Row>(),
    leadData.primary_contact_id
      ? supabase.from("commercial_contacts").select("id,full_name,job_title,email,instagram_handle,preferred_channel").eq("id", text(leadData.primary_contact_id)).maybeSingle<Row>()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("commercial_conversions").select("id,client_id,package_reference,checkout_session_id,entitlement_id,stripe_billing_profile_id,stripe_subscription_id,converted_at").eq("lead_id", leadId).maybeSingle<Row>(),
    supabase.from("commercial_events").select("id,event_type,actor_type,actor_auth_user_id,metadata_safe,occurred_at").eq("lead_id", leadId).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(100),
  ]);
  if (campaignResult.error || businessResult.error || contactResult.error || conversionResult.error || eventsResult.error) {
    throw new CommercialReadModelError("Commercial lead detail is partially unavailable.");
  }

  const campaign = object(campaignResult.data);
  const business = object(businessResult.data);
  const contact = contactResult.data ? object(contactResult.data) : null;
  const conversion = conversionResult.data ? object(conversionResult.data) : null;
  let instagramAccountIds: string[] = [];
  if (conversion?.client_id) {
    const links = await supabase.from("client_instagram_accounts").select("account_id").eq("client_id", text(conversion.client_id)).limit(100);
    if (!links.error) instagramAccountIds = rows(links.data).map((row) => text(row.account_id)).filter(Boolean);
  }

  return {
    id: text(leadData.id),
    campaign: { id: text(campaign.id), name: text(campaign.name), code: text(campaign.campaign_code) },
    business: {
      id: text(business.id), name: text(business.business_name), website: nullableText(business.website),
      instagramHandle: nullableText(business.instagram_handle), city: nullableText(business.city),
      country: text(business.country_code), vertical: text(business.vertical), subsegment: nullableText(business.subsegment),
      source: text(business.source),
    },
    contact: contact ? {
      id: text(contact.id), name: nullableText(contact.full_name), role: nullableText(contact.job_title),
      email: nullableText(contact.email), instagramHandle: nullableText(contact.instagram_handle),
      preferredChannel: nullableText(contact.preferred_channel),
    } : null,
    qualification: {
      score: nullableNumber(leadData.score), priority: text(leadData.priority), status: text(leadData.qualification_status),
      personalizationContext: object(leadData.personalization_context_safe), audienceContext: object(leadData.audience_context_safe),
      approvedBy: nullableText(leadData.approved_by), approvedAt: nullableText(leadData.approved_at),
    },
    outreach: {
      channel: nullableText(leadData.outreach_channel), angle: nullableText(leadData.message_angle),
      templateVersion: nullableText(leadData.template_version), status: text(leadData.outreach_status),
    },
    sales: { status: text(leadData.sales_status), ownerUserId: nullableText(leadData.sales_owner_auth_user_id) },
    conversion: conversion ? {
      id: text(conversion.id), clientId: text(conversion.client_id), packageReference: nullableText(conversion.package_reference),
      checkoutSessionId: nullableText(conversion.checkout_session_id), entitlementId: nullableText(conversion.entitlement_id),
      stripeBillingProfileId: nullableText(conversion.stripe_billing_profile_id), stripeSubscriptionId: nullableText(conversion.stripe_subscription_id),
      convertedAt: text(conversion.converted_at), instagramAccountIds,
    } : null,
    timeline: rows(eventsResult.data).map((event) => ({
      id: text(event.id), eventType: text(event.event_type), actorType: text(event.actor_type),
      actorUserId: nullableText(event.actor_auth_user_id), occurredAt: text(event.occurred_at),
      metadataSummary: safeMetadataSummary(event.metadata_safe),
    })),
    createdAt: text(leadData.created_at),
    updatedAt: text(leadData.updated_at),
  };
}
