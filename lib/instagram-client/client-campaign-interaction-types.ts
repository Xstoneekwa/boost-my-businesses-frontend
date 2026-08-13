export type ClientSocialActionKind = "follow" | "unfollow" | "like" | "dm" | "story";

export type ClientCampaignInteractionRule = {
  actionType: string;
  aliases?: string[];
  activityKey: string;
  activityLabel: { fr: string; en: string };
  filterOrder?: number;
  overviewActionKind?: ClientSocialActionKind;
  countInCampaignInteractions: boolean;
  successOnly: boolean;
  clientLabel: { fr: string; en: string };
  note?: string;
};

export const CLIENT_PRODUCT_ACTION_TYPES: ClientCampaignInteractionRule[] = [
  {
    actionType: "unfollow_sent",
    aliases: ["unfollow", "unfollow_verified"],
    activityKey: "unfollow_sent",
    activityLabel: { fr: "Unfollow", en: "Unfollow" },
    filterOrder: 20,
    overviewActionKind: "unfollow",
    countInCampaignInteractions: true,
    successOnly: true,
    clientLabel: { fr: "Unfollow", en: "Unfollow" },
  },
  {
    actionType: "follow_sent",
    aliases: ["follow", "follow_verified_persisted_v1"],
    activityKey: "follow_sent",
    activityLabel: { fr: "Follow", en: "Follow" },
    filterOrder: 10,
    overviewActionKind: "follow",
    countInCampaignInteractions: true,
    successOnly: true,
    clientLabel: { fr: "Follow", en: "Follow" },
  },
  {
    actionType: "like_sent",
    aliases: ["post_like_success", "like"],
    activityKey: "post_like_success",
    activityLabel: { fr: "Publication aimée", en: "Post liked" },
    filterOrder: 30,
    overviewActionKind: "like",
    countInCampaignInteractions: true,
    successOnly: true,
    clientLabel: { fr: "Publication aimée", en: "Post liked" },
  },
  {
    actionType: "outreach_dm_sent",
    aliases: ["outreach_dm"],
    activityKey: "dm_sent",
    activityLabel: { fr: "Message envoyé", en: "Message sent" },
    filterOrder: 50,
    overviewActionKind: "dm",
    countInCampaignInteractions: true,
    successOnly: true,
    clientLabel: { fr: "Message envoyé", en: "Message sent" },
  },
  {
    actionType: "welcome_dm_sent",
    aliases: ["welcome_dm"],
    activityKey: "dm_sent",
    activityLabel: { fr: "Message envoyé", en: "Message sent" },
    filterOrder: 50,
    overviewActionKind: "dm",
    countInCampaignInteractions: true,
    successOnly: true,
    clientLabel: { fr: "Message envoyé", en: "Message sent" },
  },
  {
    actionType: "dm_sent",
    aliases: ["dm"],
    activityKey: "dm_sent",
    activityLabel: { fr: "Message envoyé", en: "Message sent" },
    filterOrder: 50,
    overviewActionKind: "dm",
    countInCampaignInteractions: false,
    successOnly: true,
    clientLabel: { fr: "Message envoyé", en: "Message sent" },
    note: "Generic DM events remain activity-visible but do not enter campaign totals without canonical job evidence.",
  },
  {
    actionType: "story_viewed",
    aliases: ["story_view", "story"],
    activityKey: "story_viewed",
    activityLabel: { fr: "Story consultée", en: "Story viewed" },
    filterOrder: 40,
    overviewActionKind: "story",
    countInCampaignInteractions: false,
    successOnly: true,
    clientLabel: { fr: "Story consultée", en: "Story viewed" },
    note: "Story receipts remain activity-visible but outside campaign totals pending a canonical persisted producer.",
  },
  {
    actionType: "mute_success",
    aliases: ["mute"],
    activityKey: "mute_success",
    activityLabel: { fr: "Compte mis en sourdine", en: "Account muted" },
    filterOrder: 80,
    countInCampaignInteractions: false,
    successOnly: true,
    clientLabel: { fr: "Compte mis en sourdine", en: "Account muted" },
    note: "Excluded from campaign interaction totals pending explicit product decision.",
  },
  {
    actionType: "target_add_single",
    aliases: ["target_add_bulk"],
    activityKey: "target_add_single",
    activityLabel: { fr: "Compte cible ajouté", en: "Target added" },
    filterOrder: 60,
    countInCampaignInteractions: false,
    successOnly: false,
    clientLabel: { fr: "Compte cible ajouté", en: "Target added" },
  },
  {
    actionType: "target_archive",
    activityKey: "target_archive",
    activityLabel: { fr: "Compte cible retiré", en: "Target removed" },
    filterOrder: 70,
    countInCampaignInteractions: false,
    successOnly: false,
    clientLabel: { fr: "Compte cible retiré", en: "Target removed" },
  },
  {
    actionType: "target_restore",
    activityKey: "target_restore",
    activityLabel: { fr: "Compte cible restauré", en: "Target restored" },
    countInCampaignInteractions: false,
    successOnly: false,
    clientLabel: { fr: "Compte cible restauré", en: "Target restored" },
  },
  {
    actionType: "target_reset",
    activityKey: "target_reset",
    activityLabel: { fr: "Compte cible réinitialisé", en: "Target reset" },
    countInCampaignInteractions: false,
    successOnly: false,
    clientLabel: { fr: "Compte cible réinitialisé", en: "Target reset" },
  },
  {
    actionType: "target_verify",
    activityKey: "target_verify",
    activityLabel: { fr: "Compte cible vérifié", en: "Target verified" },
    countInCampaignInteractions: false,
    successOnly: false,
    clientLabel: { fr: "Compte cible vérifié", en: "Target verified" },
  },
  {
    actionType: "target_quality_decision",
    activityKey: "target_quality_decision",
    activityLabel: { fr: "Décision sur compte cible", en: "Target decision" },
    countInCampaignInteractions: false,
    successOnly: false,
    clientLabel: { fr: "Décision sur compte cible", en: "Target decision" },
  },
];

