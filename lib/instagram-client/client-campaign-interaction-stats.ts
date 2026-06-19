import {
  businessDayKeyFromIso,
  businessMonthKeyFromIso,
  DEFAULT_BUSINESS_TIMEZONE,
  normalizeBusinessTimezone,
  zonedDateParts,
} from "../instagram-dashboard/business-timezone.ts";
import { resolveClientCampaignInteractionRule, shouldCountClientCampaignInteractionEvent } from "./client-campaign-interaction-types.ts";

type SafeRecord = Record<string, unknown>;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return fallback;
}

function readEventAt(row: SafeRecord) {
  return readString(row.event_at, "") || readString(row.created_at, "");
}

export type ClientCampaignInteractionOverview = {
  monthInteractions: number;
  todayInteractions: number;
  businessTimezone: string;
};

export type ClientCampaignInteractionBreakdown = {
  monthByActionType: Record<string, number>;
  todayByActionType: Record<string, number>;
  monthTotal: number;
  todayTotal: number;
  businessTimezone: string;
};

export function computeClientCampaignInteractionBreakdown(
  eventRows: SafeRecord[],
  timezone?: string | null,
  now = new Date(),
): ClientCampaignInteractionBreakdown {
  const businessTimezone = normalizeBusinessTimezone(timezone);
  const nowParts = zonedDateParts(now, businessTimezone);
  const currentMonthKey = `${String(nowParts.year).padStart(4, "0")}-${String(nowParts.month).padStart(2, "0")}`;
  const todayKey = `${currentMonthKey}-${String(nowParts.day).padStart(2, "0")}`;
  const monthByActionType: Record<string, number> = {};
  const todayByActionType: Record<string, number> = {};
  const seenIds = new Set<string>();

  for (const row of eventRows) {
    if (!shouldCountClientCampaignInteractionEvent(row)) continue;
    const id = readString(row.id, "");
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    const rule = resolveClientCampaignInteractionRule({
      eventType: row.event_type,
      interactionType: row.interaction_type,
    });
    const actionType = rule?.actionType ?? "unknown";
    const occurredAt = readEventAt(row);
    if (!occurredAt) continue;
    const dayKey = businessDayKeyFromIso(occurredAt, businessTimezone);
    const monthKey = businessMonthKeyFromIso(occurredAt, businessTimezone);
    if (monthKey === currentMonthKey) {
      monthByActionType[actionType] = (monthByActionType[actionType] ?? 0) + 1;
    }
    if (dayKey === todayKey) {
      todayByActionType[actionType] = (todayByActionType[actionType] ?? 0) + 1;
    }
  }

  const monthTotal = Object.values(monthByActionType).reduce((sum, count) => sum + count, 0);
  const todayTotal = Object.values(todayByActionType).reduce((sum, count) => sum + count, 0);
  return {
    monthByActionType,
    todayByActionType,
    monthTotal,
    todayTotal,
    businessTimezone,
  };
}

export function computeClientCampaignInteractionOverview(
  eventRows: SafeRecord[],
  timezone?: string | null,
  now = new Date(),
): ClientCampaignInteractionOverview {
  const businessTimezone = normalizeBusinessTimezone(timezone);
  const nowParts = zonedDateParts(now, businessTimezone);
  const currentMonthKey = `${String(nowParts.year).padStart(4, "0")}-${String(nowParts.month).padStart(2, "0")}`;
  const todayKey = `${currentMonthKey}-${String(nowParts.day).padStart(2, "0")}`;

  let monthInteractions = 0;
  let todayInteractions = 0;
  const seenIds = new Set<string>();

  for (const row of eventRows) {
    if (!shouldCountClientCampaignInteractionEvent(row)) continue;
    const id = readString(row.id, "");
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }

    const occurredAt = readEventAt(row);
    if (!occurredAt) continue;

    const dayKey = businessDayKeyFromIso(occurredAt, businessTimezone);
    const monthKey = businessMonthKeyFromIso(occurredAt, businessTimezone);
    if (monthKey === currentMonthKey) monthInteractions += 1;
    if (dayKey === todayKey) todayInteractions += 1;
  }

  return {
    monthInteractions,
    todayInteractions,
    businessTimezone,
  };
}

export function defaultClientBusinessTimezone() {
  return DEFAULT_BUSINESS_TIMEZONE;
}
