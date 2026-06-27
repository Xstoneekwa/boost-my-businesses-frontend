import type { ClientEmailIntentKind, ClientEmailTemplateCategory } from "./client-email-constants.ts";
import type { ClientEmailLifecycleEpisodeCategory } from "./client-email-lifecycle-contract.ts";

export const CLIENT_EMAIL_INTENT_PARENT_CONSTRAINTS = {
  parentExclusivity: "client_email_send_intents_parent_exclusivity",
  testKindRequiresNoRefs: "client_email_send_intents_test_kind_requires_no_refs",
  clientParentRequiresRefs: "client_email_send_intents_client_parent_requires_refs",
} as const;

export type ClientEmailIntentParentType = "sequence" | "lifecycle_episode" | null;

export type ClientEmailIntentParentRefs = {
  intentKind: ClientEmailIntentKind;
  category: ClientEmailTemplateCategory;
  sequenceId: string | null;
  lifecycleEpisodeId: string | null;
};

const LIFECYCLE_INTENT_CATEGORIES: readonly ClientEmailLifecycleEpisodeCategory[] = [
  "account_paused",
  "account_canceled",
  "needs_assistance",
];

export function isLifecycleIntentCategory(
  category: ClientEmailTemplateCategory,
): category is ClientEmailLifecycleEpisodeCategory {
  return (LIFECYCLE_INTENT_CATEGORIES as readonly string[]).includes(category);
}

export function validateClientEmailIntentParentRefs(
  refs: ClientEmailIntentParentRefs,
): { valid: true } | { valid: false; reason: string } {
  const hasSequence = Boolean(refs.sequenceId);
  const hasLifecycleEpisode = Boolean(refs.lifecycleEpisodeId);

  if (refs.intentKind === "test") {
    if (hasSequence || hasLifecycleEpisode) {
      return { valid: false, reason: "test_intent_must_not_reference_sequence_or_lifecycle_episode" };
    }
    return { valid: true };
  }

  if (hasSequence && hasLifecycleEpisode) {
    return { valid: false, reason: "intent_cannot_reference_both_sequence_and_lifecycle_episode" };
  }

  if (refs.category === "needs_more_target_accounts") {
    if (!hasSequence || hasLifecycleEpisode) {
      return { valid: false, reason: "needs_more_intent_requires_sequence_parent_only" };
    }
    return { valid: true };
  }

  if (isLifecycleIntentCategory(refs.category)) {
    if (!hasLifecycleEpisode || hasSequence) {
      return { valid: false, reason: "lifecycle_intent_requires_lifecycle_episode_parent_only" };
    }
    return { valid: true };
  }

  return { valid: false, reason: "unknown_client_intent_category" };
}

export function resolveClientEmailIntentParentType(
  refs: ClientEmailIntentParentRefs,
): ClientEmailIntentParentType {
  const validation = validateClientEmailIntentParentRefs(refs);
  if (!validation.valid) return null;
  if (refs.intentKind === "test") return null;
  if (refs.sequenceId) return "sequence";
  if (refs.lifecycleEpisodeId) return "lifecycle_episode";
  return null;
}
