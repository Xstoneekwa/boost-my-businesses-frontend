import { isCurrentBlockingDashboardAction } from "./dashboard-action-blockers.ts";
import { projectSocialProfileFollowerDelta3d } from "./social-profile-growth-projection.ts";
import type { SocialProfileSnapshotRow } from "./social-profile-snapshot-contract.ts";
import { businessDayWindow } from "./business-timezone.ts";
import {
  actionCountersFromLogs,
  interactionEventCounters,
  projectVerifiedRunCounters,
  reconcileSocialCounters,
  runTotalsCounters,
  verifiedUnfollowRowsAsInteractionEvents,
} from "./social-counters.ts";

type Row = Record<string, unknown>;

const activeRequestStatuses = new Set(["pending", "queued", "claimed", "starting", "running", "stopping", "canceling"]);
const activeRunStatuses = new Set(["pending", "running", "stopping"]);

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function accountId(row: Row) {
  return text(row.account_id);
}

function rowTime(row: Row) {
  return text(row.event_at) || text(row.updated_at) || text(row.finished_at) || text(row.started_at) || text(row.created_at);
}

function newest(rows: Row[]) {
  return [...rows].sort((left, right) => rowTime(right).localeCompare(rowTime(left)))[0];
}

function grouped(rows: Row[]) {
  const result = new Map<string, Row[]>();
  for (const row of rows) {
    const id = accountId(row);
    if (!id) continue;
    result.set(id, [...(result.get(id) ?? []), row]);
  }
  return result;
}

function activeRuntimeProjection(activeRequest: Row | undefined, activeRun: Row | undefined) {
  const stopping = Boolean(text(activeRequest?.cancel_requested_at))
    || text(activeRequest?.status).toLowerCase() === "stopping"
    || text(activeRun?.status).toLowerCase() === "stopping";
  return {
    stopping,
    activeRunRequestStatus: stopping ? "stopping" : text(activeRequest?.status) || null,
    activeRunStatus: stopping ? "stopping" : text(activeRun?.status) || null,
  };
}

function runtimeIndicator(activeRequest: Row | undefined, activeRun: Row | undefined, latestRun: Row | undefined) {
  if (activeRequest || activeRun) {
    const activeProjection = activeRuntimeProjection(activeRequest, activeRun);
    return {
      state: "active",
      reason: activeProjection.stopping ? "stopping" : activeRun ? "active_run" : "active_run_request",
      lastRunId: text(activeRun?.id) || text(activeRequest?.run_id) || null,
      lastRunStatus: text(activeRun?.status) || text(activeRequest?.status) || null,
      lastRunExitCode: null,
      lastRunFinishedAt: null,
    };
  }
  const latestStatus = text(latestRun?.status).toLowerCase();
  return {
    state: ["failed", "error", "aborted"].includes(latestStatus) ? "error" : "idle",
    reason: latestStatus || "no_active_run",
    lastRunId: text(latestRun?.id) || null,
    lastRunStatus: latestStatus || null,
    lastRunExitCode: null,
    lastRunFinishedAt: text(latestRun?.finished_at) || null,
  };
}

export function projectProfilesLive(input: {
  accountIds: string[];
  now: string;
  requests: Row[];
  runs: Row[];
  actionLogs: Row[];
  interactionEvents: Row[];
  unfollowRows?: Row[];
  dashboardActions: Row[];
  socialProfileSnapshots: SocialProfileSnapshotRow[];
}) {
  const projection = businessDayWindow(new Date(input.now));
  const requestsByAccount = grouped(input.requests);
  const runsByAccount = grouped(input.runs);
  const logsByAccount = grouped(input.actionLogs);
  const eventsByAccount = grouped([
    ...input.interactionEvents,
    ...verifiedUnfollowRowsAsInteractionEvents(input.unfollowRows ?? []),
  ]);
  const actionsByAccount = grouped(input.dashboardActions);
  const snapshotsByAccount = grouped(input.socialProfileSnapshots);

  return input.accountIds.map((id) => {
    const requests = requestsByAccount.get(id) ?? [];
    const runs = runsByAccount.get(id) ?? [];
    const logs = logsByAccount.get(id) ?? [];
    const events = eventsByAccount.get(id) ?? [];
    const activeRequest = newest(requests.filter((row) => activeRequestStatuses.has(text(row.status).toLowerCase())));
    const activeRun = newest(runs.filter((row) => activeRunStatuses.has(text(row.status).toLowerCase())));
    const activeProjection = activeRuntimeProjection(activeRequest, activeRun);
    const activeRunId = text(activeRun?.id) || text(activeRequest?.run_id);
    const historicalRuns = runs.filter((row) => text(row.id) !== activeRunId);
    const historicalEvents = events.filter((row) => text(row.run_id) !== activeRunId);
    const canonicalDailyCount = reconcileSocialCounters(
      actionCountersFromLogs(logs),
      runTotalsCounters(historicalRuns),
      interactionEventCounters(historicalEvents),
    );
    const counters = activeRunId
      ? projectVerifiedRunCounters({
          accountId: id,
          runId: activeRunId,
          now: input.now,
          canonicalDailyCount,
          canonicalActions: logs,
          interactionEvents: events,
        })
      : {
          ...canonicalDailyCount,
          source: "canonical_daily",
          runId: null,
          canonicalDailyCount,
          activeRunVerifiedCount: interactionEventCounters([]),
          unabsorbedVerifiedCount: interactionEventCounters([]),
          projectedDisplayCount: canonicalDailyCount,
          projectionSource: "canonical_daily",
          lastProgressAt: null,
        };
    const currentBlocker = newest((actionsByAccount.get(id) ?? []).filter((row) => isCurrentBlockingDashboardAction(row, { now: new Date(input.now) })));
    const latestRun = newest(runs);
    const updatedAt = [
      rowTime(activeRequest ?? {}),
      rowTime(activeRun ?? {}),
      rowTime(latestRun ?? {}),
      counters.lastProgressAt ?? "",
    ].sort().at(-1) || input.now;

    return {
      accountId: id,
      activeRunRequestId: text(activeRequest?.id) || null,
      activeRunRequestStatus: activeProjection.activeRunRequestStatus,
      activeRunId: text(activeRun?.id) || text(activeRequest?.run_id) || null,
      activeRunStatus: activeProjection.activeRunStatus,
      runControlPhase: activeProjection.stopping ? "stopping" : null,
      runControlLabel: activeProjection.stopping ? "Stopping…" : null,
      runtimeIndicator: runtimeIndicator(activeRequest, activeRun, latestRun),
      currentRunCounters: counters,
      liveSupportedKinds: ["follow", "unfollow", "like", "dm"],
      countersToday: counters.projectedDisplayCount,
      counterProjection: {
        businessDate: projection.businessDate,
        businessTimezone: projection.timezone,
        computedAt: input.now,
        source: "canonical_persisted_actions_sast_v1",
      },
      interactionsToday: counters.projectedDisplayCount.interactionsTotal,
      currentBlocker: currentBlocker ? {
        actionType: text(currentBlocker.action_type),
        status: text(currentBlocker.status),
        blockingCampaign: currentBlocker.blocking_campaign === true,
      } : null,
      followerDelta3d: projectSocialProfileFollowerDelta3d({
        rows: (snapshotsByAccount.get(id) ?? []) as SocialProfileSnapshotRow[],
        now: input.now,
      }),
      updatedAt,
      lastProgressAt: counters.lastProgressAt,
    };
  });
}
