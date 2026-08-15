export const COMMERCIAL_DATE_RANGES = ["7d", "14d", "30d", "all"] as const;

export type CommercialDateRange = (typeof COMMERCIAL_DATE_RANGES)[number];

export type CommercialDashboardFilters = {
  range: CommercialDateRange;
  campaign?: string;
  country?: string;
  city?: string;
  vertical?: string;
  subsegment?: string;
  channel?: string;
  messageAngle?: string;
  templateVersion?: string;
  priority?: string;
  qualificationStatus?: string;
  outreachStatus?: string;
  salesStatus?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
};

export type CommercialKpis = {
  discovered: number;
  qualified: number;
  approved: number;
  contacted: number;
  replies: number;
  hotLeads: number;
  demos: number;
  paid: number;
  paidPer100Qualified: number | null;
  paidPer100SampleSufficient: boolean;
};

export type CommercialFunnelStep = {
  key: string;
  label: string;
  count: number;
  fromPrevious: number | null;
  fromQualified: number | null;
};

export type CommercialBreakdownRow = {
  label: string;
  qualified: number;
  contacted: number;
  replies: number;
  salesQualified: number;
  demos: number;
  paid: number;
  paidPer100Qualified: number | null;
  sampleSufficient: boolean;
};

export type CommercialQueueLead = {
  id: string;
  businessName: string;
  city: string | null;
  subsegment: string | null;
  score: number | null;
  priority: string;
  instagramHandle: string | null;
  outreachChannel: string | null;
  messageAngle: string | null;
  salesStatus: string;
  updatedAt: string;
};

export type CommercialLeadRow = CommercialQueueLead & {
  campaignId: string;
  campaignName: string;
  campaignCode: string;
  businessId: string;
  countryCode: string;
  vertical: string;
  qualificationStatus: string;
  outreachStatus: string;
  templateVersion: string | null;
  lastActivityAt: string | null;
  lastActivityType: string | null;
  createdAt: string;
};

export type CommercialFacetCampaign = { id: string; name: string; code: string };

export type CommercialDashboardReadModel = {
  filters: CommercialDashboardFilters;
  metricContract: {
    cohort: "lead_created_at";
    paidSource: "commercial_conversions";
    minimumQualifiedSample: number;
  };
  kpis: CommercialKpis;
  funnel: CommercialFunnelStep[];
  breakdowns: {
    channel: CommercialBreakdownRow[];
    angle: CommercialBreakdownRow[];
    city: CommercialBreakdownRow[];
    subsegment: CommercialBreakdownRow[];
    template: CommercialBreakdownRow[];
  };
  queues: {
    needsApproval: CommercialQueueLead[];
    hotResponses: CommercialQueueLead[];
    upcomingDemos: CommercialQueueLead[];
    needsSalesAction: CommercialQueueLead[];
  };
  leads: {
    rows: CommercialLeadRow[];
    total: number;
    page: number;
    pageSize: number;
    pageCount: number;
  };
  facets: {
    campaigns: CommercialFacetCampaign[];
    countries: string[];
    cities: string[];
    verticals: string[];
    subsegments: string[];
    channels: string[];
    angles: string[];
    templates: string[];
  };
};

export type CommercialLeadDetail = {
  id: string;
  campaign: CommercialFacetCampaign;
  business: {
    id: string;
    name: string;
    website: string | null;
    instagramHandle: string | null;
    city: string | null;
    country: string;
    vertical: string;
    subsegment: string | null;
    source: string;
    description: string | null;
    bookingUrl: string | null;
    status: string;
    enrichment: Record<string, unknown>;
    provenance: Record<string, unknown>;
    lastEnrichedAt: string | null;
  };
  contact: {
    id: string;
    name: string | null;
    role: string | null;
    email: string | null;
    instagramHandle: string | null;
    preferredChannel: string | null;
  } | null;
  qualification: {
    score: number | null;
    priority: string;
    status: string;
    personalizationContext: Record<string, unknown>;
    audienceContext: Record<string, unknown>;
    approvedBy: string | null;
    approvedAt: string | null;
    leadScore: number | null;
    scorePriority: string | null;
    scoringModelVersion: string | null;
    scoreBreakdown: Record<string, unknown>;
    aiConfidence: number | null;
    aiModel: string | null;
    aiPromptVersion: string | null;
    scoredAt: string | null;
    needsManualReview: boolean;
    hardGateCodes: string[];
  };
  outreach: {
    channel: string | null;
    angle: string | null;
    templateVersion: string | null;
    status: string;
  };
  sales: {
    status: string;
    ownerUserId: string | null;
  };
  conversion: {
    id: string;
    clientId: string;
    packageReference: string | null;
    checkoutSessionId: string | null;
    entitlementId: string | null;
    stripeBillingProfileId: string | null;
    stripeSubscriptionId: string | null;
    convertedAt: string;
    instagramAccountIds: string[];
  } | null;
  timeline: Array<{
    id: string;
    eventType: string;
    actorType: string;
    actorUserId: string | null;
    occurredAt: string;
    metadataSummary: Array<{ key: string; value: string }>;
  }>;
  createdAt: string;
  updatedAt: string;
};
