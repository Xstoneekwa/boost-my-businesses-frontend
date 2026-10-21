import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as tickHelpers from "./auto-restart-tick-helpers.ts";
import {
  buildAutoRestartResumePlanMetadata,
  buildInstagramRestrictionPreflightMetadata,
  validateCanonicalResumePlan,
} from "./auto-restart-resume-metadata.ts";

/**
 * Contract tests over the canonical Auto Restart tick source: the P3
 * human-confirmed resume path must stay atomic, retry-safe and canonical
 * (no second scheduler, no direct worker call, no backend-launched run).
 */
const tickSource = readFileSync(new URL("./auto-restart-tick.ts", import.meta.url), "utf8");
const authorizationSource = readFileSync(
  new URL("./incident-resume-authorization.ts", import.meta.url),
  "utf8",
);

test("human-confirmed resumes run inside the canonical tick only", () => {
  assert.match(tickSource, /processHumanConfirmedResumes/);
  // Never in dry-run/shadow mode.
  assert.match(tickSource, /if \(!forceDryRun\) \{\s*await processHumanConfirmedResumes/);
});

test("authorization consumption and request creation use one atomic RPC", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /consumeAuthorizationAndCreateRequest\(supabase/);
  assert.doesNotMatch(humanSection, /claimAuthorizationAtomically/);
  assert.match(tickSource, /consume_resume_authorization_and_create_request_v4/);
});

type ResumeInput = {
  authorizationId: string;
  workerId: string;
  deviceId: string | null;
  metadata: Record<string, unknown>;
};
type RpcResult = { data?: Record<string, unknown> | null; error?: { message?: string } | null };
const fixture = {
  account: "00000000-0000-0000-0000-000000009002",
  device: "00000000-0000-0000-0000-000000009006",
  app: "00000000-0000-0000-0000-000000009007",
  assignment: "00000000-0000-0000-0000-000000009008",
  run: "00000000-0000-0000-0000-000000009009",
  source: "00000000-0000-0000-0000-000000009010",
  incident: "00000000-0000-0000-0000-000000009011",
  plan: "00000000-0000-0000-0000-000000009012",
  authorization: "00000000-0000-0000-0000-000000009013",
  request: "00000000-0000-0000-0000-000000009020",
  lease: "00000000-0000-0000-0000-000000009021",
  worker: "run-dispatcher:local-cert",
};

// Execute the exact private caller; SQL is never reimplemented in this fixture.
const tickAst = ts.createSourceFile("auto-restart-tick.ts", tickSource, ts.ScriptTarget.Latest, true);
const callers = tickAst.statements.filter((statement): statement is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "consumeAuthorizationAndCreateRequest",
);
assert.equal(callers.length, 1);
const consume = new Function(
  `${ts.transpileModule(callers[0].getText(tickAst), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText}\nreturn consumeAuthorizationAndCreateRequest;`,
)() as (
  db: { rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult> },
  input: ResumeInput,
) => Promise<Record<string, unknown> | null>;

function normalResume(attempt: number): ResumeInput {
  const quota = (remaining: number) => ({ enabled: remaining > 0, remaining, doneToday: 0, capDay: remaining });
  const candidate = {
    accountId: fixture.account, assignmentId: fixture.assignment, deviceId: fixture.device,
    appInstanceId: fixture.app, packageCode: "synthetic-test", packageLabel: "Synthetic contract",
    sourceRunId: fixture.run, sourceRequestId: fixture.source,
    sourceBusinessSessionId: fixture.source, sourceLineageValid: true,
    canonicalAttemptId: attempt - 1, nextRetryIndex: attempt - 1,
    accountEligible: true, restartNeeded: true, enqueueAllowed: true,
    scheduledWindowStart: "2026-10-19T10:00:00Z", scheduledWindowEnd: "2026-10-19T18:00:00Z",
    plannedPhasesToRun: { welcome: false, follow: false, unfollow: true },
    plannedQuotaRemaining: { welcome: 0, follow: 0, unfollow: 1, outreach: 0 },
    quotas: { welcome: quota(0), follow: quota(0), unfollow: quota(1), outreach: quota(0) },
    reliability: { sessionTerminationClass: "partial_resumable", cleanupCompleted: true, lockReleased: true },
  } as Parameters<typeof buildAutoRestartResumePlanMetadata>[0];
  const metadata = buildAutoRestartResumePlanMetadata(candidate, new Date("2026-10-19T11:00:00Z"));
  assert.equal(validateCanonicalResumePlan(metadata.resume_plan), null);
  return { authorizationId: fixture.authorization, workerId: fixture.worker, deviceId: fixture.device, metadata };
}

