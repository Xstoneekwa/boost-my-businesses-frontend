import type { ClientAccountRow } from "./account-projection";
import { resolveClientAccountConnectionUi } from "./client-account-connection-ui";
import type { ClientAccountNotificationView } from "./client-account-notifications";
import type { ClientOverviewRecentFeedItem } from "./client-overview-recent-feed-projection";
import {
  buildAgencyOverviewSummary,
  buildAgencyPackageSummary,
  filterAgencyOverviewAccounts,
  paginateAgencyOverviewAccounts,
  type AgencyAccountFilter,
  type ClientAgencyOverviewAccountRow,
  type ClientAgencyOverviewSummary,
  type ClientAgencyPackageSummaryRow,
} from "./client-agency-overview-helpers";

export type ClientAgencyRecentFeedItem = ClientOverviewRecentFeedItem & {
  accountId: string;
  accountUsername: string;
};

export type ClientAgencyOverviewProjection = {
  summary: ClientAgencyOverviewSummary;
  packageSummary: ClientAgencyPackageSummaryRow[];
  recentFeed: ClientAgencyRecentFeedItem[];
  accounts: ClientAgencyOverviewAccountRow[];
  accountsTotal: number;
  page: number;
  pageSize: number;
};

export type {
  AgencyAccountFilter,
  ClientAgencyOverviewAccountRow,
  ClientAgencyOverviewSummary,
  ClientAgencyPackageSummaryRow,
};

export {
  buildAgencyOverviewSummary,
  buildAgencyPackageSummary,
  filterAgencyOverviewAccounts,
  isAgencyModeActive,
  matchesAgencyAccountSearch,
  paginateAgencyOverviewAccounts,
} from "./client-agency-overview-helpers";

function label(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function formatRelativeActivity(iso: string | null, lang: "fr" | "en") {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return label(lang, "Activité récente", "Recent activity");
  if (diffHours < 24) {
    return label(lang, `Activité il y a ${diffHours} h`, `Activity ${diffHours}h ago`);
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return label(lang, "Activité hier", "Activity yesterday");
  return label(lang, `Activité il y a ${diffDays} j`, `Activity ${diffDays}d ago`);
}

export function projectAgencyOverviewAccountRow(input: {
  account: ClientAccountRow;
  notificationsByAccount: Map<string, ClientAccountNotificationView[]>;
  passwordActionAccountIds: Set<string>;
  lastActivityAt: string | null;
}): ClientAgencyOverviewAccountRow {
  const ui = resolveClientAccountConnectionUi(input.account, "fr");
  const uiEn = resolveClientAccountConnectionUi(input.account, "en");
  const activeNotifications = input.notificationsByAccount.get(input.account.accountId) ?? [];
  const needsTargets = activeNotifications.some((row) => row.category === "needs_more_target_accounts");
  const hasNotificationAction = activeNotifications.some((row) => (
    row.category === "needs_more_target_accounts"
    || row.category === "needs_assistance"
    || row.category === "account_paused"
  ));
  const actionRequired = hasNotificationAction || input.passwordActionAccountIds.has(input.account.accountId);
  const campaignActive = input.account.accountStatus.toLowerCase() === "active" && input.account.connected;

  return {
    accountId: input.account.accountId,
    username: input.account.username,
    packageLabel: input.account.packageLabel,
    connectionLabelFr: ui.badgeLabel,
    connectionLabelEn: uiEn.badgeLabel,
    preparationLabelFr: ui.readinessLabel,
    preparationLabelEn: uiEn.readinessLabel,
    campaignActive,
    campaignLabelFr: campaignActive
      ? label("fr", "Campagne active", "Campaign active")
      : label("fr", "Campagne inactive", "Campaign inactive"),
    campaignLabelEn: campaignActive ? "Campaign active" : "Campaign inactive",
    needsTargets,
    needsTargetsLabelFr: needsTargets ? label("fr", "Cibles à compléter", "Targets to complete") : null,
    needsTargetsLabelEn: needsTargets ? "Targets to complete" : null,
    lastActivityAt: input.lastActivityAt,
    lastActivityLabelFr: formatRelativeActivity(input.lastActivityAt, "fr"),
    lastActivityLabelEn: formatRelativeActivity(input.lastActivityAt, "en"),
    actionRequired,
  };
}

export function isPreparingAccount(account: ClientAccountRow) {
  const ui = resolveClientAccountConnectionUi(account, "fr");
  return ui.phase === "preparing" || ui.phase === "connection_check" || ui.phase === "added";
}
