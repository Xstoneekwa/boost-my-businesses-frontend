import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { AutoRestartCandidate } from "@/app/instagram-dashboard/auto-restart-data";
import { buildAutoRestartResumePlanMetadata } from "./auto-restart-resume-metadata.ts";
import { resolveCanonicalAttemptIdentity } from "./auto-restart-lineage-policy.ts";

const dataSource = readFileSync(
  new URL("../../app/instagram-dashboard/auto-restart-data.ts", import.meta.url),
  "utf8",
);
const tickSource = readFileSync(new URL("./auto-restart-tick.ts", import.meta.url), "utf8");

const historicalIdentityFixtures = [
  {
    name: "rex",
    accountId: "b024e94e-395d-4f02-9787-81ddc679b014",
    sourceRequestId: "2e780a67-864b-4fa9-abc5-2004b2bb2ad8",
    rootBusinessSessionId: "2e780a67-864b-4fa9-abc5-2004b2bb2ad8",
    runId: "3b689b40-ec8e-4cac-94e6-ba5ca7cff758",
    authorizationId: "9579c6a9-e927-45f9-a9ed-5d0754994306",
    executionAttemptNo: 1,
    retryIndex: 0,
    legacyLineagePresent: false,
  },
  {
    name: "bmy",
    accountId: "2cd8e47f-62ee-43b2-9534-18d9f19d814f",
    sourceRequestId: "dd210f11-34ad-4070-8e04-800ddd1a5ddd",
    rootBusinessSessionId: "dd210f11-34ad-4070-8e04-800ddd1a5ddd",
    runId: "36ec067b-d120-44eb-8ac3-b60dbe0b19f6",
    authorizationId: "d5606fbc-c368-433f-b0f4-ca21917705f2",
    executionAttemptNo: 1,
    retryIndex: 0,
    legacyLineagePresent: false,
  },
  {
    name: "lorie",
    accountId: "dfe78a92-3a51-435e-8911-ed10c93a4d82",
    sourceRequestId: "7b4b49f0-ab25-4cf9-aab2-8b0865705343",
    rootBusinessSessionId: "7b4b49f0-ab25-4cf9-aab2-8b0865705343",
    runId: "bc7f0554-9bd6-43ed-962a-a680e8b92dfc",
    authorizationId: "bea9cc94-7b05-44d5-a4ef-5757a3fe4282",
    executionAttemptNo: 1,
    retryIndex: 0,
    legacyLineagePresent: false,
  },
  {
    name: "nab",
    accountId: "76c1dff8-d16a-40cf-83df-8138d2ca5bd4",
    sourceRequestId: "e10ebfae-a17c-4d96-89dd-4487f21196be",
    rootBusinessSessionId: "e10ebfae-a17c-4d96-89dd-4487f21196be",
    runId: "10cc0fdc-e2f0-4145-83ae-00dd8c5b0bb7",
    authorizationId: "a0036ee6-6672-4079-bc52-62ac514c7807",
    executionAttemptNo: 1,
    retryIndex: 0,
    legacyLineagePresent: false,
  },
] as const;