test("the actual v4 caller transports canonical source, root, plan and attempts unchanged", async () => {
  for (const attempt of [2, 3]) {
    const input = normalResume(attempt);
    const before = structuredClone(input);
    const result = { request_id: fixture.request, authorization_id: input.authorizationId, idempotent: false };
    let calls = 0;
    const actual = await consume({ rpc: async (name, args) => {
      calls += 1;
      assert.equal(name, "consume_resume_authorization_and_create_request_v4");
      assert.deepEqual(args, {
        p_authorization_id: input.authorizationId, p_worker_id: input.workerId,
        p_device_id: input.deviceId, p_metadata_safe: input.metadata,
      });
      const plan = input.metadata.resume_plan as Record<string, unknown>;
      assert.equal(input.metadata.business_session_id, fixture.source);
      assert.equal(plan.account_id, fixture.account);
      assert.equal(plan.source_request_id, fixture.source);
      assert.equal(plan.prior_run_id, fixture.run);
      assert.equal(plan.attempt_id, attempt);
      assert.equal(plan.retry_index, attempt - 1);
      return { data: result, error: null };
    } }, input);
    assert.strictEqual(actual, result);
    assert.equal(calls, 1);
    assert.deepEqual(input, before);
  }
});

test("v4 lineage refusals are propagated without erasing contradictions or retrying", async () => {
  for (const field of ["business_session_id", "root_business_session_id", "parent_request_id", "attempt_id", "execution_attempt_no"]) {
    const input = normalResume(2);
    (input.metadata.resume_plan as Record<string, unknown>)[field] = "contradictory";
    const before = structuredClone(input);
    let calls = 0;
    await assert.rejects(consume({ rpc: async (name, args) => {
      calls += 1;
      assert.equal(name, "consume_resume_authorization_and_create_request_v4");
      assert.deepEqual(args.p_metadata_safe, before.metadata);
      return { error: { message: "resume_plan_lineage_mismatch" } };
    } }, input), { message: "resume_plan_lineage_mismatch" });
    assert.equal(calls, 1);
    assert.deepEqual(input, before);
  }
});

test("the fourth attempt and existing authorization guards stay authoritative at the RPC", async () => {
  for (const reason of ["resume_plan_lineage_incomplete", "service_role_required", "resume_authorization_consumed", "resume_idempotency_payload_conflict", "resume_committed_lease_no_longer_owned"]) {
    const input = normalResume(4);
    const before = structuredClone(input);
    let calls = 0;
    await assert.rejects(consume({ rpc: async (name, args) => {
      calls += 1;
      assert.equal(name, "consume_resume_authorization_and_create_request_v4");
      assert.deepEqual(args.p_metadata_safe, before.metadata);
      return { error: { message: reason } };
    } }, input), { message: reason });
    assert.equal(calls, 1);
    assert.deepEqual(input, before);
  }
});

test("restriction preflight reaches v4 with the canonical zero-business plan intact", async () => {
  const metadata = buildInstagramRestrictionPreflightMetadata({
    accountId: fixture.account, assignmentId: fixture.assignment, deviceId: fixture.device, appInstanceId: fixture.app,
    incidentId: fixture.incident, authorizationId: fixture.authorization, resumePlanId: fixture.plan,
    originalRunId: fixture.run, retryGeneration: 0, now: new Date("2026-10-19T11:00:00Z"),
  });
  assert.equal(validateCanonicalResumePlan(metadata.resume_plan), null);
  const before = structuredClone(metadata);
  let calls = 0;
  await consume({ rpc: async (name, args) => {
    calls += 1;
    assert.equal(name, "consume_resume_authorization_and_create_request_v4");
    assert.deepEqual(args.p_metadata_safe, before);
    assert.deepEqual(metadata.resume_plan.phases_to_run, { welcome: false, follow: false, unfollow: false });
    assert.deepEqual(metadata.resume_plan.quota_remaining, { welcome: 0, follow: 0, unfollow: 0, outreach: 0, total: 0 });
    return { data: { request_id: fixture.request } };
  } }, { authorizationId: fixture.authorization, workerId: fixture.worker, deviceId: fixture.device, metadata });
  assert.equal(calls, 1);
  assert.deepEqual(metadata, before);
});

