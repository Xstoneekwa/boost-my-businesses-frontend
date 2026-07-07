import assert from "node:assert/strict";
import test from "node:test";

import {
  armReadyToResume,
  claimAuthorizationAtomically,
  evaluateReadyToResume,
  readIncidentRecoveryState,
  windowContainsNow,
} from "./incident-resume-authorization.ts";

const ACCOUNT_ID = "e9c7462b-fc0e-46c9-8d40-1e07e0f6a41b";
const RUN_ID = "9e46c4a5-72c5-4b16-9f0f-96f6f2ff11aa";
const PLAN_ID = "5b2f77aa-2222-4222-8222-bbbbbbbbbbbb";
const INCIDENT_ID = "1a2b3c4d-3333-4333-8333-cccccccccccc";

const NOW = new Date("2026-07-07T10:00:00Z");
const WINDOW_START = "2026-07-07T08:00:00Z";
const WINDOW_END = "2026-07-07T14:00:00Z";

type Row = Record<string, unknown>;
type Db = Record<string, Row[]>;

/** Minimal PostgREST-like fake with the unique indexes of the migration. */
function fakeSupabase(db: Db) {
  class FakeQuery {
    table: string;
    filters: Array<[string, unknown]> = [];
    op: "select" | "insert" | "update" = "select";
    payload: Row | null = null;

    constructor(table: string) {
      this.table = table;
    }
    select() { return this; }
    order() { return this; }
    in() { return this; }
    eq(column: string, value: unknown) {
      this.filters.push([column, value]);
      return this;
    }
    insert(row: Row) {
      this.op = "insert";
      this.payload = row;
      return this;
    }
    update(row: Row) {
      this.op = "update";
      this.payload = row;
      return this;
    }
    maybeSingle() {
      const { data, error } = this.exec();
      const rows = Array.isArray(data) ? data : [];
      return Promise.resolve({ data: rows[0] ?? null, error });
    }
    limit(_n: number) {
      return Promise.resolve(this.exec());
    }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(this.exec()).then(resolve, reject);
    }
    private matches(row: Row) {
      return this.filters.every(([column, value]) => row[column] === value);
    }
    private exec(): { data: Row[]; error: { message: string } | null } {
      const rows = db[this.table] ?? (db[this.table] = []);
      if (this.op === "insert") {
        const row = { id: `auth-${rows.length + 1}`, ...this.payload };
        if (this.table === "incident_resume_authorizations") {
          const armedSameIncident = rows.some(
            (r) => r.incident_id === row.incident_id && r.status === "armed",
          );
          const liveSameWindow = rows.some(
            (r) =>
              r.account_id === row.account_id
              && r.resume_window_key === row.resume_window_key
              && (r.status === "armed" || r.status === "consumed"),
          );
          if (armedSameIncident || liveSameWindow) {
            return { data: [], error: { message: "duplicate key value violates unique constraint" } };
          }
        }
        rows.push(row);
        return { data: [row], error: null };
      }
      if (this.op === "update") {
        const matched = rows.filter((row) => this.matches(row));
        for (const row of matched) Object.assign(row, this.payload);
        return { data: matched, error: null };
      }
      return { data: rows.filter((row) => this.matches(row)), error: null };
    }
  }
  return { from: (table: string) => new FakeQuery(table), db };
}

function incidentRow(overrides: Row = {}): Row {
  return {
    id: INCIDENT_ID,
    status: "open",
    incident_type: "run_identity_verification_failed",
    reason: "actual_logged_in_username_not_detected",
    failure_reason: "actual_logged_in_username_not_detected",
    account_id: ACCOUNT_ID,
    run_id: RUN_ID,
    metadata: {},
    ...overrides,
  };
}

function planRow(overrides: Row = {}): Row {
  return {
    id: PLAN_ID,
    run_id: RUN_ID,
    account_id: ACCOUNT_ID,
    assignment_id: "assign-1",
    device_id: "device-1",
    resume_window_key: `assign-1:${WINDOW_START}`,
    scheduled_window_start: WINDOW_START,
    scheduled_window_end: WINDOW_END,
    resume_stage: "preflight",
    resume_state: "awaiting_human_resume_authorization",
    restart_allowed: false,
    restart_block_reason: "awaiting_human_resume_authorization",
    terminal_reason_code: "actual_logged_in_username_not_detected",
    attempts_in_window: 0,
    test: false,
    ...overrides,
  };
}

test("windowContainsNow only accepts a live window", () => {
  assert.equal(windowContainsNow(WINDOW_START, WINDOW_END, NOW), true);
  assert.equal(windowContainsNow(WINDOW_START, "2026-07-07T09:00:00Z", NOW), false);
  assert.equal(windowContainsNow(null, WINDOW_END, NOW), false);
});

test("readIncidentRecoveryState only accepts known states", () => {
  assert.equal(readIncidentRecoveryState({ recovery: { state: "ready_to_resume" } }), "ready_to_resume");
  assert.equal(readIncidentRecoveryState({ recovery: { state: "weird" } }), "none");
  assert.equal(readIncidentRecoveryState(null), "none");
});

