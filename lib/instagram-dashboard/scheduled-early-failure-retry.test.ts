import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROLLED_RETRY_MAX_INDEX,
  buildControlledRetryHandoffRequeueUpdate,
  countBusinessActionsFromRunMetadata,
  detectQueuedCancelRequestedAtConflict,
  evaluateScheduledEarlyFailureRetryEligibility,
  isQueuedAccountRunRequestClaimEligible,
  isSafeRetryableEarlyFailureReason,
  isUnsafeEarlyFailureReason,
  scheduledSessionControlledRetryIdempotencyKey,
  scheduleSessionIdempotencyKey,
  evaluateAndMaybeEnqueueScheduledEarlyFailureRetry,
} from "./scheduled-early-failure-retry.ts";
import { deriveAssignmentTransitionTimestamps } from "./scheduled-session-preflight.ts";

const windowStart = "2026-07-12T10:00:00.000Z";
const windowEnd = "2026-07-12T16:00:00.000Z";
const midWindowNow = new Date("2026-07-12T11:30:00.000Z");
const transition = deriveAssignmentTransitionTimestamps(windowStart, windowEnd)!;

function makeQueryResult(rows: unknown[]) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    like: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return query;
}

function makeSupabase(overrides: {
  originalRequest?: Record<string, unknown> | null;
  retryRequest?: Record<string, unknown> | null;
  run?: Record<string, unknown> | null;
  rpcResults?: Record<string, unknown>;
} = {}) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const originalKey = scheduleSessionIdempotencyKey("assignment-1", windowStart);
  const retryKey = scheduledSessionControlledRetryIdempotencyKey("assignment-1", windowStart);

  return {
    rpcCalls,
    client: {
      from(table: string) {
        if (table === "account_run_requests") {
          return makeQueryResult([]);
        }
        if (table === "ig_runs") {
          return makeQueryResult(overrides.run ? [overrides.run] : []);
        }
        if (table === "account_incident_notifications") {
          return makeQueryResult([]);
        }
        return makeQueryResult([]);
      },
      async rpc(name: string, args: Record<string, unknown>) {
        rpcCalls.push({ name, args });
        if (name === "upsert_account_incident") {
          return { data: { id: "incident-1" }, error: null };
        }
        if (name === "upsert_account_dashboard_action") {
          return { data: { id: "action-1" }, error: null };
        }
        if (name === "create_account_run_request") {
          return {
            data: { id: "retry-request-1", status: "queued", idempotency_key: args.p_idempotency_key },
            error: null,
          };
        }
        if (name === "handoff_preflight_device_lock_to_request") {
          return { data: { ok: true }, error: null };
        }
        return { data: overrides.rpcResults?.[name] ?? null, error: null };
      },
    } as never,
    originalKey,
    retryKey,
    withRequests(originalRequest: Record<string, unknown> | null, retryRequest: Record<string, unknown> | null) {
      const client = {
        from(table: string) {
          if (table === "account_run_requests") {
            const makeKeyedQuery = (row: Record<string, unknown> | null) => {
              const query = {
                select: () => query,
                eq: () => query,
                limit: () => query,
                maybeSingle: () => Promise.resolve({ data: row, error: null }),
              };
              return query;
            };
            return {
              select: () => ({
                eq: (_col: string, value: string) => {
                  if (value === originalKey) return makeKeyedQuery(originalRequest);
                  if (value === retryKey) return makeKeyedQuery(retryRequest);
                  return makeKeyedQuery(null);
                },
              }),
            };
          }
          if (table === "ig_runs") {
            return makeQueryResult(overrides.run ? [overrides.run] : []);
          }
          if (table === "account_incident_notifications") {
            return makeQueryResult([]);
          }
          return makeQueryResult([]);
        },
        async rpc(name: string, args: Record<string, unknown>) {
          rpcCalls.push({ name, args });
          if (name === "upsert_account_incident") return { data: { id: "incident-1" }, error: null };
          if (name === "upsert_account_dashboard_action") return { data: { id: "action-1" }, error: null };
          if (name === "create_account_run_request") {
            return { data: { id: "retry-request-1", status: "queued" }, error: null };
          }
          if (name === "handoff_preflight_device_lock_to_request") return { data: { ok: true }, error: null };
          return { data: null, error: null };
        },
      };
      return client as never;
    },
  };
}

