export const COMMERCIAL_OUTREACH_CHANNELS = ["instagram", "email"] as const;
export const COMMERCIAL_OUTREACH_ANGLES = ["A", "B"] as const;
export const COMMERCIAL_OUTREACH_TEMPLATE_KEYS = [
  "IG_BEAUTY_ANGLE_A_V1",
  "IG_BEAUTY_ANGLE_B_V1",
  "EMAIL_BEAUTY_ANGLE_A_V1",
  "EMAIL_BEAUTY_ANGLE_B_V1",
] as const;
export const COMMERCIAL_OUTREACH_STATES = [
  "draft",
  "generating",
  "ready_for_review",
  "approved_for_send",
  "queued_dry_run",
  "cancelled",
  "generation_failed",
] as const;

export const COMMERCIAL_OUTREACH_STATUS_TABS = ["ready", "approved", "failed", "cancelled", "all"] as const;
export const COMMERCIAL_OUTREACH_SORTS = ["newest", "confidence"] as const;

export const COMMERCIAL_OUTREACH_PROMPT_VERSION = "commercial_outreach_message_quality_v2";

export type CommercialOutreachChannel = (typeof COMMERCIAL_OUTREACH_CHANNELS)[number];
export type CommercialOutreachAngle = (typeof COMMERCIAL_OUTREACH_ANGLES)[number];
export type CommercialOutreachTemplateKey = (typeof COMMERCIAL_OUTREACH_TEMPLATE_KEYS)[number];
export type CommercialOutreachState = (typeof COMMERCIAL_OUTREACH_STATES)[number];
export type CommercialOutreachStatusTab = (typeof COMMERCIAL_OUTREACH_STATUS_TABS)[number];
export type CommercialOutreachSort = (typeof COMMERCIAL_OUTREACH_SORTS)[number];

export type CommercialOutreachFact = {
  key: string;
  value: string;
  source: string;
};

export type CommercialOutreachGeneratedMessage = {
  subject: string | null;
  body: string;
  channel: CommercialOutreachChannel;
  angle: CommercialOutreachAngle;
  template_version: CommercialOutreachTemplateKey;
  personalization_summary: string;
  facts_used: Array<{ key: string; value: string }>;
  confidence: number;
};

export type CommercialOutreachItem = {
  id: string;
  leadId: string;
  campaignId: string;
  businessName: string;
  city: string | null;
  subsegment: string | null;
  priority: string;
  score: number | null;
  channel: CommercialOutreachChannel;
  angle: CommercialOutreachAngle;
  templateKey: CommercialOutreachTemplateKey;
  templateVersion: string;
  state: CommercialOutreachState;
  subject: string | null;
  body: string | null;
  personalizationSummary: string | null;
  factsUsed: Array<{ key: string; value: string }>;
  confidence: number | null;
  validationCodes: string[];
  attemptCount: number;
  maxAttempts: number;
  generationModel: string | null;
  generationPromptVersion: string | null;
  generatedAt: string | null;
  approvedAt: string | null;
  ownerEdited: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  instagramHandle: string | null;
  website: string | null;
  bookingUrl: string | null;
  instagramBio: string | null;
  personalizationContext: Array<{ label: string; value: string }>;
  audienceContext: Array<{ label: string; value: string }>;
  history: Array<{
    id: string;
    eventType: string;
    actorType: string;
    occurredAt: string;
  }>;
};

export type CommercialOutreachQueueItem = {
  id: string;
  businessName: string;
  city: string | null;
  subsegment: string | null;
  priority: string;
  score: number | null;
  channel: CommercialOutreachChannel;
  angle: CommercialOutreachAngle;
  templateKey: CommercialOutreachTemplateKey;
  templateVersion: string;
  state: CommercialOutreachState;
  confidence: number | null;
  attemptCount: number;
  maxAttempts: number;
  messageExcerpt: string | null;
  ownerEdited: boolean;
  version: number;
  updatedAt: string;
};

