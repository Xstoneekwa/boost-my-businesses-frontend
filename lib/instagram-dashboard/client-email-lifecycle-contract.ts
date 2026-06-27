import type { ClientEmailTemplateCategory } from "./client-email-constants.ts";

export const CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES = [
  "account_paused",
  "account_canceled",
  "needs_assistance",
] as const;

export type ClientEmailLifecycleEpisodeCategory =
  (typeof CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES)[number];

export const CLIENT_EMAIL_LIFECYCLE_EPISODES_TABLE =
  "client_email_lifecycle_episodes" as const;

export const CLIENT_EMAIL_LIFECYCLE_EPISODE_STATUSES = ["active", "resolved", "canceled"] as const;
export type ClientEmailLifecycleEpisodeStatus =
  (typeof CLIENT_EMAIL_LIFECYCLE_EPISODE_STATUSES)[number];

export const CLIENT_EMAIL_LIFECYCLE_EPISODE_CLOSE_REASONS = [
  "lifecycle_state_cleared",
  "account_reactivated",
  "superseded_by_new_episode",
] as const;
export type ClientEmailLifecycleEpisodeCloseReason =
  (typeof CLIENT_EMAIL_LIFECYCLE_EPISODE_CLOSE_REASONS)[number];

export type ClientEmailLifecycleTransitionEvidence = {
  message: string;
  occurredAt: string;
  source: "ig_action_logs.account_admin_status_changed";
};

export const CLIENT_EMAIL_LIFECYCLE_START_AUDIT_MESSAGES: Record<
  ClientEmailLifecycleEpisodeCategory,
  string
> = {
  account_paused: "account_paused",
  account_canceled: "account_cancelled",
  needs_assistance: "account_marked_needs_assistance",
};

export const CLIENT_EMAIL_LIFECYCLE_RESOLVE_AUDIT_MESSAGES = [
  "account_reactivated",
] as const;

export type ClientEmailLifecyclePreviewDecision =
  | "would_open_episode_on_future_transition"
  | "would_keep_active"
  | "would_resolve_episode"
  | "legacy_state_no_backfill"
  | "no_action";

export type ClientEmailLifecycleDeliveryState =
  | "delivery_ready"
  | "blocked_missing_client_email"
  | "blocked_canceled_account"
  | "blocked_missing_transition_evidence";

