export type ClientCampaignInteractionRule = {
  actionType: string;
  aliases?: string[];
  countInCampaignInteractions: boolean;
  successOnly: boolean;
  clientLabel: { fr: string; en: string };
  note?: string;
};

export const CLIENT_CAMPAIGN_INTERACTION_TYPES: ClientCampaignInteractionRule[] = [
  {
    actionType: "follow_sent",
    aliases: ["follow"],
    countInCampaignInteractions: true,
    successOnly: true,
    clientLabel: { fr: "Abonnement envoyé", en: "Follow sent" },
  },
  {
    actionType: "unfollow_sent",
    aliases: ["unfollow"],
    countInCampaignInteractions: true,
    successOnly: true,
    clientLabel: { fr: "Désabonnement envoyé", en: "Unfollow sent" },
  },
  {
    actionType: "like_sent",
    aliases: ["post_like_success", "like"],
    countInCampaignInteractions: true,
    successOnly: true,
    clientLabel: { fr: "Like envoyé", en: "Like sent" },
  },
  {
    actionType: "dm_sent",
    aliases: ["dm"],
    countInCampaignInteractions: true,
    successOnly: true,
    clientLabel: { fr: "DM envoyé", en: "DM sent" },
  },
  {
    actionType: "story_viewed",
    aliases: ["story_view"],
    countInCampaignInteractions: true,
    successOnly: true,
    clientLabel: { fr: "Story consultée", en: "Story viewed" },
  },
  {
    actionType: "mute_success",
    countInCampaignInteractions: false,
    successOnly: true,
    clientLabel: { fr: "Compte mis en sourdine", en: "Account muted" },
    note: "Excluded from campaign interaction totals pending explicit product decision.",
  },
];

const HIDDEN_OR_INTERNAL_EVENT_TYPES = new Set([
  "follow_verified",
  "target_selected",
  "target_budget_reached",
  "follow_requested",
  "profile_visit",
]);

const BLOCKED_EVENT_STATUSES = ["failed", "error", "skipped", "blocked", "dry_run", "cancelled"];

function normalizeToken(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function resolveClientCampaignInteractionRule(input: {
  eventType?: unknown;
  interactionType?: unknown;
}) {
  const eventType = normalizeToken(input.eventType);
  const interactionType = normalizeToken(input.interactionType);
  const tokens = [eventType, interactionType].filter(Boolean);
  if (tokens.some((token) => HIDDEN_OR_INTERNAL_EVENT_TYPES.has(token))) return null;

  for (const rule of CLIENT_CAMPAIGN_INTERACTION_TYPES) {
    const aliases = [rule.actionType, ...(rule.aliases ?? [])];
    if (tokens.some((token) => aliases.includes(token) || aliases.some((alias) => token.includes(alias)))) {
      return rule;
    }
  }

  return null;
}

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
