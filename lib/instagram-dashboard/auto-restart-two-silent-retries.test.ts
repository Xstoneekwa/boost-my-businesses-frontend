import assert from "node:assert/strict";
import test from "node:test";

import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";
import { runAutoRestartTick } from "./auto-restart-tick.ts";

type Row = Record<string, unknown>;

class Query {
  private filters: Array<[string, unknown]> = [];
  private since: Array<[string, string]> = [];
  private db: FakeSupabase;
  private table: string;

  constructor(db: FakeSupabase, table: string) {
    this.db = db;
    this.table = table;
  }

  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  in() { return this; }
  order() { return this; }
  gte(column: string, value: string) { this.since.push([column, value]); return this; }
  update() { return this; }
  delete() { return this; }

  async maybeSingle() {
    const rows = this.matching();
    return { data: rows[0] ?? null, error: null };
  }

  async single() {
    const rows = this.matching();
    return { data: rows[0] ?? null, error: null };
  }

  async limit(count: number) {
    return { data: this.matching().slice(0, count), error: null };
  }

  async insert(value: Row) {
    const row = {
      id: `${this.table}-${this.db.rows(this.table).length + 1}`,
      created_at: "2026-07-22T20:00:00.000Z",
      ...value,
    };
    this.db.rows(this.table).push(row);
    return { data: [row], error: null };
  }

  async upsert(value: Row) { return this.insert(value); }

  private matching() {
    return this.db.rows(this.table).filter((row) =>
      this.filters.every(([column, value]) => row[column] === value)
      && this.since.every(([column, value]) => String(row[column] ?? "") >= value),
    );
  }
}

class FakeSupabase {
  private tables = new Map<string, Row[]>([
    ["auto_restart_settings", [{
      id: "global",
      auto_restart_enabled: true,
      mode: "production",
      check_every_minutes: 20,
      restart_delay_minutes: 20,
      max_retries_after_initial_failure: 2,
      max_restarts_per_day_per_account: 3,
      max_restarts_per_window_per_account: 2,
      restart_yellow_accounts: false,
      restart_red_accounts: false,
    }]],
    ["auto_restart_decisions", []],
    ["runtime_events", []],
  ]);
  requests: Row[] = [];
  createRequestStatus = "queued";

  rows(table: string) {
    const rows = this.tables.get(table) ?? [];
    if (!this.tables.has(table)) this.tables.set(table, rows);
    return rows;
  }

  from(table: string) { return new Query(this, table); }

  async rpc(name: string, args: Row) {
    if (name === "reconcile_resolved_incident_resume_windows_v1") {
      return { data: { armed_count: 0 }, error: null };
    }
    if (name === "restore_prebusiness_resume_retry_credits_v1") {
      return { data: { restored_count: 0 }, error: null };
    }
    assert.equal(name, "create_account_run_request");
    const request = { id: `request-${this.requests.length + 1}`, status: this.createRequestStatus, ...args };
    this.requests.push(request);
    return { data: request, error: null };
  }
}

