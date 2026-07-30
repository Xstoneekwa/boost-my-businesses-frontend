import assert from "node:assert/strict";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { assessAvailability } from "./assessment-engine.ts";
import { projectAvailabilityCurrent } from "./current-projection.ts";
import type { AvailabilityAssessment } from "./engine-types.ts";
import { loadReplayFixtures, replayTargetAvailability } from "./replay-harness.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(root, "fixtures", "rare-signal-fixtures.json");

test("all 30 mandatory rare-signal fixtures replay without invariant violations", async () => {
  const fixtures = await loadReplayFixtures(fixturePath);
  assert.equal(fixtures.length, 30);
  const reports = fixtures.map(replayTargetAvailability);
  assert.deepEqual(reports.flatMap((report) => report.invariantViolations.map((reason) => `${report.fixtureName}:${reason}`)), []);
  assert.equal(reports.every((report) => report.events.at(-1)?.type === "replay_completed"), true);
});

test("replay output is deterministic, serializable and retains no raw UI or secret fields", async () => {
  const fixtures = await loadReplayFixtures(fixturePath);
  for (const fixture of fixtures) {
    const first = replayTargetAvailability(fixture);
    const second = replayTargetAvailability(fixture);
    const stable = (report: typeof first) => ({ ...report, timingMs: { total: 0, identity: 0, assessment: 0, current: 0 } });
    assert.deepEqual(stable(first), stable(second), fixture.name);
    const serialized = JSON.stringify(first);
    assert.doesNotMatch(serialized, /password|cookie|authorization|raw_ui|screenshot/i);
  }
});

test("same username in two tenants and accounts remains fully isolated", async () => {
  const [fixture] = await loadReplayFixtures(fixturePath);
  assert.ok(fixture);
  const foreign = {
    ...fixture,
    name: "multitenant-isolation",
    scope: { tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    observations: fixture.observations.map((row) => ({ ...row, tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })),
  };
  const first = replayTargetAvailability(fixture);
  const second = replayTargetAvailability(foreign);
  assert.notEqual(first.finalIdentity.tenantId, second.finalIdentity.tenantId);
  assert.notEqual(first.finalAvailabilityCurrent?.accountId, second.finalAvailabilityCurrent?.accountId);
});

test("concurrent workers and engine upgrade remain deterministic", async () => {
  const fixtures = await loadReplayFixtures(fixturePath);
  const concurrent = replayTargetAvailability(fixtures[17]!);
  assert.equal(concurrent.eventsAccepted, 2);
  const base = concurrent.generatedAssessments[0]!;
  const upgraded: AvailabilityAssessment = { ...base, assessmentId: "ffffffff-ffff-5fff-8fff-ffffffffffff", engineVersion: "target-availability-engine-v4", engineRevision: base.engineRevision + 1 };
  const initial = projectAvailabilityCurrent({ scope: concurrent.finalIdentity, previous: null, assessment: base });
  const update = projectAvailabilityCurrent({ scope: concurrent.finalIdentity, previous: initial.current, assessment: upgraded });
  assert.equal(update.outcome, "updated");
  assert.equal(update.current?.engineVersion, "target-availability-engine-v4");
});

test("100 and 1000 observation local performance is measured without production thresholds", async () => {
  const fixtures = await loadReplayFixtures(fixturePath);
  const high = fixtures[29]!;
  const hundred = { ...high, name: "100 observation benchmark", observations: high.observations.slice(0, 100), generatedObservationCount: 100, expected: { ...high.expected, acceptedCount: 100 } };
  const started = performance.now();
  const report100 = replayTargetAvailability(hundred);
  const report1000 = replayTargetAvailability(high);
  const wallMs = performance.now() - started;
  assert.equal(report100.eventsAccepted, 100);
  assert.equal(report1000.eventsAccepted, 1000);
  assert.ok(report100.timingMs.total >= 0);
  assert.ok(report1000.timingMs.total >= 0);
  assert.ok(wallMs >= 0);
});

test("10000 observation replay remains deterministic and tenant scoped", async () => {
  const fixtures = await loadReplayFixtures(fixturePath);
  const high = fixtures[29]!;
  const template = high.observations[0]!;
  const baseTime = Date.parse(high.calculatedAt);
  const tenThousand = {
    ...high,
    name: "10000 observation capacity review",
    observations: Object.freeze(Array.from({ length: 10_000 }, (_, index) => Object.freeze({
      ...template,
      observationId: `capacity-observation-${index + 1}`,
      idempotencyKey: `capacity-key-${index + 1}`,
      observedAt: new Date(baseTime - (10_000 - index) * 1_000).toISOString(),
      runId: `capacity-run-${Math.floor(index / 25) + 1}`,
    }))),
    generatedObservationCount: 10_000,
    expected: { ...high.expected, acceptedCount: 10_000 },
  };
  const first = replayTargetAvailability(tenThousand);
  const second = replayTargetAvailability(tenThousand);
  const stable = (report: typeof first) => ({ ...report, timingMs: { total: 0, identity: 0, assessment: 0, current: 0 } });

  assert.equal(first.inputs, 10_000);
  assert.equal(first.eventsAccepted, 10_000);
  assert.equal(first.eventsRejected, 0);
  assert.deepEqual(first.invariantViolations, []);
  assert.equal(first.finalIdentity.tenantId, high.scope.tenantId);
  assert.equal(first.finalAvailabilityCurrent?.accountId, high.scope.accountId);
  assert.deepEqual(stable(first), stable(second));
});

test("assessment computation remains side-effect free during replay", async () => {
  const [fixture] = await loadReplayFixtures(fixturePath);
  assert.ok(fixture);
  const report = replayTargetAvailability(fixture);
  const before = JSON.stringify(fixture.observations);
  const identity = report.finalIdentity;
  assessAvailability({ scope: fixture.scope, identity, observations: fixture.observations, assessedAt: fixture.calculatedAt });
  assert.equal(JSON.stringify(fixture.observations), before);
});