export function readClientEmailLifecycleAutomationEnabledAt(
  env: Record<string, string | undefined> = process.env,
): Date | null {
  const raw = env.CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT?.trim() ?? "";
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeAdminLifecycleStatus(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function isLifecycleCategoryStateActive(
  category: ClientEmailLifecycleEpisodeCategory,
  adminLifecycleStatus: string,
) {
  const lifecycle = normalizeAdminLifecycleStatus(adminLifecycleStatus);
  if (category === "account_paused") return lifecycle === "paused";
  if (category === "account_canceled") {
    return lifecycle === "cancelled" || lifecycle === "canceled";
  }
  return lifecycle === "needs_assistance";
}

export function lifecycleCategoryCanonicalSource(
  category: ClientEmailLifecycleEpisodeCategory,
) {
  if (category === "needs_assistance") {
    return "ig_accounts.admin_lifecycle_status";
  }
  return "ig_accounts.admin_lifecycle_status";
}

export function buildLifecycleEpisodeKey(
  category: ClientEmailLifecycleEpisodeCategory,
  accountId: string,
  startedAtIso: string,
) {
  return `${category}:${accountId}:${startedAtIso}`;
}

export function buildLifecycleIntentIdempotencyKey(input: {
  category: ClientEmailLifecycleEpisodeCategory;
  accountId: string;
  episodeId: string;
  reminderIndex?: number;
}) {
  const reminderIndex = input.reminderIndex ?? 0;
  return `lifecycle:${input.category}:${input.accountId}:episode:${input.episodeId}:index:${reminderIndex}`;
}

export function planClientEmailLifecyclePreview(input: {
  category: ClientEmailLifecycleEpisodeCategory;
  adminLifecycleStatus: string;
  automationEnabledAt: Date | null;
  transitionEvidence: ClientEmailLifecycleTransitionEvidence | null;
  activeEpisodeStatus: ClientEmailLifecycleEpisodeStatus | null;
  clientEmailAvailable: boolean;
}): {
  currentStateActive: boolean;
  lifecycleDecision: ClientEmailLifecyclePreviewDecision;
  deliveryState: ClientEmailLifecycleDeliveryState;
  reason: string;
} {
  const currentStateActive = isLifecycleCategoryStateActive(
    input.category,
    input.adminLifecycleStatus,
  );
  const lifecycle = normalizeAdminLifecycleStatus(input.adminLifecycleStatus);
  const accountCanceled = lifecycle === "cancelled" || lifecycle === "canceled";

  if (input.activeEpisodeStatus === "active") {
    const lifecycleDecision: ClientEmailLifecyclePreviewDecision = currentStateActive
      ? "would_keep_active"
      : "would_resolve_episode";
    const deliveryState = deriveLifecycleDeliveryState({
      lifecycleDecision,
      clientEmailAvailable: input.clientEmailAvailable,
      accountCanceled,
      category: input.category,
    });
    return {
      currentStateActive,
      lifecycleDecision,
      deliveryState,
      reason: buildLifecyclePreviewReason({
        category: input.category,
        lifecycleDecision,
        deliveryState,
        currentStateActive,
        automationEnabledAt: input.automationEnabledAt,
        transitionEvidence: input.transitionEvidence,
      }),
    };
  }

  if (!currentStateActive) {
    return {
      currentStateActive,
      lifecycleDecision: "no_action",
      deliveryState: "blocked_missing_transition_evidence",
      reason: buildLifecyclePreviewReason({
        category: input.category,
        lifecycleDecision: "no_action",
        deliveryState: "blocked_missing_transition_evidence",
        currentStateActive,
        automationEnabledAt: input.automationEnabledAt,
        transitionEvidence: input.transitionEvidence,
      }),
    };
  }

  const transitionAfterActivation = Boolean(
    input.automationEnabledAt
    && input.transitionEvidence
    && new Date(input.transitionEvidence.occurredAt).getTime()
      >= input.automationEnabledAt.getTime(),
  );

  if (!input.automationEnabledAt || !transitionAfterActivation) {
    return {
      currentStateActive,
      lifecycleDecision: "legacy_state_no_backfill",
      deliveryState: "blocked_missing_transition_evidence",
      reason: buildLifecyclePreviewReason({
        category: input.category,
        lifecycleDecision: "legacy_state_no_backfill",
        deliveryState: "blocked_missing_transition_evidence",
        currentStateActive,
        automationEnabledAt: input.automationEnabledAt,
        transitionEvidence: input.transitionEvidence,
      }),
    };
  }

  return {
    currentStateActive,
    lifecycleDecision: "would_open_episode_on_future_transition",
    deliveryState: deriveLifecycleDeliveryState({
      lifecycleDecision: "would_open_episode_on_future_transition",
      clientEmailAvailable: input.clientEmailAvailable,
      accountCanceled,
      category: input.category,
    }),
    reason: buildLifecyclePreviewReason({
      category: input.category,
      lifecycleDecision: "would_open_episode_on_future_transition",
      deliveryState: deriveLifecycleDeliveryState({
        lifecycleDecision: "would_open_episode_on_future_transition",
        clientEmailAvailable: input.clientEmailAvailable,
        accountCanceled,
        category: input.category,
      }),
      currentStateActive,
      automationEnabledAt: input.automationEnabledAt,
      transitionEvidence: input.transitionEvidence,
    }),
  };
}

export function deriveLifecycleDeliveryState(input: {
  lifecycleDecision: ClientEmailLifecyclePreviewDecision;
  clientEmailAvailable: boolean;
  accountCanceled: boolean;
  category: ClientEmailLifecycleEpisodeCategory;
}): ClientEmailLifecycleDeliveryState {
  if (input.lifecycleDecision === "legacy_state_no_backfill") {
    return "blocked_missing_transition_evidence";
  }
  if (input.lifecycleDecision === "no_action") {
    return "blocked_missing_transition_evidence";
  }
  if (!input.clientEmailAvailable) return "blocked_missing_client_email";
  if (
    input.accountCanceled
    && input.category !== "account_canceled"
  ) {
    return "blocked_canceled_account";
  }
  return "delivery_ready";
}

function buildLifecyclePreviewReason(input: {
  category: ClientEmailLifecycleEpisodeCategory;
  lifecycleDecision: ClientEmailLifecyclePreviewDecision;
  deliveryState: ClientEmailLifecycleDeliveryState;
  currentStateActive: boolean;
  automationEnabledAt: Date | null;
  transitionEvidence: ClientEmailLifecycleTransitionEvidence | null;
}) {
  const parts: string[] = [];
  parts.push(`Category ${input.category.replaceAll("_", " ")} is ${input.currentStateActive ? "active" : "inactive"} on the canonical admin lifecycle status.`);
  parts.push(`Canonical source: ${lifecycleCategoryCanonicalSource(input.category)}.`);

  if (input.transitionEvidence) {
    parts.push(`Latest transition evidence: ${input.transitionEvidence.message} at ${input.transitionEvidence.occurredAt}.`);
  } else {
    parts.push("No durable post-activation transition evidence was found in ig_action_logs.");
  }

  if (!input.automationEnabledAt) {
    parts.push("Lifecycle email automation watermark is not configured yet, so historical states remain no-backfill.");
  } else {
    parts.push(`Automation watermark: ${input.automationEnabledAt.toISOString()}.`);
  }

  switch (input.lifecycleDecision) {
    case "would_open_episode_on_future_transition":
      parts.push("A future post-activation transition would open one initial email episode.");
      break;
    case "would_keep_active":
      parts.push("An active stored episode would remain open until the lifecycle state clears.");
      break;
    case "would_resolve_episode":
      parts.push("An active stored episode would resolve because the lifecycle state cleared.");
      break;
    case "legacy_state_no_backfill":
      parts.push("Historical lifecycle state detected before activation evidence; no retroactive email would be sent.");
      break;
    default:
      parts.push("No lifecycle email action is due.");
      break;
  }

  switch (input.deliveryState) {
    case "delivery_ready":
      parts.push("Canonical client email is available for a future initial send.");
      break;
    case "blocked_missing_client_email":
      parts.push("Delivery would remain blocked until a canonical client communication email is configured.");
      break;
    case "blocked_canceled_account":
      parts.push("Delivery would remain blocked because the account is canceled for a non-cancel category.");
      break;
    default:
      parts.push("Delivery would remain blocked until post-activation transition evidence exists.");
      break;
  }

  parts.push("Read-only preview — no database write, intent, or email was performed.");
  return parts.join(" ");
}

export function isLifecycleEpisodeCategory(
  value: string,
): value is ClientEmailLifecycleEpisodeCategory {
  return (CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES as readonly string[]).includes(value);
}

export function mapAuditMessageToLifecycleCategory(
  message: string,
): ClientEmailLifecycleEpisodeCategory | null {
  for (const category of CLIENT_EMAIL_LIFECYCLE_EPISODE_CATEGORIES) {
    if (CLIENT_EMAIL_LIFECYCLE_START_AUDIT_MESSAGES[category] === message) {
      return category;
    }
  }
  return null;
}

export function categoryLabel(category: ClientEmailTemplateCategory | ClientEmailLifecycleEpisodeCategory) {
  return category.replaceAll("_", " ");
}
