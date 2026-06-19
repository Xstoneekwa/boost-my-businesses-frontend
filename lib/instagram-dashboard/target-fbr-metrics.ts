import { readString } from "../instagram-client/guards.ts";
import {
  evaluateTargetFollowbackMetricsReliability,
  type TargetMetricsRow,
} from "./target-auto-archive-low-fbr-policy.ts";

export type TargetFbrMetricsInput = TargetMetricsRow;

export type ResolvedTargetFbrMetrics = {
  metricsReliable: boolean;
  reliabilityReason: string;
  followsSent: number;
  followbacksCount: number;
  rawFollowbackRatio: number | null;
  fbrPercent: number | null;
};

function readCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function readRatio(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveTargetFbrMetrics(row: TargetFbrMetricsInput): ResolvedTargetFbrMetrics {
  const reliability = evaluateTargetFollowbackMetricsReliability(row);
  const followsSent = readCount(row.follows_sent_count);
  const followbacksCount = readCount(row.followbacks_count);
  const storedRatio = readRatio(row.followback_ratio);
  const rawFollowbackRatio = storedRatio
    ?? (followsSent > 0 ? (followbacksCount / followsSent) * 100 : null);

  return {
    metricsReliable: reliability.metricsReliable,
    reliabilityReason: reliability.reason,
    followsSent,
    followbacksCount,
    rawFollowbackRatio,
    fbrPercent: reliability.metricsReliable ? rawFollowbackRatio : null,
  };
}

export function targetFbrAdminLabel(
  fbrPercent: number | null,
  followsSent: number | null,
  metricsReliable = true,
) {
  if (followsSent === null || followsSent <= 0) return "—";
  if (!metricsReliable) return "Non mesuré";
  if (fbrPercent === null) return "—";
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(fbrPercent)}%`;
}

export function targetFbrClientLabel(
  fbrPercent: number | null,
  followsSent: number | null,
  metricsReliable = true,
  lang: "fr" | "en" = "fr",
) {
  if (followsSent === null || followsSent <= 0) return "—";
  if (!metricsReliable) return lang === "fr" ? "Données en cours" : "Data pending";
  if (fbrPercent === null) return "—";
  return `${new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en", { maximumFractionDigits: 1 }).format(fbrPercent)}%`;
}

export function targetFbrBotAppLabel(
  fbrPercent: number | null,
  followsSent: number | null,
  metricsReliable = true,
) {
  if (followsSent === null || followsSent <= 0) return "—";
  if (!metricsReliable) return "Not measured";
  if (fbrPercent === null) return "—";
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(fbrPercent)}%`;
}

export function readFollowbacksMetricsReliableAt(row: Record<string, unknown>) {
  return readString(row.followbacks_metrics_reliable_at, "") || null;
}
