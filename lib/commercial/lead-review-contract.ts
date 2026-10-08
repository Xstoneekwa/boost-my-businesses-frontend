export const COMMERCIAL_REVIEW_CHANNELS = ["instagram", "email"] as const;
export const COMMERCIAL_REVIEW_ANGLES = ["A", "B"] as const;
export const COMMERCIAL_REVIEW_PRIORITIES = ["urgent", "high", "normal", "low"] as const;

export const COMMERCIAL_REVIEW_ANGLE_LABELS = {
  A: "Growth / competitors / underused visibility",
  B: "Acquisition / potential customers in relevant audiences",
} as const;

export const COMMERCIAL_REJECTION_REASONS = [
  ["not_a_fit", "Not a fit"],
  ["low_quality_instagram", "Low quality Instagram"],
  ["too_small_no_budget_signal", "Too small / no budget signal"],
  ["no_clear_business_activity", "No clear business activity"],
  ["poor_targeting_potential", "Poor targeting potential"],
  ["duplicate", "Duplicate"],
  ["other", "Other"],
] as const;

export type CommercialReviewChannel = (typeof COMMERCIAL_REVIEW_CHANNELS)[number];
export type CommercialReviewAngle = (typeof COMMERCIAL_REVIEW_ANGLES)[number];
export type CommercialReviewPriority = (typeof COMMERCIAL_REVIEW_PRIORITIES)[number];
export type CommercialRejectionReason = (typeof COMMERCIAL_REJECTION_REASONS)[number][0];
export type CommercialReviewAction = "approve" | "reject" | "update_context";

export type CommercialReviewPatch = {
  outreachChannel?: CommercialReviewChannel | null;
  messageAngle?: CommercialReviewAngle | null;
  priority?: CommercialReviewPriority;
  personalizationNote?: string;
  audienceNote?: string;
  rejectionReason?: CommercialRejectionReason;
  rejectionNote?: string;
};

export type CommercialReviewMutation = {
  action: CommercialReviewAction;
  expectedVersion: number;
  idempotencyKey: string;
  patch: CommercialReviewPatch;
};

export type CommercialReviewLead = {
  id: string;
  campaignId: string;
  campaignName: string;
  businessName: string;
  city: string | null;
  subsegment: string | null;
  website: string | null;
  instagramHandle: string | null;
  score: number | null;
  priority: string;
  qualificationStatus: string;
  outreachStatus: string;
  outreachChannel: string | null;
  messageAngle: string | null;
  personalizationContext: Record<string, unknown>;
  audienceContext: Record<string, unknown>;
  lastActivityType: string | null;
  lastActivityAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const COMMERCIAL_REVIEW_SORTS = ["priority", "score", "newest", "oldest"] as const;
export type CommercialReviewSort = (typeof COMMERCIAL_REVIEW_SORTS)[number];

export type CommercialReviewQueueItem = Omit<
  CommercialReviewLead,
  "personalizationContext" | "audienceContext" | "website"
> & {
  reasoningExcerpt: string | null;
};

export type CommercialReviewReadFilters = {
  scope?: "canary" | "all";
  priority?: CommercialReviewPriority;
  city?: string;
  subsegment?: string;
  channel?: CommercialReviewChannel;
  angle?: CommercialReviewAngle;
  minimumScore?: number;
  sort: CommercialReviewSort;
  page: number;
  pageSize: number;
  selectedLeadId?: string;
  search?: string;
};

export type CommercialReviewReadModel = {
  items: CommercialReviewQueueItem[];
  selectedLead: CommercialReviewLead | null;
  filters: CommercialReviewReadFilters;
  pagination: { total: number; page: number; pageSize: number; pageCount: number };
  metrics: { p1: number; p2: number; readyForOutreach: number };
};

type ReviewQueryValue = string | string[] | undefined;

function firstQueryValue(value: ReviewQueryValue) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function cleanQueryText(value: ReviewQueryValue, max = 120) {
  return firstQueryValue(value).normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
}

export function parseCommercialReviewReadFilters(params: Record<string, ReviewQueryValue>): CommercialReviewReadFilters {
  const rawPriority = firstQueryValue(params.review_priority);
  const rawChannel = firstQueryValue(params.review_channel);
  const rawAngle = firstQueryValue(params.review_angle);
  const rawSort = firstQueryValue(params.review_sort);
  const rawPage = Number(firstQueryValue(params.review_page));
  const rawScore = Number(firstQueryValue(params.review_score));
  const rawLead = firstQueryValue(params.review_lead);
  const city = cleanQueryText(params.review_city);
  const subsegment = cleanQueryText(params.review_subsegment);
  const search = cleanQueryText(params.review_search);

  return {
    scope: firstQueryValue(params.review_scope) === "all" ? "all" : "canary",
    priority: COMMERCIAL_REVIEW_PRIORITIES.includes(rawPriority as CommercialReviewPriority) ? rawPriority as CommercialReviewPriority : undefined,
    city: city || undefined,
    subsegment: subsegment || undefined,
    channel: COMMERCIAL_REVIEW_CHANNELS.includes(rawChannel as CommercialReviewChannel) ? rawChannel as CommercialReviewChannel : undefined,
    angle: COMMERCIAL_REVIEW_ANGLES.includes(rawAngle as CommercialReviewAngle) ? rawAngle as CommercialReviewAngle : undefined,
    minimumScore: [60, 70, 80, 90].includes(rawScore) ? rawScore : undefined,
    sort: COMMERCIAL_REVIEW_SORTS.includes(rawSort as CommercialReviewSort) ? rawSort as CommercialReviewSort : "priority",
    page: Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1,
    pageSize: 24,
    selectedLeadId: /^[0-9a-f-]{36}$/i.test(rawLead) ? rawLead : undefined,
    search: search || undefined,
  };
}

export type CommercialReviewMutationResult = {
  ok: true;
  idempotentReplay: boolean;
  reviewAction: CommercialReviewAction;
  leadId: string;
  eventId: string;
  qualificationStatus: string;
  outreachStatus: string;
  outreachChannel: string | null;
  messageAngle: string | null;
  priority: string;
  version: number;
};