function candidate(retryIndex: 0 | 1 | 2): AutoRestartCandidate {
  const nextRetryIndex = retryIndex + 1;
  const lastRunId = retryIndex === 0 ? "initial-run" : `retry-run-${retryIndex}`;
  return {
    accountId: "account-1",
    deviceId: "",
    appInstanceId: "instance-1",
    username: "mythyl_fitness",
    packageLabel: "clone-2",
    configuredRestartDelayMinutes: 20,
    eligibleUnfollowCandidateCount: 120,
    technicalHoldUnfollowCandidateCount: 0,
    terminalUnfollowCandidateCount: 0,
    unfollowPhaseCircuitOpen: false,
    unfollowPhaseCircuitReason: null,
    commercialAddonsLabel: "",
    outreachSourceLabel: "",
    runtimeProfilesLabel: "",
    followFiltersLabel: "",
    enabledServices: ["unfollow"],
    phoneName: "A16-02",
    phoneRestStatus: "ready",
    sessionWindowStatus: "open",
    assignmentStatus: "active",
    gateStatus: "eligible_preview",
    accountEligible: true,
    accountEligibilityReason: "eligible",
    restartNeeded: true,
    restartNeedReason: "partial_run_resume_needed",
    exactViewportResumeAvailable: false,
    safeRestartStrategy: "exact_checkpoint_resume",
    safeRestartReason: "non_follow_phase_resume_plan",
    historicalSafeBoundaryFallback: false,
    enqueueAllowed: true,
    sourceRunId: lastRunId,
    sourceBusinessSessionId: "business-session-1",
    priorTargetId: null,
    nextTargetId: null,
    nextRetryIndex,
    remainingFollowQuota: 0,
    plannedPhasesToRun: { welcome: false, follow: false, unfollow: true },
    plannedQuotaRemaining: { welcome: 0, follow: 0, unfollow: 120, outreach: 0 },
    decisionOutcome: "eligible",
    restartEligible: true,
    blockReason: "",
    plannedRunType: "account_session",
    reliability: {
      restartAllowed: true,
      restartBlockReason: "",
      unsafeMarkers: [],
      currentAttempt: String(retryIndex + 1),
      nextAttempt: String(nextRetryIndex + 1),
      nextRestartAt: null,
      lastRestartError: "",
      sessionTerminationClass: "partial_resumable",
      businessSessionId: "business-session-1",
      attemptId: String(retryIndex + 1),
      retryIndex: String(retryIndex),
      nextRetryIndex: String(nextRetryIndex),
      previousRunId: retryIndex === 0 ? "" : `retry-run-${retryIndex - 1}`,
      rootFailureCode: "unfollow_runtime_exception",
      failureSignature: "python:unfollow:duplicate_stop_reason",
      failureCategory: "recoverable_python_runtime_failure",
      cleanupCompleted: true,
      lockReleased: true,
      businessDaySast: "2026-07-22",
      phasesToRun: { welcome: false, follow: false, unfollow: true },
      quotaRemaining: { follow: 0, unfollow: 120, total: 120 },
      safeCheckpointAvailable: false,
      targetRotationSafeAfterScrollFailure: false,
      scrollFailureSurfaceAmbiguous: false,
      businessProgressMade: false,
      lastRunId,
      lastRunStatus: "failed",
      sourceLabel: "test",
    },
    quotas: {
      follow: { doneToday: 40, capDay: 40, remaining: 0, plannedNextRunQuota: 0, enabled: true, sourceLabel: "test" },
      unfollow: { doneToday: 0, capDay: 120, remaining: 120, plannedNextRunQuota: 120, enabled: true, sourceLabel: "test" },
      welcome: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "test" },
      outreach: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "test" },
    },
  };
}

test("persisted business progress cannot bypass the configured restart window budget", async () => {
  const supabase = new FakeSupabase();
  supabase.rows("auto_restart_decisions").push(
    {
      account_id: "account-1",
      business_session_id: null,
      decision: "enqueued",
      created_at: "2026-07-22T19:00:00.000Z",
    },
    ...[1, 2].map((index) => ({
      account_id: "account-1",
      business_session_id: "business-session-1",
      decision: "enqueued",
      created_at: `2026-07-22T19:0${index}:00.000Z`,
    })),
  );
  const progressed = candidate(0);
  progressed.sourceRunId = "progress-run-2";
  progressed.reliability.lastRunId = "progress-run-2";
  progressed.reliability.businessProgressMade = true;

  const result = await runAutoRestartTick(supabase as never, {
    workerId: "operator-test",
    requestedByActor: "offline-test",
    manual: true,
    internal: true,
    now: new Date("2026-07-22T20:00:00.000Z"),
    overview: { candidates: [progressed as unknown as Row] },
    evaluateEligibility: async () => ({ ok: true, reason: "" }),
  });

  assert.equal(result.result.enqueued_count, 0);
  assert.equal(result.result.blocked_count, 1);
  assert.match(result.result.blocked[0].reason, /max_restarts_window/);
  assert.equal(supabase.requests.length, 0);
});

