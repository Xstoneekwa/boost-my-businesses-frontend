import assert from "node:assert/strict";
import test from "node:test";
import {
  parseTargetLifecycleRuntimeState,
  processTargetLifecycleBatch,
  targetLifecycleRuntimeActive,
} from "./runtime-pipeline.ts";

const runtimeState = {
  id: "global",
  producer_enabled: true,
  current_projector_enabled: true,
  shadow_enabled: true,
  scope_mode: "all_active_accounts",
  enforce_enabled: false,
  business_actions_enabled: false,
  lifecycle_actions_enabled: false,
  replacement_enabled: false,
  notifications_enabled: false,
  archiving_enabled: false,
  premium_replacement_enabled: false,
  auto_killed: false,
  human_reenable_required: false,
  config_version: 2,
  cursor_target_id: null,
  caps_safe: {
    batch_size: 25,
    retries: 1,
    pipeline_duration_ms: 3000,
    assessments_global_day: 1000,
    assessments_account_day: 250,
    global_concurrency: 1,
  },
};

const row = {
  tenant_id: "11111111-1111-4111-8111-111111111111",
  account_id: "22222222-2222-4222-8222-222222222222",
  target_id: "33333333-3333-4333-8333-333333333333",
  normalized_username: "target.one",
  target_updated_at: "2026-07-31T10:00:00.000Z",
  followers_count: 1000,
  denominator_observed_at: "2026-07-31T10:00:00.000Z",
  follows_sent_count: 120,
  followbacks_count: 12,
  performance_skips: 34,
  performance_errors: 2,
  followback_ratio: 10,
  metrics_observed_at: "2026-07-31T10:00:00.000Z",
  performance_reliable_at: "2026-07-31T10:00:00.000Z",
  performance_event_observed_at: "2026-07-31T10:30:00.000Z",
  unique_profiles_evaluated: 300,
  last_evaluated_at: "2026-07-31T10:00:00.000Z",
  terminal_proof: false,
  availability_assessment_id: "44444444-4444-4444-8444-444444444444",
  availability_status: "available",
  availability_confidence: "high",
  availability_identity_status: "identity_confirmed",
  availability_latest_observation_at: "2026-07-31T10:00:00.000Z",
  availability_valid_until: "2026-08-01T10:00:00.000Z",
  availability_reason_codes: ["target_available"],
  identity_status: "identity_confirmed",
  lifecycle_status: null,
};

function fakeSupabase(input: {
  state?: Record<string, unknown>;
  persistOutcome?: string;
  businessActions?: number;
  rows?: unknown[];
  nextCursor?: string | null;
  wrapped?: boolean;
  capacityDelayMs?: number;
} = {}) {
  const calls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  let persistedBundle: Record<string, unknown> | null = null;
  const client = {
    from(table: string) {
      assert.equal(table, "ct_target_lifecycle_runtime_state");
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: input.state ?? runtimeState, error: null }),
              };
            },
          };
        },
      };
    },
    async rpc(name: string, args?: Record<string, unknown>) {
      calls.push({ name, args });
      if (name === "claim_target_lifecycle_pipeline_lease_v1") {
        return { data: "55555555-5555-4555-8555-555555555555", error: null };
      }
      if (name === "list_target_lifecycle_work_v1") {
        return {
          data: {
            rows: input.rows ?? [row],
            next_cursor: input.nextCursor === undefined ? row.target_id : input.nextCursor,
            wrapped: input.wrapped ?? false,
          },
          error: null,
        };
      }
      if (name === "claim_target_lifecycle_assessment_capacity_v1") {
        if (input.capacityDelayMs) await new Promise((resolve) => setTimeout(resolve, input.capacityDelayMs));
        return { data: true, error: null };
      }
      if (name === "persist_target_lifecycle_shadow_v1") {
        persistedBundle = args?.p_bundle as Record<string, unknown>;
        return {
          data: {
            outcome: input.persistOutcome ?? "processed",
            business_actions: input.businessActions ?? 0,
          },
          error: null,
        };
      }
      return { data: true, error: null };
    },
  };
  return { client, calls, persistedBundle: () => persistedBundle };
}

