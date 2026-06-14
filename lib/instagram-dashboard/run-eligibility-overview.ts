import { getManageData } from "@/app/instagram-dashboard/manage-data";
import {
  evaluateRunStartEligibility,
  getRunControlHealthProjection,
  runStartBlockDescription,
  runStartBlockMessage,
  type RunControlHealthProjection,
} from "@/lib/instagram-dashboard/run-control";

export type RunEligibilityOverviewItem = {
  account_id: string;
  username: string;
  readiness_status: string;
  eligibility_status: "ready" | "blocked";
  play_enabled: boolean;
  reason: string;
  primary_block_reason: string | null;
  reason_label: string;
  reason_description: string;
  message: string;
};

export type RunEligibilityOverviewSummary = {
  total: number;
  play_ready: number;
  blocked: number;
  needs_assignment: number;
  needs_credentials_or_login: number;
};

export type RunEligibilityOverview = {
  run_control: RunControlHealthProjection;
  requested_run_type: string;
  accounts: RunEligibilityOverviewItem[];
  summary: RunEligibilityOverviewSummary;
};

const assignmentReasons = new Set([
  "assignment_missing",
  "assignment_window_closed",
  "assignment_slot_conflict",
  "phone_rest_active",
  "outreach_rest_reserved",
  "no_app_instance_available",
  "device_unavailable",
  "assignment_profile_mismatch",
]);

const credentialsOrLoginReasons = new Set([
  "credentials_review_required",
  "reauth_required",
  "login_verification_required",
  "identity_mismatch_review_required",
  "account_needs_assistance",
]);

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function buildRunEligibilityOverview(
  requestedRunType = "account_session",
  concurrency = 5,
): Promise<RunEligibilityOverview> {
  const [runControl, manageData] = await Promise.all([
    getRunControlHealthProjection(),
    getManageData(),
  ]);

  const activeAccounts = manageData.activeAccounts.filter((account) => Boolean(account.accountId));
  const accounts = await mapWithConcurrency(activeAccounts, concurrency, async (account) => {
    const eligibility = await evaluateRunStartEligibility(account.accountId, requestedRunType, { trigger: "manual" });
    const readinessStatus = account.readinessProjection?.overall_readiness_status ?? "unknown";
    const readyReason = eligibility.ok && "reason" in eligibility ? eligibility.reason : "ready";
    const technicalReady =
      readyReason === "technical_run_allowed_outside_campaign_window" ||
      readyReason === "technical_run_allowed_manual_only";
    const message = eligibility.ok
      ? technicalReady
        ? "Technical account run is ready now."
        : "Manual run is ready."
      : runStartBlockMessage(eligibility.reason);
    return {
      account_id: account.accountId,
      username: account.username,
      readiness_status: readinessStatus,
      eligibility_status: eligibility.ok ? "ready" : "blocked",
      play_enabled: eligibility.ok === true,
      reason: eligibility.ok ? readyReason : eligibility.reason,
      primary_block_reason: eligibility.ok ? null : eligibility.reason,
      reason_label: eligibility.ok ? "Ready" : message,
      reason_description: eligibility.ok
        ? technicalReady
          ? "Technical account run is allowed without a campaign schedule window."
          : "Account settings and run eligibility are ready for this manual run."
        : runStartBlockDescription(eligibility.reason),
      message,
    } satisfies RunEligibilityOverviewItem;
  });

  const summary: RunEligibilityOverviewSummary = {
    total: accounts.length,
    play_ready: accounts.filter((account) => account.play_enabled).length,
    blocked: accounts.filter((account) => !account.play_enabled).length,
    needs_assignment: accounts.filter((account) => assignmentReasons.has(account.reason)).length,
    needs_credentials_or_login: accounts.filter((account) => credentialsOrLoginReasons.has(account.reason)).length,
  };

  return {
    run_control: runControl,
    requested_run_type: requestedRunType,
    accounts,
    summary,
  };
}