test("controlled retry idempotency key is distinct from base slot key", () => {
  const base = scheduleSessionIdempotencyKey("assignment-1", windowStart);
  const retry = scheduledSessionControlledRetryIdempotencyKey("assignment-1", windowStart);
  assert.notEqual(base, retry);
  assert.match(retry, /:retry:1$/);
  assert.equal(CONTROLLED_RETRY_MAX_INDEX, 1);
});

test("business actions count reads session summary counters", () => {
  assert.equal(countBusinessActionsFromRunMetadata({ follows_completed_count: 2 }), 2);
  assert.equal(countBusinessActionsFromRunMetadata({ account_session_summary: { likes_completed_count: 1 } }), 1);
  assert.equal(countBusinessActionsFromRunMetadata({}), 0);
});

test("safe retryable welcome surface unstable with zero business actions", () => {
  assert.equal(isSafeRetryableEarlyFailureReason("welcome_surface_unstable"), true);
  assert.equal(isUnsafeEarlyFailureReason("welcome_surface_unstable"), false);
  const result = evaluateScheduledEarlyFailureRetryEligibility({
    now: midWindowNow,
    transition,
    preflightStatus: "preflight_ready",
    originalRequestStatus: "failed",
    reasonCode: "welcome_surface_unstable",
    businessActionsCount: 0,
    retryAlreadyExists: false,
    retryInFlight: false,
    retryFailedTerminal: false,
  });
  assert.equal(result.eligible, true);
});

test("retry denied after business action performed", () => {
  const result = evaluateScheduledEarlyFailureRetryEligibility({
    now: midWindowNow,
    transition,
    preflightStatus: "preflight_ready",
    originalRequestStatus: "failed",
    reasonCode: "welcome_surface_unstable",
    businessActionsCount: 1,
    retryAlreadyExists: false,
    retryInFlight: false,
    retryFailedTerminal: false,
  });
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.equal(result.deniedReason, "business_action_already_performed");
});

test("identity mismatch is unsafe — no retry", () => {
  const result = evaluateScheduledEarlyFailureRetryEligibility({
    now: midWindowNow,
    transition,
    preflightStatus: "preflight_ready",
    originalRequestStatus: "failed",
    reasonCode: "active_instagram_account_mismatch",
    businessActionsCount: 0,
    retryAlreadyExists: false,
    retryInFlight: false,
    retryFailedTerminal: false,
  });
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.equal(result.deniedReason, "unsafe_failure");
});

test("one retry already exists — retry denied", () => {
  const result = evaluateScheduledEarlyFailureRetryEligibility({
    now: midWindowNow,
    transition,
    preflightStatus: "preflight_ready",
    originalRequestStatus: "failed",
    reasonCode: "welcome_surface_unstable",
    businessActionsCount: 0,
    retryAlreadyExists: true,
    retryInFlight: false,
    retryFailedTerminal: false,
  });
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.equal(result.deniedReason, "controlled_retry_already_consumed");
});

test("deadline expired — retry denied", () => {
  const afterDeadline = new Date("2026-07-12T15:55:00.000Z");
  const result = evaluateScheduledEarlyFailureRetryEligibility({
    now: afterDeadline,
    transition,
    preflightStatus: "preflight_ready",
    originalRequestStatus: "failed",
    reasonCode: "welcome_surface_unstable",
    businessActionsCount: 0,
    retryAlreadyExists: false,
    retryInFlight: false,
    retryFailedTerminal: false,
  });
  assert.equal(result.eligible, false);
  if (!result.eligible) assert.equal(result.deniedReason, "deadline_expired");
});

test("failed early before business action queues incident + distinct retry request", async () => {
  const harness = makeSupabase({
    run: {
      id: "run-original",
      status: "failed",
      exit_code: 1,
      metadata_safe: {
        transition_reason: "welcome_surface_unstable",
        followers_source_username: "dr_dlimi",
        follows_completed_count: 0,
      },
    },
  });
  const supabase = harness.withRequests(
    {
      id: "req-original",
      status: "failed",
      requested_run_type: "account_session",
      run_id: "run-original",
      reason_code: "welcome_surface_unstable",
      idempotency_key: harness.originalKey,
    },
    null,
  );

  const result = await evaluateAndMaybeEnqueueScheduledEarlyFailureRetry(supabase, {
    accountId: "account-1",
    accountUsername: "i_m_your_traker",
    assignmentId: "assignment-1",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    deviceId: "device-1",
    deviceTimezone: "Africa/Johannesburg",
    preflightId: "preflight-1",
    preflightRequestId: "preflight-req-1",
    preflightStatus: "preflight_ready",
    now: midWindowNow,
    extraMetadata: { liam_go: true },
  });

  assert.equal(result.action, "retry_queued");
  if (result.action !== "retry_queued") return;
  assert.equal(result.requestId, "retry-request-1");
  assert.equal(result.idempotencyKey, harness.retryKey);

  const createCall = harness.rpcCalls.find((call) => call.name === "create_account_run_request");
  assert.ok(createCall);
  assert.equal(createCall?.args.p_idempotency_key, harness.retryKey);
  const metadata = createCall?.args.p_metadata_safe as Record<string, unknown>;
  assert.equal(metadata.controlled_retry, true);
  assert.equal(metadata.original_request_id, "req-original");
  assert.equal(metadata.original_run_id, "run-original");
  assert.equal(metadata.liam_go, true);

  assert.ok(harness.rpcCalls.some((call) => call.name === "upsert_account_incident"));
  assert.ok(harness.rpcCalls.some((call) => call.name === "upsert_account_dashboard_action"));
});