test("runtime state is globally active only while every business action is structurally off", () => {
  assert.equal(targetLifecycleRuntimeActive(parseTargetLifecycleRuntimeState(runtimeState)), true);
  assert.equal(targetLifecycleRuntimeActive(parseTargetLifecycleRuntimeState({ ...runtimeState, enforce_enabled: true })), false);
  assert.equal(targetLifecycleRuntimeActive(parseTargetLifecycleRuntimeState({ ...runtimeState, scope_mode: "explicit_allowlist" })), false);
  assert.equal(targetLifecycleRuntimeActive(parseTargetLifecycleRuntimeState({ ...runtimeState, auto_killed: true })), false);
});

test("one bounded batch persists a shadow-only bundle and records zero actions", async () => {
  const fake = fakeSupabase();
  const result = await processTargetLifecycleBatch(fake.client as never, {
    workerId: "backend-target-lifecycle-cron",
    batchKey: "target-lifecycle-cron:2026-07-31T12:00:00.000Z",
    processorRelease: "backend-sha",
    calculatedAt: "2026-07-31T12:00:00.000Z",
  });
  assert.equal(result.active, true);
  assert.equal(result.attempted, 1);
  assert.equal(result.processed, 1);
  assert.equal(result.errors, 0);
  assert.equal(result.crossTenant, 0);
  const bundle = fake.persistedBundle();
  assert.equal(bundle?.enforcement_allowed, false);
  assert.equal(bundle?.business_action_allowed, false);
  assert.equal(bundle?.mutation_executed, false);
  assert.equal(bundle?.tenant_id, row.tenant_id);
  assert.equal(bundle?.account_id, row.account_id);
  assert.equal(bundle?.target_id, row.target_id);
  const performanceObservation = bundle?.performance_observation as Record<string, unknown>;
  const performanceMetadata = performanceObservation.metadata_safe as Record<string, unknown>;
  assert.equal(performanceMetadata.skips, 34);
  assert.equal(performanceMetadata.errors, 2);
  assert.equal(performanceObservation.observed_at, row.performance_event_observed_at);
  assert.ok(fake.calls.some((call) => call.name === "record_target_lifecycle_pipeline_metric_v1"
    && (call.args?.p_counters_safe as Record<string, unknown>).business_actions === 0));
  assert.ok(fake.calls.some((call) => call.name === "release_target_lifecycle_pipeline_lease_v1"));
});

test("duplicate and out-of-order outcomes stay non-critical and deterministic", async () => {
  const duplicate = fakeSupabase({ persistOutcome: "deduplicated" });
  const duplicateResult = await processTargetLifecycleBatch(duplicate.client as never, {
    workerId: "backend-target-lifecycle-cron",
    batchKey: "target-lifecycle-cron:duplicate",
    processorRelease: "backend-sha",
    calculatedAt: "2026-07-31T12:00:00.000Z",
  });
  assert.equal(duplicateResult.deduplicated, 1);
  assert.equal(duplicateResult.autoKilled, false);

  const outOfOrder = fakeSupabase({ persistOutcome: "out_of_order_skipped" });
  const outOfOrderResult = await processTargetLifecycleBatch(outOfOrder.client as never, {
    workerId: "backend-target-lifecycle-cron",
    batchKey: "target-lifecycle-cron:out-of-order",
    processorRelease: "backend-sha",
    calculatedAt: "2026-07-31T12:00:00.000Z",
  });
  assert.equal(outOfOrderResult.outOfOrderSkipped, 1);
  assert.equal(outOfOrderResult.versionRegressionSkipped, 0);
  assert.equal(outOfOrderResult.autoKilled, false);
});

test("a confirmed cross-tenant persistence outcome triggers the lifecycle auto-kill", async () => {
  const fake = fakeSupabase({ persistOutcome: "cross_tenant_rejected" });
  const result = await processTargetLifecycleBatch(fake.client as never, {
    workerId: "backend-target-lifecycle-cron",
    batchKey: "target-lifecycle-cron:cross-tenant",
    processorRelease: "backend-sha",
    calculatedAt: "2026-07-31T12:00:00.000Z",
  });
  assert.equal(result.crossTenant, 1);
  assert.equal(result.autoKilled, true);
  assert.ok(fake.calls.some((call) => call.name === "trigger_target_lifecycle_auto_kill_v1"));
});

