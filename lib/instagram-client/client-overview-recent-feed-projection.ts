import {
  resolveClientCampaignInteractionRule,
  shouldCountClientCampaignInteractionEvent,
} from "./client-campaign-interaction-types.ts";
import {
  businessDayKeyFromIso,
  normalizeBusinessTimezone,
} from "../instagram-dashboard/business-timezone.ts";
import { readString } from "./guards.ts";

export type OverviewRecentFeedActionKind = "follow" | "like" | "dm" | "story" | "unfollow";

export const OVERVIEW_RECENT_FEED_ACTIVE_BUSINESS_DAYS = 2;
export const OVERVIEW_RECENT_FEED_MAX_GROUPS = 5;

export type OverviewRecentFeedSourceEvent = {
  id: string;
  eventType: string;
  eventStatus?: string | null;
  interactionType?: string | null;
  eventAt: string;
  sourceTargetUsername: string | null;
  touchedUsername: string | null;
  accountId: string | null;
  businessDayKey: string;
  actionKind: OverviewRecentFeedActionKind;
};

export type ClientOverviewRecentFeedItem = {
  id: string;
  actionKind: OverviewRecentFeedActionKind;
  count: number;
  distinctTouchedCount: number;
  sourceTargetUsername: string | null;
  businessDayKey: string;
  summaryFr: string;
  summaryEn: string;
  categoryLabelFr: string;
  categoryLabelEn: string;
  latestAt: string;
  touchedUsernames: string[];
  overflowCount: number;
  iconKind: "fo" | "li" | "dm" | "st" | "uf";
};

function normalizeUsername(value: unknown) {
  const raw = readString(value, "").trim().replace(/^@+/, "").toLowerCase();
  return raw || null;
}

function pluralFr(count: number, singular: string, plural: string) {
  return count > 1 ? plural : singular;
}

export function resolveOverviewFeedActionKind(row: Record<string, unknown>): OverviewRecentFeedActionKind | null {
  const eventType = readString(row.event_type ?? row.eventType, "").toLowerCase();
  const interactionType = readString(row.interaction_type ?? row.interactionType, "").toLowerCase();
  const tokens = [eventType, interactionType].filter(Boolean);

  if (tokens.some((token) => token.includes("unfollow"))) return "unfollow";
  if (tokens.some((token) => token.includes("story"))) return "story";
  if (tokens.some((token) => token.includes("like"))) return "like";
  if (tokens.some((token) => token.includes("dm"))) return "dm";
  if (tokens.some((token) => token.includes("follow"))) return "follow";

  const rule = resolveClientCampaignInteractionRule({
    eventType: row.event_type ?? row.eventType,
    interactionType: row.interaction_type ?? row.interactionType,
  });
  if (!rule?.countInCampaignInteractions) return null;

  const actionType = readString(rule.actionType, "").toLowerCase();
  if (actionType === "follow_sent") return "follow";
  if (actionType === "unfollow_sent") return "unfollow";
  if (actionType === "like_sent") return "like";
  if (actionType === "dm_sent") return "dm";
  if (actionType === "story_viewed") return "story";
  return null;
}

function iconKindForAction(actionKind: OverviewRecentFeedActionKind): ClientOverviewRecentFeedItem["iconKind"] {
  if (actionKind === "follow") return "fo";
  if (actionKind === "like") return "li";
  if (actionKind === "dm") return "dm";
  if (actionKind === "story") return "st";
  return "uf";
}

function categoryLabels(actionKind: OverviewRecentFeedActionKind) {
  const map = {
    follow: { fr: "Abonnements", en: "Follows" },
    like: { fr: "J'aime", en: "Likes" },
    dm: { fr: "Messages", en: "Messages" },
    story: { fr: "Stories", en: "Stories" },
    unfollow: { fr: "Retraits", en: "Removals" },
  } as const;
  return map[actionKind];
}