test("eligible incident + awaiting plan + active window => Prêt à relancer available", async () => {
  const supabase = fakeSupabase({ account_session_resume_plans: [planRow()] });
  const view = await evaluateReadyToResume(supabase, incidentRow(), NOW);
  assert.equal(view.eligible, true);
  assert.equal(view.reason, null);
  assert.equal(view.state, "awaiting_human_resume_authorization");
  assert.equal(view.windowActive, true);
  assert.equal(view.resumePlanId, PLAN_ID);
});

test("closed window never arms a stale resume", async () => {
  const supabase = fakeSupabase({
    account_session_resume_plans: [planRow({ scheduled_window_end: "2026-07-07T09:00:00Z" })],
  });
  const view = await evaluateReadyToResume(supabase, incidentRow(), NOW);
  assert.equal(view.eligible, false);
  assert.equal(view.reason, "resume_window_closed");

  const arm = await armReadyToResume(supabase, { incidentRow: incidentRow(), now: NOW });
  assert.equal(arm.ok, false);
  assert.equal(arm.reason, "resume_window_closed");
  assert.equal((supabase.db.incident_resume_authorizations ?? []).length, 0);
});

test("historic runs without plan stay resume_plan_missing (never invented)", async () => {
  const supabase = fakeSupabase({ account_session_resume_plans: [] });
  const view = await evaluateReadyToResume(supabase, incidentRow(), NOW);
  assert.equal(view.eligible, false);
  assert.equal(view.reason, "resume_plan_missing");
});

test("non recovery-eligible incidents keep simple resolution only", async () => {
  const supabase = fakeSupabase({ account_session_resume_plans: [planRow()] });
  const view = await evaluateReadyToResume(
    supabase,
    incidentRow({ incident_type: "system_test_incident" }),
    NOW,
  );
  assert.equal(view.eligible, false);
  assert.equal(view.reason, "resume_plan_not_recoverable");
});

test("not recoverable plan states are refused with a stable reason", async () => {
  const supabase = fakeSupabase({
    account_session_resume_plans: [planRow({ resume_state: "not_recoverable" })],
  });
  const view = await evaluateReadyToResume(supabase, incidentRow(), NOW);
  assert.equal(view.eligible, false);
  assert.equal(view.reason, "resume_plan_not_recoverable");
});

test("arming creates one audited authorization linked to incident/run/window/plan", async () => {
  const supabase = fakeSupabase({ account_session_resume_plans: [planRow()] });
  const arm = await armReadyToResume(supabase, {
    incidentRow: incidentRow(),
    armedSource: "botapp_relay",
    now: NOW,
  });
  assert.equal(arm.ok, true);
  assert.equal(arm.state, "ready_to_resume");
  const rows = supabase.db.incident_resume_authorizations;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].incident_id, INCIDENT_ID);
  assert.equal(rows[0].account_id, ACCOUNT_ID);
  assert.equal(rows[0].run_id, RUN_ID);
  assert.equal(rows[0].resume_plan_id, PLAN_ID);
  assert.equal(rows[0].resume_window_key, `assign-1:${WINDOW_START}`);
  assert.equal(rows[0].status, "armed");
});

test("two concurrent clicks arm exactly one authorization", async () => {
  const supabase = fakeSupabase({ account_session_resume_plans: [planRow()] });
  const first = await armReadyToResume(supabase, { incidentRow: incidentRow(), now: NOW });
  assert.equal(first.ok, true);
  const second = await armReadyToResume(supabase, { incidentRow: incidentRow(), now: NOW });
  // The second click sees the armed authorization through eligibility.
  assert.equal(second.ok, false);
  assert.equal(second.reason, "awaiting_next_scheduler_tick");
  assert.equal(second.state, "ready_to_resume");
  assert.equal(supabase.db.incident_resume_authorizations.length, 1);
});

test("consumed budget blocks any re-arm in the same window", async () => {
  const supabase = fakeSupabase({
    account_session_resume_plans: [planRow()],
    incident_resume_authorizations: [
      {
        id: "auth-consumed",
        incident_id: INCIDENT_ID,
        account_id: ACCOUNT_ID,
        resume_window_key: `assign-1:${WINDOW_START}`,
        status: "consumed",
      },
    ],
  });
  const arm = await armReadyToResume(supabase, { incidentRow: incidentRow(), now: NOW });
  assert.equal(arm.ok, false);
  assert.equal(arm.reason, "resume_retry_window_exhausted");
});

test("two concurrent ticks can only claim one authorization (atomic consume)", async () => {
  const supabase = fakeSupabase({
    incident_resume_authorizations: [
      { id: "auth-1", incident_id: INCIDENT_ID, account_id: ACCOUNT_ID, status: "armed" },
    ],
  });
  const first = await claimAuthorizationAtomically(supabase, "auth-1", NOW);
  const second = await claimAuthorizationAtomically(supabase, "auth-1", NOW);
  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(supabase.db.incident_resume_authorizations[0].status, "consumed");
});

test("resolved incidents cannot arm a resume", async () => {
  const supabase = fakeSupabase({ account_session_resume_plans: [planRow()] });
  const view = await evaluateReadyToResume(
    supabase,
    incidentRow({ status: "resolved" }),
    NOW,
  );
  assert.equal(view.eligible, false);
  assert.equal(view.reason, "incident_not_active");
});