test("committed replay responses and device lock bindings are returned intact", async () => {
  const input = normalResume(2);
  const before = structuredClone(input);
  const binding = { request_id: fixture.request, lease_id: fixture.lease, account_id: fixture.account };
  let calls = 0;
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls += 1;
    assert.equal(name, "consume_resume_authorization_and_create_request_v4");
    assert.deepEqual(args.p_metadata_safe, before.metadata);
    return { data: { request_id: fixture.request, idempotent: calls > 1, device_lock_binding: binding } };
  } };
  const first = await consume(db, input);
  const replay = await consume(db, input);
  assert.equal(calls, 2);
  assert.equal(first?.idempotent, false);
  assert.equal(replay?.idempotent, true);
  assert.equal(first?.request_id, replay?.request_id);
  assert.strictEqual(replay?.device_lock_binding, binding);
  assert.deepEqual(input, before);
});

test("empty responses and transport failures never cause a second RPC or fallback", async () => {
  let calls = 0;
  const input = normalResume(2);
  input.deviceId = null;
  assert.equal(await consume({ rpc: async (_name, args) => {
    calls += 1;
    assert.equal(args.p_device_id, null);
    return { data: null };
  } }, input), null);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(consume({ rpc: async () => {
    calls += 1;
    return { error: {} };
  } }, input), { message: "resume_atomic_enqueue_failed" });
  assert.equal(calls, 1);
  calls = 0;
  const failure = new Error("transport failed before response");
  await assert.rejects(consume({ rpc: async () => {
    calls += 1;
    throw failure;
  } }, input), (error) => error === failure);
  assert.equal(calls, 1);
});

test("resume request creation stays on the canonical CP0 path", () => {
  // The generic and human paths both ultimately use the guarded DB primitive.
  assert.match(tickSource, /rpc\("create_account_run_request"/);
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /consumeAuthorizationAndCreateRequest\(supabase/);
  assert.doesNotMatch(humanSection, /fetch\(/);
  // Recovery metadata links everything for the worker + audit.
  assert.match(humanSection, /recovery_mode: "human_confirmed_resume"/);
  assert.match(humanSection, /incident_id: incidentId/);
  assert.match(humanSection, /original_run_id: originalRunId/);
  assert.match(humanSection, /resume_plan_id: resumePlanId/);
  assert.match(humanSection, /resume_window_key: resumeWindowKey/);
  assert.match(humanSection, /trigger: "scheduler_tick"/);
});

test("human-confirmed resume rebuilds explicit phases before consuming authorization", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  const planIndex = humanSection.indexOf("buildAutoRestartResumePlanMetadata(");
  const claimIndex = humanSection.indexOf("consumeAuthorizationAndCreateRequest(supabase");
  assert.ok(planIndex > 0, "canonical current resume plan is rebuilt");
  assert.ok(claimIndex > planIndex, "phase plan is certified before atomic consumption");
  assert.match(humanSection, /resume_candidate_unavailable/);
  assert.match(humanSection, /resume_phase_plan_not_actionable/);
  assert.match(humanSection, /\.\.\.resumeMetadata/);
});

test("human-confirmed resume reports the exact canonical lineage failure before rebuilding", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  const lineageGate = humanSection.indexOf("candidate.sourceLineageValid !== true");
  const planIndex = humanSection.indexOf("buildAutoRestartResumePlanMetadata(", lineageGate);
  assert.ok(lineageGate > 0);
  assert.ok(planIndex > lineageGate);
  assert.match(humanSection, /candidate\.reliability\.sourceLineageReason/);
  assert.match(humanSection, /canonical_resume_lineage_missing/);
});

test("only the audited account-scoped one-shot may preserve a frozen Follow-only plan", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /retry_generation,frozen_phase_plan,test/);
  assert.match(humanSection, /applyFollow60sOneShotFrozenPlan/);
  assert.match(humanSection, /follow60sOneShot\?\.matched\s*\?/);
  assert.match(humanSection, /follow60sOneShot\.metadata/);
});