// Backward-compatible export: this remains the one canonical client action catalogue.
export const CLIENT_CAMPAIGN_INTERACTION_TYPES = CLIENT_PRODUCT_ACTION_TYPES;

const HIDDEN_OR_INTERNAL_EVENT_TYPES = new Set([
  "follow_verified",
  "mute_posts_verified",
  "return_ct_exact",
  "target_selected",
  "target_budget_reached",
  "follow_requested",
  "profile_visit",
]);

const BLOCKED_EVENT_STATUSES = ["failed", "error", "skipped", "blocked", "dry_run", "cancelled"];

function normalizeToken(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function matchesAlias(token: string, alias: string) {
  return token === alias
    || token.startsWith(`${alias}_`)
    || token.endsWith(`_${alias}`)
    || token.includes(`_${alias}_`);
}

export function isHiddenClientInteractionEventType(value: unknown) {
  return HIDDEN_OR_INTERNAL_EVENT_TYPES.has(normalizeToken(value));
}

export function resolveClientProductActionRule(input: {
  eventType?: unknown;
  interactionType?: unknown;
  operation?: unknown;
}) {
  const eventType = normalizeToken(input.eventType);
  if (eventType && isHiddenClientInteractionEventType(eventType)) return null;

  const tokens = [eventType, normalizeToken(input.interactionType), normalizeToken(input.operation)].filter(Boolean);
  for (const rule of CLIENT_PRODUCT_ACTION_TYPES) {
    const aliases = [rule.actionType, ...(rule.aliases ?? [])];
    if (tokens.some((token) => aliases.some((alias) => matchesAlias(token, alias)))) return rule;
  }
  return null;
}

export function resolveClientCampaignInteractionRule(input: {
  eventType?: unknown;
  interactionType?: unknown;
}) {
  return resolveClientProductActionRule(input);
}

export function clientActivityActionOptions(lang: "fr" | "en") {
  const seen = new Set<string>();
  const options = CLIENT_PRODUCT_ACTION_TYPES
    .filter((rule) => rule.filterOrder != null)
    .sort((left, right) => (left.filterOrder ?? 999) - (right.filterOrder ?? 999))
    .flatMap((rule) => {
      if (seen.has(rule.activityKey)) return [];
      seen.add(rule.activityKey);
      return [{ value: rule.activityKey, label: rule.activityLabel[lang] }];
    });
  return [{ value: "all", label: lang === "fr" ? "Toutes les actions" : "All actions" }, ...options];
}

export const CLIENT_OVERVIEW_ACTION_COPY = {
  follow: {
    category: { fr: "Follows", en: "Follows" },
    summary: { fr: ["Follow envoyé", "Follows envoyés"], en: ["Follow sent", "Follows sent"] },
  },
  unfollow: {
    category: { fr: "Unfollows", en: "Unfollows" },
    summary: { fr: ["Unfollow", "Unfollows"], en: ["Unfollow", "Unfollows"] },
  },
  like: {
    category: { fr: "J'aime", en: "Likes" },
    summary: { fr: ["publication aimée", "publications aimées"], en: ["post liked", "posts liked"] },
  },
  dm: {
    category: { fr: "Messages", en: "Messages" },
    summary: { fr: ["message envoyé", "messages envoyés"], en: ["message sent", "messages sent"] },
  },
  story: {
    category: { fr: "Stories", en: "Stories" },
    summary: { fr: ["story consultée", "stories consultées"], en: ["story viewed", "stories viewed"] },
  },
} as const;

export function shouldCountClientCampaignInteractionEvent(row: Record<string, unknown>) {
  const rule = resolveClientCampaignInteractionRule({
    eventType: row.event_type,
    interactionType: row.interaction_type,
  });
  if (!rule?.countInCampaignInteractions) return false;
  if (!rule.successOnly) return true;

  const status = normalizeToken(row.event_status ?? row.interaction_status ?? "success");
  if (!status) return true;
  return !BLOCKED_EVENT_STATUSES.some((blocked) => status.includes(blocked));
}