test("no original failed request — action none", async () => {
  const harness = makeSupabase();
  const supabase = harness.withRequests(null, null);
  const result = await evaluateAndMaybeEnqueueScheduledEarlyFailureRetry(supabase, {
    accountId: "account-1",
    accountUsername: "demo",
    assignmentId: "assignment-1",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    deviceId: "device-1",
    deviceTimezone: null,
    preflightId: "preflight-1",
    preflightRequestId: "preflight-req-1",
    preflightStatus: "preflight_ready",
    now: midWindowNow,
  });
  assert.equal(result.action, "none");
});

test("handoff requeue patch clears cancel markers and claim fields", () => {
  const patch = buildControlledRetryHandoffRequeueUpdate(new Date("2026-07-12T12:20:00.000Z"));
  assert.equal(patch.status, "queued");
  assert.equal(patch.cancel_requested_at, null);
  assert.equal(patch.cancel_reason, null);
  assert.equal(patch.canceled_at, null);
  assert.equal(patch.claimed_by, null);
  assert.equal(patch.claimed_at, null);
  assert.equal(patch.lease_expires_at, null);
  assert.equal(patch.run_id, null);
});

test("requeued retry request is claim-eligible for dispatcher", () => {
  const requeued = {
    status: "queued",
    cancel_requested_at: null,
    cancel_reason: null,
    canceled_at: null,
  };
  assert.equal(isQueuedAccountRunRequestClaimEligible(requeued), true);
  assert.equal(detectQueuedCancelRequestedAtConflict(requeued), false);
});

test("zombie prevention — queued with cancel_requested_at is not claim-eligible", () => {
  const zombie = {
    status: "queued",
    cancel_requested_at: "2026-07-12T12:16:26.856464+00:00",
  };
  assert.equal(isQueuedAccountRunRequestClaimEligible(zombie), false);
  assert.equal(detectQueuedCancelRequestedAtConflict(zombie), true);
});

test("deadline expired escalates critical incident and blocks retry", async () => {
  const afterWindow = new Date("2026-07-12T16:05:00.000Z");
  const harness = makeSupabase({
    run: {
      id: "run-original",
      status: "failed",
      exit_code: 1,
      metadata_safe: {
        transition_reason: "welcome_surface_unstable",
        follows_completed_count: 0,
      },
    },
  });
  const supabase = harness.withRequests(
    {
      id: "req-original",
      status: "failed",
      requested_run_type: "account_session",
      run_id: "run-original",
      reason_code: "welcome_surface_unstable",
      idempotency_key: harness.originalKey,
    },
    null,
  );

  const result = await evaluateAndMaybeEnqueueScheduledEarlyFailureRetry(supabase, {
    accountId: "account-1",
    accountUsername: "i_m_your_traker",
    assignmentId: "assignment-1",
    startsAt: windowStart,
    endsAt: windowEnd,
    workerId: "schedule_session_cron",
    deviceId: "device-1",
    deviceTimezone: "Africa/Johannesburg",
    preflightId: "preflight-1",
    preflightRequestId: "preflight-req-1",
    preflightStatus: "preflight_ready",
    now: afterWindow,
  });

  assert.equal(result.action, "blocked_unsafe");
  if (result.action !== "blocked_unsafe") return;
  assert.equal(result.deniedReason, "deadline_expired");
  const incidentCall = harness.rpcCalls.find((call) => call.name === "upsert_account_incident");
  assert.ok(incidentCall);
  assert.equal(incidentCall?.args.p_severity, "critical");
  assert.equal(incidentCall?.args.p_reason, "deadline_expired");
});