function buildSummary(
  actionKind: OverviewRecentFeedActionKind,
  count: number,
  sourceTargetUsername: string | null,
  lang: "fr" | "en",
) {
  const source = sourceTargetUsername ? `@${sourceTargetUsername}` : null;
  const n = count.toLocaleString(lang === "fr" ? "fr-FR" : "en-US");

  if (lang === "en") {
    if (actionKind === "follow") {
      return source
        ? `${n} follow${count > 1 ? "s" : ""} sent from ${source}`
        : `${n} follow${count > 1 ? "s" : ""} sent`;
    }
    if (actionKind === "like") {
      return source
        ? `${n} post${count > 1 ? "s" : ""} liked from ${source}`
        : `${n} post${count > 1 ? "s" : ""} liked`;
    }
    if (actionKind === "dm") {
      return source
        ? `${n} message${count > 1 ? "s" : ""} sent from ${source}`
        : `${n} message${count > 1 ? "s" : ""} sent`;
    }
    if (actionKind === "story") {
      return source
        ? `${n} stor${count > 1 ? "ies" : "y"} viewed from ${source}`
        : `${n} stor${count > 1 ? "ies" : "y"} viewed`;
    }
    return `${n} account${count > 1 ? "s" : ""} removed from the campaign`;
  }

  if (actionKind === "follow") {
    return source
      ? `${n} ${pluralFr(count, "abonnement envoyé", "abonnements envoyés")} à partir de ${source}`
      : `${n} ${pluralFr(count, "abonnement envoyé", "abonnements envoyés")}`;
  }
  if (actionKind === "like") {
    return source
      ? `${n} ${pluralFr(count, "publication aimée", "publications aimées")} à partir de ${source}`
      : `${n} ${pluralFr(count, "publication aimée", "publications aimées")}`;
  }
  if (actionKind === "dm") {
    return source
      ? `${n} ${pluralFr(count, "message envoyé", "messages envoyés")} à partir de ${source}`
      : `${n} ${pluralFr(count, "message envoyé", "messages envoyés")}`;
  }
  if (actionKind === "story") {
    return source
      ? `${n} ${pluralFr(count, "story consultée", "stories consultées")} à partir de ${source}`
      : `${n} ${pluralFr(count, "story consultée", "stories consultées")}`;
  }
  return `${n} ${pluralFr(count, "compte retiré de la campagne", "comptes retirés de la campagne")}`;
}

export function resolveOverviewFeedGroupKey(input: {
  accountId?: string | null;
  actionKind: OverviewRecentFeedActionKind;
  sourceTargetUsername: string | null;
  businessDayKey: string;
}) {
  const account = input.accountId ?? "__none__";
  const source = input.sourceTargetUsername ?? "__none__";
  return `${account}::${input.businessDayKey}::${input.actionKind}::${source}`;
}

