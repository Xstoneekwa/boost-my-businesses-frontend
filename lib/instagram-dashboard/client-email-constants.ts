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

export const CLIENT_EMAIL_SEND_TRIGGERS = [
  "manual",
  "automatic",
  "reminder",
  "manual_test",
  "automatic_initial",
  "automatic_reminder",
] as const;
export type ClientEmailSendTrigger = (typeof CLIENT_EMAIL_SEND_TRIGGERS)[number];

export const CLIENT_EMAIL_SEND_TRIGGER_LABELS: Record<ClientEmailSendTrigger, string> = {
  manual: "Manual",
  automatic: "Automatic",
  reminder: "Reminder",
  manual_test: "Test delivery",
  automatic_initial: "Automatic initial",
  automatic_reminder: "Automatic reminder",
};

export const CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCE_STATUSES = ["active", "resolved", "canceled"] as const;
export type ClientEmailNeedsMoreTargetsSequenceStatus =
  (typeof CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCE_STATUSES)[number];

export const CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCE_CLOSE_REASONS = [
  "eligible_targets_above_threshold",
  "needs_more_signal_resolved",
  "account_canceled",
] as const;
export type ClientEmailNeedsMoreTargetsSequenceCloseReason =
  (typeof CLIENT_EMAIL_NEEDS_MORE_TARGETS_SEQUENCE_CLOSE_REASONS)[number];

export const CLIENT_EMAIL_INTENT_KINDS = ["client", "test"] as const;
export type ClientEmailIntentKind = (typeof CLIENT_EMAIL_INTENT_KINDS)[number];

export const CLIENT_EMAIL_TEST_DELIVERY_LABEL = "Test delivery" as const;

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

/** Campaign starts when eligible target count reaches this value (distinct from needs-more signal threshold). */
export const CLIENT_EMAIL_NEEDS_MORE_CAMPAIGN_READY_THRESHOLD = 6;

/** First product-active reminder offset from needs_more_active_since (UTC). */
export const CLIENT_EMAIL_NEEDS_MORE_FIRST_REMINDER_OFFSET_HOURS = 24;

/** Reminder indexes active in TASK 18A product (future indexes reserved in schedule). */
export const CLIENT_EMAIL_PRODUCT_ACTIVE_NEEDS_MORE_REMINDER_INDEXES = [0] as const;

export const CLIENT_EMAIL_REMINDER_OFFSETS_HOURS = [
  { reminderIndex: 0, label: "first_reminder_24h", offsetHours: CLIENT_EMAIL_NEEDS_MORE_FIRST_REMINDER_OFFSET_HOURS },
  { reminderIndex: 1, label: "+48h_reserved", offsetHours: 48 },
  { reminderIndex: 2, label: "+5_days_reserved", offsetHours: 5 * 24 },
  { reminderIndex: 3, label: "+9_days_reserved", offsetHours: 9 * 24 },
  { reminderIndex: 4, label: "+14_days_reserved", offsetHours: 14 * 24 },
  { reminderIndex: 5, label: "+21_days_reserved", offsetHours: 21 * 24 },
] as const;

export const CLIENT_EMAIL_NEEDS_MORE_DEFAULT_SUBJECT =
  "Complétez le ciblage pour @{{instagram_username}}";

export const CLIENT_EMAIL_NEEDS_MORE_DEFAULT_BODY_TEXT = [
  "Bonjour {{client_name}},",
  "",
  "Votre compte @{{instagram_username}} compte {{eligible_target_count}} compte(s) cible prêt(s) pour la campagne (objectif : {{target_threshold}}).",
  "",
  "Ajoutez quelques comptes cibles pour lancer votre campagne :",
  "{{dashboard_url}}",
  "",
  "Besoin d'aide ? {{support_email}}",
].join("\n");

export const CLIENT_EMAIL_PREVIEW_SAMPLE_VALUES: Record<ClientEmailAllowedVariable, string> = {
  client_name: "Acme Growth Co.",
  instagram_username: "xstonekwa_backup_acc",
  account_status: "active",
  eligible_target_count: "4",
  target_threshold: "6",
  dashboard_url: "https://app.boostmybusinesses.com/instagram-client?view=targeting&account=preview-account",
  support_email: CLIENT_EMAIL_LOCKED_FROM,
};

export const CLIENT_EMAIL_TEST_DEMO_VALUES: Record<ClientEmailAllowedVariable, string> = {
  client_name: "Test Customer",
  instagram_username: "test_account",
  account_status: "test",
  eligible_target_count: "5",
  target_threshold: "6",
  dashboard_url: "https://app.boostmybusinesses.com/instagram-client?view=targeting&account=preview-account",
  support_email: CLIENT_EMAIL_LOCKED_FROM,
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

export const CLIENT_EMAIL_FORBIDDEN_TEST_RECIPIENT_FIELDS = [
  "recipient",
  "recipient_email",
  "to",
  "to_email",
  "email",
  "client_email",
  "contact_email",
] as const;