function candidateFor(
  fixture: typeof historicalIdentityFixtures[number],
  identity: ReturnType<typeof resolveCanonicalAttemptIdentity>,
) {
  return {
    accountId: fixture.accountId,
    assignmentId: "assignment-fixture",
    deviceId: "device-fixture",
    appInstanceId: "app-instance-fixture",
    username: fixture.name,
    packageLabel: "fixture",
    commercialAddonsLabel: "",
    outreachSourceLabel: "",
    runtimeProfilesLabel: "",
    followFiltersLabel: "",
    enabledServices: ["Follow"],
    phoneName: "fixture",
    phoneRestStatus: "ready",
    sessionWindowStatus: "open",
    assignmentStatus: "active",
    gateStatus: "eligible_preview",
    accountEligible: true,
    accountEligibilityReason: "resolved_incident_live_plan_rebuilt",
    restartNeeded: true,
    restartNeedReason: "resolved_incident_live_plan_rebuilt",
    exactViewportResumeAvailable: false,
    safeRestartStrategy: "rebuilt_safe_target_plan",
    safeRestartReason: "resolved_incident_canonical_target_plan_rebuild",
    historicalSafeBoundaryFallback: false,
    enqueueAllowed: true,
    sourceRunId: fixture.runId,
    sourceRequestId: identity.sourceRequestId,
    canonicalAttemptId: identity.canonicalAttemptId,
    sourceLineageValid: identity.lineageValid,
    sourceBusinessSessionId: identity.canonicalBusinessSessionId ?? "",
    priorTargetId: null,
    nextTargetId: "target-fixture",
    nextRetryIndex: (identity.canonicalRetryIndex ?? -1) + 1,
    remainingFollowQuota: 1,
    plannedPhasesToRun: { welcome: false, follow: true, unfollow: false },
    plannedQuotaRemaining: { welcome: 0, follow: 1, unfollow: 0, outreach: 0 },
    decisionOutcome: "eligible",
    restartEligible: true,
    blockReason: "",
    plannedRunType: "account_session",
    reliability: {
      restartAllowed: true,
      restartBlockReason: "",
      unsafeMarkers: [],
      currentAttempt: String(identity.canonicalAttemptId),
      nextAttempt: String((identity.canonicalAttemptId ?? 0) + 1),
      nextRestartAt: null,
      lastRestartError: "",
      sessionTerminationClass: "failed",
      businessSessionId: identity.canonicalBusinessSessionId ?? "",
      attemptId: String(identity.canonicalAttemptId),
      canonicalAttemptId: identity.canonicalAttemptId,
      sourceRequestId: identity.sourceRequestId,
      attemptSource: identity.attemptSource,
      attemptProjectionId: identity.runProjectionAttemptId,
      attemptProjectionDivergence: identity.divergence,
      sourceLineageValid: identity.lineageValid,
      retryIndex: String(identity.canonicalRetryIndex),
      nextRetryIndex: String((identity.canonicalRetryIndex ?? -1) + 1),
      previousRunId: "",
      rootFailureCode: "run_identity_verification_failed",
      failureSignature: "identity:fixture",
      failureCategory: "identity",
      cleanupCompleted: true,
      lockReleased: true,
      businessDaySast: "2026-09-11",
      phasesToRun: { welcome: false, follow: true, unfollow: false },
      quotaRemaining: { follow: 1 },
      safeCheckpointAvailable: false,
      targetRotationSafeAfterScrollFailure: false,
      scrollFailureSurfaceAmbiguous: false,
      lastRunId: fixture.runId,
      lastRunStatus: "failed",
      sourceLabel: "historical_identity_fixture",
    },
    quotas: {
      follow: { doneToday: 0, capDay: 1, remaining: 1, plannedNextRunQuota: 1, enabled: true, sourceLabel: "fixture" },
      unfollow: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "fixture" },
      welcome: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "fixture" },
      outreach: { doneToday: 0, capDay: 0, remaining: 0, plannedNextRunQuota: 0, enabled: false, sourceLabel: "fixture" },
    },
  } as AutoRestartCandidate;
}

function metadataTupleMatchesSource(
  source: typeof historicalIdentityFixtures[number],
  metadata: ReturnType<typeof buildAutoRestartResumePlanMetadata>,
) {
  return metadata.business_session_id === source.rootBusinessSessionId
    && metadata.resume_plan.business_session_id === source.rootBusinessSessionId
    && metadata.attempt_id === source.executionAttemptNo + 1
    && metadata.retry_index === source.retryIndex + 1
    && metadata.source_request_id === source.sourceRequestId;
}

test("source request projection selects the complete canonical lineage tuple without query amplification", () => {
  assert.match(dataSource, /root_business_session_id,execution_attempt_no,retry_index,metadata_safe/);
  assert.doesNotMatch(
    dataSource,
    /: reliability\.businessSessionId \|\| reliability\.lastRunId/,
  );
  assert.equal((dataSource.match(/\.from\("account_run_requests"\)/g) ?? []).length >= 1, true);
});

for (const fixture of historicalIdentityFixtures) {
  test(`${fixture.name} RESOLVER_FIXTURE_PROOF: canonical lineage survives metadata projection`, () => {
    assert.equal(fixture.legacyLineagePresent, false);
    assert.notEqual(fixture.rootBusinessSessionId, fixture.runId);
    const identity = resolveCanonicalAttemptIdentity({
      sourceRunId: fixture.runId,
      sourceAccountId: fixture.accountId,
      sourceRequest: {
        id: fixture.sourceRequestId,
        account_id: fixture.accountId,
        run_id: fixture.runId,
        root_business_session_id: fixture.rootBusinessSessionId,
        execution_attempt_no: fixture.executionAttemptNo,
        retry_index: fixture.retryIndex,
        metadata_safe: {},
      },
    });
    assert.equal(identity.lineageValid, true);
    assert.equal(identity.lineageMode, "canonical_db_columns");
    assert.equal(identity.canonicalBusinessSessionId, fixture.rootBusinessSessionId);
    assert.equal(identity.canonicalAttemptId, 1);
    assert.equal(identity.canonicalRetryIndex, 0);

    const metadata = buildAutoRestartResumePlanMetadata(candidateFor(fixture, identity));
    assert.equal(metadataTupleMatchesSource(fixture, metadata), true);
    assert.match(`resume-auth:${fixture.authorizationId}:g0`, /^resume-auth:[0-9a-f-]+:g0$/);
  });
}

