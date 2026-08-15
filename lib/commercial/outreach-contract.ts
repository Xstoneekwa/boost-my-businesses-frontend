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

export const COMMERCIAL_OUTREACH_PROMPT_VERSION = "commercial_outreach_prompt_v1";

export type CommercialOutreachChannel = (typeof COMMERCIAL_OUTREACH_CHANNELS)[number];
export type CommercialOutreachAngle = (typeof COMMERCIAL_OUTREACH_ANGLES)[number];
export type CommercialOutreachTemplateKey = (typeof COMMERCIAL_OUTREACH_TEMPLATE_KEYS)[number];
export type CommercialOutreachState = (typeof COMMERCIAL_OUTREACH_STATES)[number];

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
  generatedAt: string | null;
  approvedAt: string | null;
  ownerEdited: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  history: Array<{
    id: string;
    eventType: string;
    actorType: string;
    occurredAt: string;
  }>;
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
  items: CommercialOutreachItem[];
  metrics: CommercialOutreachMetrics;
  delivery: {
    realEmailSend: false;
    realInstagramDmSend: false;
    phoneFarmDmExecution: false;
  };
};

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