test("a version divergence or unexpected business action triggers the lifecycle auto-kill", async () => {
  for (const [name, fake] of [
    ["version", fakeSupabase({ persistOutcome: "version_regression_skipped" })],
    ["business-action", fakeSupabase({ businessActions: 1 })],
  ] as const) {
    const result = await processTargetLifecycleBatch(fake.client as never, {
      workerId: "backend-target-lifecycle-cron",
      batchKey: `target-lifecycle-cron:${name}`,
      processorRelease: "backend-sha",
      calculatedAt: "2026-07-31T12:00:00.000Z",
    });
    assert.equal(result.autoKilled, true);
    assert.ok(fake.calls.some((call) => call.name === "trigger_target_lifecycle_auto_kill_v1"));
  }
});

test("inactive runtime performs no lease, work or persistence call", async () => {
  const fake = fakeSupabase({ state: { ...runtimeState, shadow_enabled: false } });
  const result = await processTargetLifecycleBatch(fake.client as never, {
    workerId: "backend-target-lifecycle-cron",
    batchKey: "target-lifecycle-cron:inactive",
    processorRelease: "backend-sha",
  });
  assert.equal(result.active, false);
  assert.deepEqual(fake.calls, []);
});

test("duration-limited partial batches advance only through the last handled target", async () => {
  const secondTargetId = "66666666-6666-4666-8666-666666666666";
  const secondRow = { ...row, target_id: secondTargetId, normalized_username: "target.two" };
  const fake = fakeSupabase({
    state: {
      ...runtimeState,
      caps_safe: { ...runtimeState.caps_safe, pipeline_duration_ms: 250 },
    },
    rows: [row, secondRow],
    nextCursor: secondTargetId,
    wrapped: false,
    capacityDelayMs: 275,
  });

  const result = await processTargetLifecycleBatch(fake.client as never, {
    workerId: "backend-target-lifecycle-cron",
    batchKey: "target-lifecycle-cron:duration-cap",
    processorRelease: "backend-sha",
    calculatedAt: "2026-07-31T12:00:00.000Z",
  });

  assert.equal(result.attempted, 2);
  assert.equal(result.processed, 1);
  assert.equal(result.capHits, 1);
  assert.equal(result.wrapped, false);
  assert.equal(result.nextCursor, row.target_id);
  const advance = fake.calls.find((call) => call.name === "advance_target_lifecycle_scan_cursor_v1");
  assert.equal(advance?.args?.p_next_cursor, row.target_id);
  assert.equal(advance?.args?.p_wrapped, false);
});

test("a partial batch after wrap retains both the completed-scan marker and handled cursor", async () => {
  const secondTargetId = "66666666-6666-4666-8666-666666666666";
  const secondRow = { ...row, target_id: secondTargetId, normalized_username: "target.two" };
  const fake = fakeSupabase({
    state: {
      ...runtimeState,
      caps_safe: { ...runtimeState.caps_safe, pipeline_duration_ms: 250 },
    },
    rows: [row, secondRow],
    nextCursor: secondTargetId,
    wrapped: true,
    capacityDelayMs: 275,
  });

  const result = await processTargetLifecycleBatch(fake.client as never, {
    workerId: "backend-target-lifecycle-cron",
    batchKey: "target-lifecycle-cron:wrapped-duration-cap",
    processorRelease: "backend-sha",
    calculatedAt: "2026-07-31T12:00:00.000Z",
  });

  assert.equal(result.processed, 1);
  assert.equal(result.wrapped, true);
  assert.equal(result.nextCursor, row.target_id);
  const advance = fake.calls.find((call) => call.name === "advance_target_lifecycle_scan_cursor_v1");
  assert.equal(advance?.args?.p_next_cursor, row.target_id);
  assert.equal(advance?.args?.p_wrapped, true);
});
