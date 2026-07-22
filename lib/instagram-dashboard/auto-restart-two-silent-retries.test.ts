import assert from "node:assert/strict";
import test from "node:test";

import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";
import { runAutoRestartTick } from "./auto-restart-tick.ts";

type Row = Record<string, unknown>;

class Query {
  private filters: Array<[string, unknown]> = [];
  private since: Array<[string, string]> = [];

  constructor(private db: FakeSupabase, private table: string) {}

  select() { return this; }
  eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
  in() { return this; }
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

  rows(table: string) {
    const rows = this.tables.get(table) ?? [];
    if (!this.tables.has(table)) this.tables.set(table, rows);
    return rows;
  }

  from(table: string) { return new Query(this, table); }

  async rpc(name: string, args: Row) {
    assert.equal(name, "create_account_run_request");
    const request = { id: `request-${this.requests.length + 1}`, ...args };
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
});
