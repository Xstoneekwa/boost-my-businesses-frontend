import type { ClientAccountRow } from "./account-projection";
import type { TargetEligibilityCounts } from "../instagram-dashboard/account-target-eligibility";
import { NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD } from "../instagram-dashboard/needs-more-target-accounts.ts";

export type ClientAgencyTargetingAccountRow = {
  accountId: string;
  username: string;
  packageLabel: string;
  addedCount: number;
  eligibleCount: number;
  pendingCount: number;
  statusFr: string;
  statusEn: string;
  needsMoreTargets: boolean;
};

export type ClientAgencyTargetingSummary = {
  readyAccounts: number;
  needsCompletionAccounts: number;
  collectingAccounts: number;
};

export type ClientAgencyTargetingProjection = {
  summary: ClientAgencyTargetingSummary;
  accounts: ClientAgencyTargetingAccountRow[];
};

export function projectAgencyTargetingAccountRow(
  account: ClientAccountRow,
  counts: TargetEligibilityCounts,
): ClientAgencyTargetingAccountRow {
  const eligibleCount = counts.eligible;
  const addedCount = counts.total;
  const pendingCount = counts.pending;
  const needsMoreTargets = eligibleCount <= NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD;

  let statusFr = "Prêt";
  let statusEn = "Ready";
  if (needsMoreTargets && pendingCount > 0 && eligibleCount > 0) {
    statusFr = "À compléter";
    statusEn = "Needs completion";
  } else if (needsMoreTargets) {
    statusFr = "À compléter";
    statusEn = "Needs completion";
  } else if (pendingCount > 0) {
    statusFr = "En cours de collecte";
    statusEn = "Collection in progress";
  }

  return {
    accountId: account.accountId,
    username: account.username,
    packageLabel: account.packageLabel,
    addedCount,
    eligibleCount,
    pendingCount,
    statusFr,
    statusEn,
    needsMoreTargets,
  };
}

export function buildAgencyTargetingSummary(
  rows: ClientAgencyTargetingAccountRow[],
): ClientAgencyTargetingSummary {
  return {
    readyAccounts: rows.filter((row) => !row.needsMoreTargets).length,
    needsCompletionAccounts: rows.filter((row) => row.needsMoreTargets).length,
    collectingAccounts: rows.filter((row) => row.pendingCount > 0 && row.eligibleCount <= NEEDS_MORE_TARGET_ACCOUNTS_THRESHOLD).length,
  };
}
