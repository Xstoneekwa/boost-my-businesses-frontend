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

export const OVERVIEW_RECENT_FEED_WINDOW_DAYS = 14;
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
  sessionKey: string | null;
  businessDayKey: string;
};

export type ClientOverviewRecentFeedItem = {
  id: string;
  actionKind: OverviewRecentFeedActionKind;
  count: number;
  distinctTouchedCount: number;
  sourceTargetUsername: string | null;
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

function subtractCalendarDays(dayKey: string, days: number) {
  const [year, month, day] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day - days, 12, 0, 0, 0));
  return utc.toISOString().slice(0, 10);
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

export function resolveOverviewFeedSessionKey(row: Record<string, unknown>) {
  const runId = readString(row.run_id, "");
  if (runId) return `run:${runId}`;

  const requestId = readString(row.request_id, "");
  if (requestId) return `req:${requestId}`;

  const sessionId = readString(row.session_id, "");
  if (sessionId) return `sess:${sessionId}`;

  return null;
}

export function resolveOverviewFeedGroupKey(input: {
  actionKind: OverviewRecentFeedActionKind;
  sourceTargetUsername: string | null;
  sessionKey: string | null;
  businessDayKey: string;
}) {
  const source = input.sourceTargetUsername ?? "__none__";
  const bucket = input.sessionKey ?? `day:${input.businessDayKey}`;
  return `${input.actionKind}::${source}::${bucket}`;
}

export function eventInOverviewRecentBusinessWindow(
  eventAt: string,
  timezone: string,
  windowDays: number,
  now: Date,
) {
  const eventDay = businessDayKeyFromIso(eventAt, timezone);
  const todayDay = businessDayKeyFromIso(now.toISOString(), timezone);
  if (!eventDay || !todayDay) return false;
  const minDay = subtractCalendarDays(todayDay, Math.max(windowDays - 1, 0));
  return eventDay >= minDay && eventDay <= todayDay;
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

  return {
    id: readString(row.id, `${actionKind}-${eventAt}`),
    eventType: readString(row.event_type, ""),
    eventStatus: readString(row.event_status, ""),
    interactionType: readString(row.interaction_type, ""),
    eventAt,
    sourceTargetUsername: normalizeUsername(row.source_target_username),
    touchedUsername: normalizeUsername(row.username),
    accountId: rowAccountId || null,
    sessionKey: resolveOverviewFeedSessionKey(row),
    businessDayKey: businessDayKeyFromIso(eventAt, businessTimezone),
  };
}

export function buildOverviewRecentFeedGroupDetails(
  rows: Record<string, unknown>[],
  options: {
    accountUsername?: string | null;
    accountId?: string | null;
    businessTimezone?: string | null;
    windowDays?: number;
    now?: Date;
  } = {},
) {
  const accountUsername = normalizeUsername(options.accountUsername);
  const accountId = readString(options.accountId, "") || null;
  const businessTimezone = normalizeBusinessTimezone(options.businessTimezone);
  const windowDays = Math.max(options.windowDays ?? OVERVIEW_RECENT_FEED_WINDOW_DAYS, 1);
  const now = options.now ?? new Date();

  const groups = new Map<string, {
    groupKey: string;
    actionKind: OverviewRecentFeedActionKind;
    sourceTargetUsername: string | null;
    count: number;
    latestAt: string;
    touched: string[];
    ids: string[];
  }>();

  for (const row of rows) {
    const event = mapOverviewRecentFeedSourceEvent(row, { businessTimezone, accountId });
    if (!event) continue;
    if (!eventInOverviewRecentBusinessWindow(event.eventAt, businessTimezone, windowDays, now)) continue;

    const actionKind = resolveOverviewFeedActionKind(row);
    if (!actionKind) continue;

    const groupKey = resolveOverviewFeedGroupKey({
      actionKind,
      sourceTargetUsername: event.sourceTargetUsername,
      sessionKey: event.sessionKey,
      businessDayKey: event.businessDayKey,
    });

    const existing = groups.get(groupKey);
    if (!existing) {
      groups.set(groupKey, {
        groupKey,
        actionKind,
        sourceTargetUsername: event.sourceTargetUsername,
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
    windowDays?: number;
    now?: Date;
  } = {},
): ClientOverviewRecentFeedItem[] {
  const lang = options.lang === "en" ? "en" : "fr";
  const limit = Math.min(Math.max(options.limit ?? OVERVIEW_RECENT_FEED_MAX_GROUPS, 1), OVERVIEW_RECENT_FEED_MAX_GROUPS);
  const accountUsername = normalizeUsername(options.accountUsername);
  const accountId = readString(options.accountId, "") || null;
  const businessTimezone = normalizeBusinessTimezone(options.businessTimezone);
  const windowDays = Math.max(options.windowDays ?? OVERVIEW_RECENT_FEED_WINDOW_DAYS, 1);
  const now = options.now ?? new Date();

  const groups = buildOverviewRecentFeedGroupDetails(rows, {
    accountUsername,
    accountId,
    businessTimezone,
    windowDays,
    now,
  });

  return groups
    .slice(0, limit)
    .map((group) => {
      const labels = categoryLabels(group.actionKind);
      const visibleTouched = group.touched.slice(0, 3);
      const distinctTouchedCount = group.touched.length;
      const overflowCount = Math.max(0, distinctTouchedCount - visibleTouched.length);

      return {
        id: `${group.actionKind}-${group.sourceTargetUsername ?? "none"}-${group.latestAt}`,
        actionKind: group.actionKind,
        count: group.count,
        distinctTouchedCount,
        sourceTargetUsername: group.sourceTargetUsername,
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

export function formatOverviewRecentFeedTimestamp(value: string, lang: "fr" | "en") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return lang === "fr" ? "Récemment" : "Recently";

  return date.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