test("canonical columns win over a run id fallback but contradictory legacy lineage fails closed", () => {
  const fixture = historicalIdentityFixtures[0];
  const canonical = resolveCanonicalAttemptIdentity({
    sourceRunId: fixture.runId,
    sourceAccountId: fixture.accountId,
    sourceRequest: {
      id: fixture.sourceRequestId,
      account_id: fixture.accountId,
      run_id: fixture.runId,
      root_business_session_id: fixture.rootBusinessSessionId,
      execution_attempt_no: 1,
      retry_index: 0,
      metadata_safe: {},
    },
    legacyBusinessSessionId: "",
    runProjectionAttemptId: 1,
  });
  assert.equal(canonical.canonicalBusinessSessionId, fixture.rootBusinessSessionId);
  assert.notEqual(canonical.canonicalBusinessSessionId, fixture.runId);

  const mismatch = resolveCanonicalAttemptIdentity({
    sourceRunId: fixture.runId,
    sourceAccountId: fixture.accountId,
    sourceRequest: {
      id: fixture.sourceRequestId,
      account_id: fixture.accountId,
      run_id: fixture.runId,
      root_business_session_id: fixture.rootBusinessSessionId,
      execution_attempt_no: 1,
      retry_index: 0,
      metadata_safe: { business_session_id: "different-root", attempt_id: 2, retry_index: 1 },
    },
  });
  assert.equal(mismatch.lineageValid, false);
  assert.equal(mismatch.lineageReason, "canonical_resume_lineage_mismatch");
});

test("legacy compatibility requires a complete compatible tuple", () => {
  const valid = resolveCanonicalAttemptIdentity({
    sourceRunId: "legacy-run",
    sourceRequest: {
      id: "legacy-request",
      run_id: "legacy-run",
      metadata_safe: {
        business_session_id: "legacy-root",
        attempt_id: 2,
        retry_index: 1,
      },
    },
  });
  assert.equal(valid.lineageValid, true);
  assert.equal(valid.lineageMode, "compatible_legacy_fallback");

  const ambiguous = resolveCanonicalAttemptIdentity({
    sourceRunId: "legacy-run",
    sourceRequest: { id: "legacy-request", run_id: "legacy-run", metadata_safe: {} },
    runProjectionAttemptId: 1,
  });
  assert.equal(ambiguous.lineageValid, false);
  assert.equal(ambiguous.lineageReason, "legacy_resume_lineage_unprovable");

  const missing = resolveCanonicalAttemptIdentity({
    sourceRunId: "legacy-run",
    sourceRequest: { id: "legacy-request", run_id: "legacy-run", metadata_safe: {} },
  });
  assert.equal(missing.lineageValid, false);
  assert.equal(missing.lineageReason, "canonical_resume_lineage_missing");
});

test("invalid canonical attempt, retry and account fail closed", () => {
  const fixture = historicalIdentityFixtures[1];
  for (const sourceRequest of [
    { execution_attempt_no: 0, retry_index: 0 },
    { execution_attempt_no: 2, retry_index: 0 },
    { execution_attempt_no: 1, retry_index: 1 },
  ]) {
    const identity = resolveCanonicalAttemptIdentity({
      sourceRunId: fixture.runId,
      sourceAccountId: fixture.accountId,
      sourceRequest: {
        id: fixture.sourceRequestId,
        account_id: fixture.accountId,
        run_id: fixture.runId,
        root_business_session_id: fixture.rootBusinessSessionId,
        metadata_safe: {},
        ...sourceRequest,
      },
    });
    assert.equal(identity.lineageValid, false);
    assert.equal(identity.lineageReason, "canonical_resume_lineage_mismatch");
  }

  const wrongAccount = resolveCanonicalAttemptIdentity({
    sourceRunId: fixture.runId,
    sourceAccountId: fixture.accountId,
    sourceRequest: {
      id: fixture.sourceRequestId,
      account_id: "wrong-account",
      run_id: fixture.runId,
      root_business_session_id: fixture.rootBusinessSessionId,
      execution_attempt_no: 1,
      retry_index: 0,
    },
  });
  assert.equal(wrongAccount.lineageValid, false);

});

test("natural tick keeps the atomic one-shot V4 path and a new resume authorization key", () => {
  const humanSection = tickSource.slice(tickSource.indexOf("async function processHumanConfirmedResumes"));
  assert.match(humanSection, /evaluateRunStartEligibility/);
  assert.match(humanSection, /consumeAuthorizationAndCreateRequest\(supabase/);
  assert.match(tickSource, /consume_resume_authorization_and_create_request_v4/);
  assert.match(humanSection, /idempotencyKey: `resume-auth:\$\{authorizationId\}`/);
  assert.doesNotMatch(humanSection, /schedule-session:/);
});
