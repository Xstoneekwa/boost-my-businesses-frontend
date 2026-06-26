export const CLIENT_EMAIL_LOCKED_FROM = "growth@boostmybusinesses.com" as const;

export const CLIENT_EMAIL_TEMPLATE_CATEGORIES = [
  "account_paused",
  "account_canceled",
  "needs_assistance",
  "needs_more_target_accounts",
] as const;

export type ClientEmailTemplateCategory = (typeof CLIENT_EMAIL_TEMPLATE_CATEGORIES)[number];

export const CLIENT_EMAIL_ALLOWED_VARIABLES = [
  "client_name",
  "instagram_username",
  "account_status",
  "eligible_target_count",
  "target_threshold",
  "dashboard_url",
  "support_email",
] as const;

export type ClientEmailAllowedVariable = (typeof CLIENT_EMAIL_ALLOWED_VARIABLES)[number];

export const CLIENT_EMAIL_CATEGORY_LABELS: Record<ClientEmailTemplateCategory, string> = {
  account_paused: "Account paused",
  account_canceled: "Account canceled",
  needs_assistance: "Needs assistance",
  needs_more_target_accounts: "Needs more target accounts",
};

export const CLIENT_EMAIL_SEND_TRIGGERS = ["manual", "automatic", "reminder"] as const;
export type ClientEmailSendTrigger = (typeof CLIENT_EMAIL_SEND_TRIGGERS)[number];

export const CLIENT_EMAIL_INTENT_STATUSES = ["pending", "scheduled", "sent", "canceled", "failed"] as const;
export type ClientEmailIntentStatus = (typeof CLIENT_EMAIL_INTENT_STATUSES)[number];

export const CLIENT_EMAIL_DELIVERY_STATUSES = [
  "queued",
  "sent",
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "complained",
  "suppressed",
] as const;
export type ClientEmailDeliveryStatus = (typeof CLIENT_EMAIL_DELIVERY_STATUSES)[number];

export const CLIENT_EMAIL_MAX_REMINDER_INDEX = 5;
export const CLIENT_EMAIL_MAX_SENDS_PER_NEED = CLIENT_EMAIL_MAX_REMINDER_INDEX + 1;

export const CLIENT_EMAIL_REMINDER_OFFSETS_HOURS = [
  { reminderIndex: 0, label: "initial", offsetHours: 0 },
  { reminderIndex: 1, label: "+48h", offsetHours: 48 },
  { reminderIndex: 2, label: "+5 days", offsetHours: 5 * 24 },
  { reminderIndex: 3, label: "+9 days", offsetHours: 9 * 24 },
  { reminderIndex: 4, label: "+14 days", offsetHours: 14 * 24 },
  { reminderIndex: 5, label: "+21 days", offsetHours: 21 * 24 },
] as const;

export const CLIENT_EMAIL_PREVIEW_SAMPLE_VALUES: Record<ClientEmailAllowedVariable, string> = {
  client_name: "Acme Growth Co.",
  instagram_username: "xstonekwa_backup_acc",
  account_status: "active",
  eligible_target_count: "4",
  target_threshold: "5",
  dashboard_url: "https://app.boostmybusinesses.com/instagram-client",
  support_email: "support@boostmybusinesses.com",
};

export const CLIENT_EMAIL_FORBIDDEN_REQUEST_FIELDS = [
  "from_email",
  "provider",
  "provider_api_key",
  "api_key",
  "secret",
  "token",
  "webhook_secret",
] as const;