export type CommercialOutreachReadFilters = {
  status: CommercialOutreachStatusTab;
  channel?: CommercialOutreachChannel;
  angle?: CommercialOutreachAngle;
  template?: CommercialOutreachTemplateKey;
  sort: CommercialOutreachSort;
  page: number;
  pageSize: number;
  selectedItemId?: string;
  search?: string;
};

export type CommercialOutreachMetrics = {
  generated: number;
  generationFailed: number;
  readyForReview: number;
  approvedDryRun: number;
  cancelled: number;
  byChannel: Record<string, number>;
  byAngle: Record<string, number>;
  byTemplate: Record<string, number>;
};

export type CommercialOutreachReadModel = {
  items: CommercialOutreachQueueItem[];
  selectedItem: CommercialOutreachItem | null;
  filters: CommercialOutreachReadFilters;
  pagination: { page: number; pageSize: number; pageCount: number; total: number };
  facets: {
    channels: CommercialOutreachChannel[];
    angles: CommercialOutreachAngle[];
    templates: CommercialOutreachTemplateKey[];
  };
  metrics: CommercialOutreachMetrics;
  delivery: {
    realEmailSend: false;
    realInstagramDmSend: false;
    phoneFarmDmExecution: false;
  };
};

type OutreachQueryValue = string | string[] | undefined;

function firstQueryValue(value: OutreachQueryValue) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseCommercialOutreachReadFilters(params: Record<string, OutreachQueryValue>): CommercialOutreachReadFilters {
  const rawStatus = firstQueryValue(params.outreach_tab);
  const rawChannel = firstQueryValue(params.outreach_channel);
  const rawAngle = firstQueryValue(params.outreach_angle);
  const rawTemplate = firstQueryValue(params.outreach_template);
  const rawSort = firstQueryValue(params.outreach_sort);
  const rawPage = Number(firstQueryValue(params.outreach_page));
  const rawItem = firstQueryValue(params.outreach_item);
  const rawSearch = firstQueryValue(params.outreach_search).normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
  return {
    status: COMMERCIAL_OUTREACH_STATUS_TABS.includes(rawStatus as CommercialOutreachStatusTab) ? rawStatus as CommercialOutreachStatusTab : "ready",
    channel: COMMERCIAL_OUTREACH_CHANNELS.includes(rawChannel as CommercialOutreachChannel) ? rawChannel as CommercialOutreachChannel : undefined,
    angle: COMMERCIAL_OUTREACH_ANGLES.includes(rawAngle as CommercialOutreachAngle) ? rawAngle as CommercialOutreachAngle : undefined,
    template: COMMERCIAL_OUTREACH_TEMPLATE_KEYS.includes(rawTemplate as CommercialOutreachTemplateKey) ? rawTemplate as CommercialOutreachTemplateKey : undefined,
    sort: COMMERCIAL_OUTREACH_SORTS.includes(rawSort as CommercialOutreachSort) ? rawSort as CommercialOutreachSort : "newest",
    page: Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1,
    pageSize: 24,
    selectedItemId: /^[0-9a-f-]{36}$/i.test(rawItem) ? rawItem : undefined,
    search: rawSearch || undefined,
  };
}

export type CommercialOutreachMutationAction =
  | "approve_message"
  | "regenerate"
  | "cancel"
  | "change_selection"
  | "edit_message";

export type CommercialOutreachMutation = {
  action: CommercialOutreachMutationAction;
  expectedVersion: number;
  idempotencyKey: string;
  patch: {
    channel?: CommercialOutreachChannel;
    angle?: CommercialOutreachAngle;
    subject?: string | null;
    body?: string;
    reason?: string;
    contentHash?: string;
  };
};

export function commercialOutreachTemplateKey(
  channel: CommercialOutreachChannel,
  angle: CommercialOutreachAngle,
): CommercialOutreachTemplateKey {
  if (channel === "instagram") return angle === "A" ? "IG_BEAUTY_ANGLE_A_V1" : "IG_BEAUTY_ANGLE_B_V1";
  return angle === "A" ? "EMAIL_BEAUTY_ANGLE_A_V1" : "EMAIL_BEAUTY_ANGLE_B_V1";
}