test("an armed Follow60 control overrides resolved-incident generic phases", () => {
  const callerSection = tickSource.slice(
    tickSource.indexOf("await processHumanConfirmedResumes"),
    tickSource.indexOf("await processHumanConfirmedResumes") + 700,
  );
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));

  assert.match(callerSection, /follow60ControlByAccount/);
  assert.match(callerSection, /follow60ActiveControlCount: follow60ControlRows\.length/);
  assert.match(humanSection, /resolveArmedFollow60Control\(\{/);
  assert.match(humanSection, /row: input\.follow60ControlByAccount\.get\(accountId\)/);
  assert.match(humanSection, /if \(follow60Resolution && !follow60Resolution\.ok\) \{\s*await blockResume\(follow60Resolution\.reason\)/);
  assert.match(humanSection, /projectArmedFollow60Candidate\(rebuiltGoldenCandidate, follow60Resolution\.control\)/);
  assert.match(humanSection, /attachArmedFollow60Contract\(/);
  assert.match(humanSection, /rebuiltCandidate && !follow60Authority/);
  assert.match(humanSection, /follow60sOneShot\?\.matched\s*\?/);
});

test("database preflight is authoritative for authorization expiry", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /incident_resume_authorization_preflight_v2/);
  assert.match(humanSection, /resume_authorization_preflight_unavailable/);
  assert.match(humanSection, /preflightReason === "resume_authorization_expired"/);
  assert.match(tickSource, /markAuthorizationExpired\(supabase, authorizationId, now\)/);
  assert.match(tickSource, /resume_authorization_expired/);
  assert.doesNotMatch(humanSection, /windowContainsNow\(/);
});

test("canonical run-start gates apply (manual_only excluded, no active run)", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /evaluateRunStartEligibility\(accountId, "account_session", \{/);
  assert.match(humanSection, /phasesToRun: resumeMetadata\.resume_plan\.phases_to_run/);
});

test("resolved Instagram restrictions enqueue only a zero-business-action preflight", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /instagram_account_restriction/);
  assert.match(humanSection, /buildInstagramRestrictionPreflightMetadata/);
  assert.match(humanSection, /verification_required/);
  assert.match(humanSection, /restriction_preflight_only: restrictionPreflight/);
});

test("a failed atomic enqueue leaves authorization retryable", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /database transaction rolls back authorization consumption/i);
  assert.doesNotMatch(humanSection, /bindAuthorizationToRequest/);
  assert.match(humanSection, /restore_prebusiness_resume_retry_credits_v1/);
});

test("internal test authorizations can never enqueue anything", () => {
  assert.match(tickSource, /test_authorization_excluded/);
});

test("a resolved human authorization must match the latest canonical run", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /validateResumeAuthorizationLineage/);
  assert.match(humanSection, /latestCanonicalRunId: candidate\?\.sourceRunId/);
  assert.match(humanSection, /resolvedIncidentAuthorized: true/);
  assert.match(humanSection, /markAuthorizationExpired\(supabase, authorizationId, now\)/);
  assert.match(humanSection, /await blockResume\(lineageVerdict\.reason\)/);
});

test("resolved review gets one atomic retry credit without changing global budgets", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.doesNotMatch(humanSection, /restartDelayBlockReason\(candidate\.reliability\.nextRestartAt, now\)/);
  assert.match(humanSection, /authorizationRetryCreditScope = "one_shot_atomic_authorization"/);
  assert.match(humanSection, /authorization_retry_credit_scope: authorizationRetryCreditScope/);
  assert.doesNotMatch(humanSection, /await blockResume\("max_restarts_day"\)/);
  assert.doesNotMatch(humanSection, /await blockResume\("max_restarts_window"\)/);
  assert.match(humanSection, /evaluateRunStartEligibility/);
  assert.match(humanSection, /validateCanonicalResumePlan/);
  assert.match(humanSection, /consumeAuthorizationAndCreateRequest\(supabase/);
});

test("human Unfollow resume transports the exact persisted Daily Plan checkpoint", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(authorizationSource, /attempts_in_window,plan,test/);
  assert.match(humanSection, /storedPlanPayload = readRecord\(storedPlan\.plan\)/);
  assert.match(humanSection, /storedPlanPayload\?\.unfollow_checkpoint/);
  assert.match(humanSection, /resumeMetadata\.resume_plan\.unfollow_checkpoint = storedUnfollowCheckpoint/);
  assert.ok(
    humanSection.indexOf("resumeMetadata.resume_plan.unfollow_checkpoint = storedUnfollowCheckpoint")
      < humanSection.indexOf("consumeAuthorizationAndCreateRequest(supabase"),
    "the exact checkpoint must be attached before atomic request creation",
  );
});

