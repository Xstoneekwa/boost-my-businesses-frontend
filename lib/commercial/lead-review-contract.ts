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

export type CommercialReviewQueue = {
  needsApproval: { rows: CommercialReviewLead[]; total: number; page: number; pageSize: number };
  readyForOutreach: { rows: CommercialReviewLead[]; total: number; page: number; pageSize: number };
};

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