test("actual tick creates exactly retry requests 1 and 2, then no third request", async () => {
  const supabase = new FakeSupabase();
  const common = {
    workerId: "operator-test",
    requestedByActor: "offline-test",
    manual: true,
    internal: true,
    evaluateEligibility: async () => ({ ok: true, reason: "" }),
  };

  const retryOne = await runAutoRestartTick(supabase as never, {
    ...common,
    now: new Date("2026-07-22T20:00:00.000Z"),
    overview: { candidates: [candidate(0) as unknown as Row] },
  });
  assert.equal(retryOne.result.enqueued_count, 1);

  const retryTwo = await runAutoRestartTick(supabase as never, {
    ...common,
    now: new Date("2026-07-22T20:10:00.000Z"),
    overview: { candidates: [candidate(1) as unknown as Row] },
  });
  assert.equal(retryTwo.result.enqueued_count, 1);

  const exhausted = await runAutoRestartTick(supabase as never, {
    ...common,
    now: new Date("2026-07-22T20:20:00.000Z"),
    overview: { candidates: [candidate(2) as unknown as Row] },
  });
  assert.equal(exhausted.result.enqueued_count, 0);
  assert.equal(exhausted.result.blocked_count, 1);
  assert.equal(supabase.requests.length, 2);
  assert.deepEqual(
    supabase.requests.map((row) => row.p_idempotency_key),
    [
      "auto-restart:account-1:business-session-1:retry:1",
      "auto-restart:account-1:business-session-1:retry:2",
    ],
  );
  assert.deepEqual(
    supabase.rows("runtime_events").map((row) => row.event_type),
    [
      "recoverable_python_failure_restart_1_scheduled",
      "recoverable_python_failure_restart_2_scheduled",
    ],
  );
  const enqueuedDecisions = supabase.rows("auto_restart_decisions")
    .filter((row) => row.decision === "enqueued");
  assert.equal(enqueuedDecisions.length, 2);
  assert.deepEqual(
    enqueuedDecisions.map((row) => (row.metadata_safe as Row).safe_restart_strategy),
    ["exact_checkpoint_resume", "exact_checkpoint_resume"],
  );
  assert.ok(supabase.rows("auto_restart_decisions").every((row) => {
    const metadata = row.metadata_safe as Row;
    return typeof metadata.account_eligible === "boolean"
      && typeof metadata.restart_needed === "boolean"
      && typeof metadata.enqueue_allowed === "boolean";
  }));
});

test("a source run can authorize at most one bounded continuation lineage", async () => {
  const supabase = new FakeSupabase();
  const unchangedSourceRun = candidate(0);
  const common = {
    workerId: "operator-test",
    requestedByActor: "offline-test",
    manual: true,
    internal: true,
    evaluateEligibility: async () => ({ ok: true, reason: "" }),
  };

  const retryOne = await runAutoRestartTick(supabase as never, {
    ...common,
    now: new Date("2026-07-22T20:00:00.000Z"),
    overview: { candidates: [unchangedSourceRun as unknown as Row] },
  });
  assert.equal(retryOne.result.enqueued_count, 1);

  const retryTwo = await runAutoRestartTick(supabase as never, {
    ...common,
    now: new Date("2026-07-22T20:10:00.000Z"),
    overview: { candidates: [unchangedSourceRun as unknown as Row] },
  });
  assert.equal(retryTwo.result.enqueued_count, 0);
  assert.equal(retryTwo.result.blocked_count, 1);
  assert.match(retryTwo.result.blocked[0].reason, /resume_lineage_retry_budget_exhausted/);
  assert.deepEqual(
    supabase.requests.map((row) => row.p_idempotency_key),
    [
      "auto-restart:account-1:business-session-1:retry:1",
    ],
  );
});

test("legacy decision rows remain authoritative through prior_run_id", async () => {
  const supabase = new FakeSupabase();
  supabase.rows("auto_restart_decisions").push({
    account_id: "account-1",
    business_session_id: "business-session-old",
    prior_run_id: "initial-run",
    decision: "enqueued",
    metadata_safe: {},
    created_at: "2026-07-22T19:59:00.000Z",
  });

  const result = await runAutoRestartTick(supabase as never, {
    workerId: "operator-test",
    requestedByActor: "offline-test",
    manual: true,
    internal: true,
    now: new Date("2026-07-22T20:00:00.000Z"),
    overview: { candidates: [candidate(0) as unknown as Row] },
    evaluateEligibility: async () => ({ ok: true, reason: "" }),
  });

  assert.equal(result.result.enqueued_count, 0);
  assert.equal(result.result.blocked_count, 1);
  assert.match(result.result.blocked[0].reason, /resume_lineage_retry_budget_exhausted/);
});

test("a terminal idempotent enqueue response is never counted as a new request", async () => {
  const supabase = new FakeSupabase();
  supabase.createRequestStatus = "blocked";
  const result = await runAutoRestartTick(supabase as never, {
    workerId: "operator-test",
    requestedByActor: "offline-test",
    manual: true,
    internal: true,
    now: new Date("2026-07-22T20:00:00.000Z"),
    overview: { candidates: [candidate(0) as unknown as Row] },
    evaluateEligibility: async () => ({ ok: true, reason: "" }),
  });

  assert.equal(result.result.enqueued_count, 0);
  assert.equal(result.result.blocked_count, 1);
  assert.match(result.result.blocked[0].reason, /^enqueue_returned_terminal_request:blocked$/);
  assert.equal(
    supabase.rows("auto_restart_decisions")[0].reason,
    "enqueue_returned_terminal_request:blocked",
  );
});