test("persisted post-follow recovery is ordered before remaining Follow quota", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /storedPhases\?\.post_follow_recovery === true/);
  assert.match(humanSection, /post_follow_recovery_reconciliation_required/);
  assert.match(humanSection, /"post_follow_recovery", "welcome", "follow", "unfollow"/);
  assert.match(humanSection, /safe_next_step: "post_follow_recovery"/);
  assert.match(humanSection, /post_follow_recovery: true/);
  assert.ok(
    humanSection.indexOf('safe_next_step: "post_follow_recovery"')
      < humanSection.indexOf("consumeAuthorizationAndCreateRequest(supabase"),
  );
});

test("generic auto restart still enforces global retry budgets", () => {
  const genericSection = tickSource.slice(0, tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(genericSection, /max_restarts_day/);
  assert.match(genericSection, /max_restarts_window/);
});

test("every decision is audited in auto_restart_decisions", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /human_confirmed_resume_enqueued/);
  assert.match(humanSection, /human_confirmed_resume_evaluated/);
  assert.match(humanSection, /writeDecision/);
});

// Execute the actual complete tick module. Only external I/O/authentication and
// candidate projection are injected; tick/lock/summary logic and scheduler gate
// are unchanged. This is a caller proof, not a substitute for real SQL proofs.
const compiledTick = ts.transpileModule(tickSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
type ReconciliationFixture = {
  enabled?: boolean;
  mode?: string;
  existingLock?: boolean;
  error?: { message?: string };
  transportError?: Error;
  data?: unknown;
  projectionError?: Error;
};

function reconciliationTickFixture(config: ReconciliationFixture = {}) {
  const events: string[] = [];
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const lockUpdates: Array<Record<string, unknown>> = [];
  const forbidden = () => { throw new Error("unexpected external effect in tick fixture"); };
  const db = {
    from(table: string) {
      events.push(`from:${table}`);
      assert.ok([
        "auto_restart_settings", "auto_restart_tick_locks", "follow_60s_canary_controls",
        "auto_restart_decisions", "incident_resume_authorizations",
      ].includes(table), `unexpected table: ${table}`);
      let operation = "select";
      const result = (single = false) => ({ data: operation !== "select" ? null
        : table === "auto_restart_settings" ? {}
        : table === "auto_restart_tick_locks" ? config.existingLock ? { status: "started" } : null
        : single ? null : [], error: null });
      const builder = {
        select() { return this; }, eq() { return this; }, gte() { return this; },
        order() { return this; }, limit() { return this; },
        maybeSingle: async () => result(true),
        insert() {
          assert.equal(table, "auto_restart_tick_locks", "no request/run/authorization insert");
          operation = "insert"; events.push("tick-lock-insert"); return this;
        },
        update(value: Record<string, unknown>) {
          assert.equal(table, "auto_restart_tick_locks", "no application-state update");
          operation = "update"; lockUpdates.push(value); return this;
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args }); events.push(`rpc:${name}`);
      if (name === "reconcile_stale_account_session_resume_plans_v1") {
        if (config.transportError) throw config.transportError;
        return { data: config.data ?? { ok: true, reconciled_count: 0, ambiguous_count: 0 }, error: config.error ?? null };
      }
      assert.ok([
        "reconcile_resolved_incident_resume_windows_v2", "restore_prebusiness_resume_retry_credits_v1",
      ].includes(name), `unexpected RPC or enqueue: ${name}`);
      return { data: {}, error: null };
    },
  };
  const imports: Record<string, unknown> = {
    "@/app/instagram-dashboard/auto-restart-data": {
      rulesFromSettingsRow: () => ({ enabled: config.enabled ?? true, mode: config.mode ?? "production" }),
      getAutoRestartData: async () => {
        events.push("projection");
        if (config.projectionError) throw config.projectionError;
        return { candidates: [] };
      },
    },
    "./auto-restart-tick-helpers": tickHelpers,
    "@/lib/instagram-dashboard/dispatcher-trust": {
      isRunDispatcherWorkerId: () => true,
      assertTrustedDispatcherIdentity: async () => ({ ok: true }),
    },
  };
  const exports: Record<string, unknown> = {};
  new Function("require", "module", "exports", compiledTick)(
    (name: string) => imports[name] ?? new Proxy({}, { get: () => forbidden }),
    { exports }, exports,
  );
  const run = exports.runAutoRestartTick as (
    db: unknown, options: Record<string, unknown>,
  ) => Promise<{ result: Record<string, unknown> }>;
  return {
    events, calls, lockUpdates,
    execute: (options: Record<string, unknown> = {}) => run(db, {
      workerId: fixture.worker, internal: true, env: {},
      now: new Date("2026-10-19T11:00:00Z"), ...options,
    }),
    reconciliationCalls: () => calls.filter((call) => call.name === "reconcile_stale_account_session_resume_plans_v1"),
  };
}

test("natural tick repairs stale plans exactly once before projecting candidates", async () => {
  const f = reconciliationTickFixture({ data: {
    ok: true, reconciled_count: 1, ambiguous_count: 1,
    reconciled: [{ run_id: "repaired-run" }], ambiguous: [{ run_id: "blocked-run" }],
    attempts_consumed: 0, requests_enqueued: 0,
  } });
  const { result } = await f.execute();
  assert.deepEqual(f.reconciliationCalls(), [{
    name: "reconcile_stale_account_session_resume_plans_v1", args: { p_limit: 100 },
  }]);
  const repair = f.events.indexOf("rpc:reconcile_stale_account_session_resume_plans_v1");
  assert.ok(f.events.indexOf("tick-lock-insert") < repair);
  assert.ok(repair < f.events.indexOf("projection"));
  assert.equal(result.reconciled_plan_count, 1);
  assert.equal(result.ambiguous_stale_plan_count, 1);
  assert.deepEqual(result.reconciled_plan_run_ids, ["repaired-run"]);
  assert.deepEqual(result.ambiguous_stale_plan_run_ids, ["blocked-run"]);
  assert.equal(result.enqueued_count, 0);
  assert.equal(f.lockUpdates.at(-1)?.status, "completed");
});

for (const scenario of [
  { label: "manual", config: {}, options: { manual: true } },
  { label: "dry-run", config: {}, options: { dryRun: true } },
  { label: "shadow", config: { mode: "shadow" }, options: {} },
  { label: "disabled", config: { enabled: false }, options: {} },
  { label: "deduplicated tick lock", config: { existingLock: true }, options: {} },
]) {
  test(`${scenario.label} never adds stale-plan reconciliation`, async () => {
    const f = reconciliationTickFixture(scenario.config);
    const { result } = await f.execute(scenario.options);
    assert.deepEqual(f.reconciliationCalls(), []);
    assert.equal(result.reconciled_plan_count, 0);
    assert.equal(result.ambiguous_stale_plan_count, 0);
    assert.deepEqual(result.reconciled_plan_run_ids, []);
    assert.deepEqual(result.ambiguous_stale_plan_run_ids, []);
    if (scenario.label !== "manual") assert.equal(f.lockUpdates.length, 0);
  });
}

for (const error of [{ message: "repair denied" }, {}]) {
  test(`reconciliation RPC error fails its tick without projection or retry: ${JSON.stringify(error)}`, async () => {
    const f = reconciliationTickFixture({ error });
    await assert.rejects(f.execute(), {
      message: error.message || "stale_resume_plan_reconciliation_failed",
    });
    assert.equal(f.reconciliationCalls().length, 1);
    assert.equal(f.events.includes("projection"), false);
    assert.equal(f.calls.length, 1);
    assert.equal(f.lockUpdates.at(-1)?.status, "failed");
    const metadata = f.lockUpdates.at(-1)?.metadata_safe as Record<string, unknown>;
    assert.equal(typeof metadata.failure_reason, "string");
    assert.ok(String(metadata.failure_reason).length > 0);
  });
}

test("transport failure preserves the original error and finalizes the held tick lock", async () => {
  const error = new Error("synthetic transport failure");
  const f = reconciliationTickFixture({ transportError: error });
  await assert.rejects(f.execute(), (actual) => actual === error);
  assert.equal(f.reconciliationCalls().length, 1);
  assert.equal(f.events.includes("projection"), false);
  assert.equal(f.lockUpdates.at(-1)?.status, "failed");
});

test("a later projection failure never replays successful reconciliation", async () => {
  const error = new Error("synthetic projection failure");
  const f = reconciliationTickFixture({ projectionError: error });
  await assert.rejects(f.execute(), (actual) => actual === error);
  assert.equal(f.reconciliationCalls().length, 1);
  assert.equal(f.lockUpdates.at(-1)?.status, "failed");
});