export function resolveOverviewRecentActiveBusinessDays(
  events: Array<{ businessDayKey: string }>,
  activeDayCount = OVERVIEW_RECENT_FEED_ACTIVE_BUSINESS_DAYS,
) {
  const uniqueDays = [...new Set(events.map((event) => event.businessDayKey).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  return uniqueDays.slice(0, Math.max(activeDayCount, 1));
}

function shouldIncludeTouchedUsername(
  touchedUsername: string | null,
  accountUsername: string | null,
  sourceTargetUsername: string | null,
) {
  if (!touchedUsername) return false;
  if (accountUsername && touchedUsername === accountUsername) return false;
  if (sourceTargetUsername && touchedUsername === sourceTargetUsername) return false;
  return true;
}

export function mapOverviewRecentFeedSourceEvent(
  row: Record<string, unknown>,
  options: { businessTimezone?: string | null; accountId?: string | null } = {},
): OverviewRecentFeedSourceEvent | null {
  const rowAccountId = readString(row.account_id, "");
  if (options.accountId && rowAccountId && rowAccountId !== options.accountId) return null;

  if (!shouldCountClientCampaignInteractionEvent(row)) return null;

  const actionKind = resolveOverviewFeedActionKind(row);
  if (!actionKind) return null;

  const eventAt = readString(row.event_at, "") || readString(row.created_at, "");
  if (!eventAt) return null;

  const businessTimezone = normalizeBusinessTimezone(options.businessTimezone);
  const businessDayKey = businessDayKeyFromIso(eventAt, businessTimezone);
  if (!businessDayKey) return null;

  return {
    id: readString(row.id, `${actionKind}-${eventAt}`),
    eventType: readString(row.event_type, ""),
    eventStatus: readString(row.event_status, ""),
    interactionType: readString(row.interaction_type, ""),
    eventAt,
    sourceTargetUsername: normalizeUsername(row.source_target_username),
    touchedUsername: normalizeUsername(row.username),
    accountId: rowAccountId || null,
    businessDayKey,
    actionKind,
  };
}

function collectOverviewRecentFeedEvents(
  rows: Record<string, unknown>[],
  options: {
    accountId?: string | null;
    businessTimezone?: string | null;
  },
) {
  const accountId = readString(options.accountId, "") || null;
  const businessTimezone = normalizeBusinessTimezone(options.businessTimezone);
  const seenIds = new Set<string>();
  const events: OverviewRecentFeedSourceEvent[] = [];

  for (const row of rows) {
    const event = mapOverviewRecentFeedSourceEvent(row, { businessTimezone, accountId });
    if (!event || seenIds.has(event.id)) continue;
    seenIds.add(event.id);
    events.push(event);
  }

  return events;
}

export function buildOverviewRecentFeedGroupDetails(
  rows: Record<string, unknown>[],
  options: {
    accountUsername?: string | null;
    accountId?: string | null;
    businessTimezone?: string | null;
    activeBusinessDays?: number;
  } = {},
) {
  const accountUsername = normalizeUsername(options.accountUsername);
  const accountId = readString(options.accountId, "") || null;
  const activeBusinessDays = Math.max(options.activeBusinessDays ?? OVERVIEW_RECENT_FEED_ACTIVE_BUSINESS_DAYS, 1);
  const events = collectOverviewRecentFeedEvents(rows, {
    accountId,
    businessTimezone: options.businessTimezone,
  });
  const activeDays = resolveOverviewRecentActiveBusinessDays(events, activeBusinessDays);
  if (!activeDays.length) return [];

  const activeDaySet = new Set(activeDays);
  const groups = new Map<string, {
    groupKey: string;
    actionKind: OverviewRecentFeedActionKind;
    sourceTargetUsername: string | null;
    businessDayKey: string;
    count: number;
    latestAt: string;
    touched: string[];
    ids: string[];
  }>();

  for (const event of events) {
    if (!activeDaySet.has(event.businessDayKey)) continue;

    const groupKey = resolveOverviewFeedGroupKey({
      accountId: event.accountId ?? accountId,
      actionKind: event.actionKind,
      sourceTargetUsername: event.sourceTargetUsername,
      businessDayKey: event.businessDayKey,
    });

    const existing = groups.get(groupKey);
    if (!existing) {
      groups.set(groupKey, {
        groupKey,
        actionKind: event.actionKind,
        sourceTargetUsername: event.sourceTargetUsername,
        businessDayKey: event.businessDayKey,
        count: 1,
        latestAt: event.eventAt,
        touched: shouldIncludeTouchedUsername(event.touchedUsername, accountUsername, event.sourceTargetUsername)
          ? [event.touchedUsername!]
          : [],
        ids: [event.id],
      });
      continue;
    }

    existing.count += 1;
    if (event.eventAt > existing.latestAt) existing.latestAt = event.eventAt;
    if (
      shouldIncludeTouchedUsername(event.touchedUsername, accountUsername, event.sourceTargetUsername)
      && event.touchedUsername
      && !existing.touched.includes(event.touchedUsername)
    ) {
      existing.touched.push(event.touchedUsername);
    }
    existing.ids.push(event.id);
  }

  return [...groups.values()].sort((left, right) => right.latestAt.localeCompare(left.latestAt));
}

export function buildClientOverviewRecentFeed(
  rows: Record<string, unknown>[],
  options: {
    lang?: "fr" | "en";
    limit?: number;
    accountUsername?: string | null;
    accountId?: string | null;
    businessTimezone?: string | null;
    activeBusinessDays?: number;
  } = {},
): ClientOverviewRecentFeedItem[] {
  const lang = options.lang === "en" ? "en" : "fr";
  const limit = Math.min(Math.max(options.limit ?? OVERVIEW_RECENT_FEED_MAX_GROUPS, 1), OVERVIEW_RECENT_FEED_MAX_GROUPS);

  const groups = buildOverviewRecentFeedGroupDetails(rows, {
    accountUsername: options.accountUsername,
    accountId: options.accountId,
    businessTimezone: options.businessTimezone,
    activeBusinessDays: options.activeBusinessDays,
  });

  return groups
    .slice(0, limit)
    .map((group) => {
      const labels = categoryLabels(group.actionKind);
      const visibleTouched = group.touched.slice(0, 3);
      const distinctTouchedCount = group.touched.length;
      const overflowCount = Math.max(0, distinctTouchedCount - visibleTouched.length);

      return {
        id: `${group.actionKind}-${group.sourceTargetUsername ?? "none"}-${group.businessDayKey}`,
        actionKind: group.actionKind,
        count: group.count,
        distinctTouchedCount,
        sourceTargetUsername: group.sourceTargetUsername,
        businessDayKey: group.businessDayKey,
        summaryFr: buildSummary(group.actionKind, group.count, group.sourceTargetUsername, "fr"),
        summaryEn: buildSummary(group.actionKind, group.count, group.sourceTargetUsername, "en"),
        categoryLabelFr: labels.fr,
        categoryLabelEn: labels.en,
        latestAt: group.latestAt,
        touchedUsernames: visibleTouched,
        overflowCount,
        iconKind: iconKindForAction(group.actionKind),
      } satisfies ClientOverviewRecentFeedItem;
    });
}

export function formatOverviewRecentFeedBusinessDate(businessDayKey: string, lang: "fr" | "en") {
  const [year, month, day] = businessDayKey.split("-").map(Number);
  if (!year || !month || !day) return lang === "fr" ? "Récemment" : "Recently";
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (Number.isNaN(date.getTime())) return lang === "fr" ? "Récemment" : "Recently";
  return date.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    day: "numeric",
  });
}

/** @deprecated Use formatOverviewRecentFeedBusinessDate with businessDayKey */
export function formatOverviewRecentFeedTimestamp(value: string, lang: "fr" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return lang === "fr" ? "Récemment" : "Recently";
  return date.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    day: "numeric",
  });
}