test("the natural tick persists a not-needed decision without creating a request", async () => {
  const supabase = new FakeSupabase();
  const complete = candidate(0);
  complete.restartEligible = false;
  complete.enqueueAllowed = false;
  complete.restartNeeded = false;
  complete.restartNeedReason = "no_partial_run_to_resume";
  complete.safeRestartStrategy = "none";
  complete.safeRestartReason = "no_partial_run_to_resume";
  complete.decisionOutcome = "not_needed";
  complete.blockReason = "no_partial_run_to_resume";
  complete.plannedRunType = "none";

  const result = await runAutoRestartTick(supabase as never, {
    workerId: "operator-test",
    requestedByActor: "offline-test",
    manual: true,
    internal: true,
    now: new Date("2026-07-22T20:00:00.000Z"),
    overview: { candidates: [complete as unknown as Row] },
    evaluateEligibility: async () => ({ ok: true, reason: "" }),
  });

  assert.equal(result.result.not_needed_count, 1);
  assert.equal(result.result.enqueued_count, 0);
  assert.equal(supabase.requests.length, 0);
  assert.equal(supabase.rows("auto_restart_decisions").length, 1);
  assert.equal(supabase.rows("auto_restart_decisions")[0].decision, "not_needed");
  assert.equal(
    (supabase.rows("auto_restart_decisions")[0].metadata_safe as Row).safe_restart_strategy,
    "none",
  );
});

test("a canonical BotApp stop gets one fresh-boundary natural continuation and never loops", async () => {
  const supabase = new FakeSupabase();
  const stopped = candidate(2);
  stopped.operatorStopContinuation = true;
  stopped.operatorStopReason = "botapp_manual_stop";
  stopped.freshBoundaryOnly = true;
  stopped.sourceRunId = "operator-stopped-run";
  stopped.sourceRequestId = "operator-stop-request";
  stopped.canonicalAttemptId = 3;
  stopped.sourceLineageValid = true;
  stopped.sourceBusinessSessionId = "operator-stop:operator-stopped-run";
  stopped.nextRetryIndex = 0;
  stopped.exactViewportResumeAvailable = false;
  stopped.safeRestartStrategy = "rebuilt_safe_target_plan";
  stopped.safeRestartReason = "operator_stop_live_phase_plan_rebuilt";
  stopped.restartNeedReason = "operator_stopped_safe_boundary_continuation";
  stopped.reliability.restartAllowed = false;
  stopped.reliability.restartBlockReason = "operator_canceled";
  stopped.reliability.sessionTerminationClass = "completed";
  stopped.reliability.lastRunStatus = "stopped";
  stopped.reliability.lastRunId = "operator-stopped-run";
  stopped.reliability.operatorStopContinuation = true;
  stopped.reliability.operatorStopReason = "botapp_manual_stop";
  stopped.reliability.retryIndex = "9";
  stopped.reliability.nextRetryIndex = "10";
  stopped.reliability.failureCategory = "";
  stopped.reliability.businessDaySast = "";
  stopped.plannedQuotaRemaining = { welcome: 0, follow: 0, unfollow: 5, outreach: 0 };
  stopped.eligibleUnfollowCandidateCount = 5;

  const common = {
    workerId: "operator-test",
    requestedByActor: "offline-test",
    manual: true,
    internal: true,
    evaluateEligibility: async () => ({ ok: true, reason: "" }),
  };
  const first = await runAutoRestartTick(supabase as never, {
    ...common,
    now: new Date("2026-07-22T20:00:00.000Z"),
    overview: { candidates: [stopped as unknown as Row] },
  });
  assert.equal(first.result.enqueued_count, 1);
  assert.equal(supabase.requests[0].p_idempotency_key,
    "auto-restart:account-1:operator-stop:operator-stopped-run:retry:0");
  const requestMetadata = supabase.requests[0].p_metadata_safe as Row;
  assert.equal(requestMetadata.operator_stop_continuation, true);
  assert.equal(requestMetadata.fresh_boundary_only, true);
  assert.equal(requestMetadata.attempt_id, 1);

  const second = await runAutoRestartTick(supabase as never, {
    ...common,
    now: new Date("2026-07-22T20:01:00.000Z"),
    overview: { candidates: [stopped as unknown as Row] },
  });
  assert.equal(second.result.enqueued_count, 0);
  assert.equal(second.result.blocked_count, 1);
  assert.match(second.result.blocked[0].reason, /resume_lineage_retry_budget_exhausted/);
  assert.equal(supabase.requests.length, 1);
});
