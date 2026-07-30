import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { assessAvailability } from "./assessment-engine.ts";
import { projectAvailabilityCurrent } from "./current-projection.ts";
import type {
  AvailabilityObservation,
  AvailabilityScope,
  AvailabilitySignal,
  ReplayFixture,
  ReplayReport,
} from "./engine-types.ts";
import { event, orderAndValidateObservations, timestamp } from "./engine-utils.ts";
import { resolveTargetIdentity } from "./identity-engine.ts";

type RawEvent = Readonly<Partial<AvailabilityObservation> & {
  signal: AvailabilitySignal;
  minutesAgo?: number;
  duplicateOf?: number;
}>;

type RawFixture = Readonly<{
  name: string;
  scope?: Partial<AvailabilityScope>;
  expectedUsername?: string;
  stablePlatformUserId?: string | null;
  calculatedAt?: string;
  events: readonly RawEvent[];
  generatedObservationCount?: number;
  resumeAfter?: number;
  expected: ReplayFixture["expected"];
}>;

type RawFixtureFile = Readonly<{
  defaults: Readonly<{
    scope: AvailabilityScope;
    expectedUsername: string;
    calculatedAt: string;
  }>;
  fixtures: readonly RawFixture[];
}>;

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function normalizeFixture(raw: RawFixture, defaults: RawFixtureFile["defaults"]): ReplayFixture {
  const scope = Object.freeze({ ...defaults.scope, ...raw.scope });
  const expectedUsername = raw.expectedUsername ?? defaults.expectedUsername;
  const calculatedAt = raw.calculatedAt ?? defaults.calculatedAt;
  const baseTime = timestamp(calculatedAt);
  const prefix = slug(raw.name);
  const keys: string[] = [];
  const observations = raw.events.map((item, index): AvailabilityObservation => {
    const key = item.duplicateOf === undefined ? `${prefix}-key-${index + 1}` : keys[item.duplicateOf] ?? `${prefix}-missing-duplicate`;
    keys.push(key);
    const eventScope = { ...scope, tenantId: item.tenantId ?? scope.tenantId, accountId: item.accountId ?? scope.accountId, targetId: item.targetId ?? scope.targetId };
    return Object.freeze({
      ...eventScope,
      observationId: item.observationId ?? `${prefix}-observation-${index + 1}`,
      idempotencyKey: item.idempotencyKey ?? key,
      signal: item.signal,
      observedAt: item.observedAt ?? new Date(baseTime - (item.minutesAgo ?? 10 - index) * 60_000).toISOString(),
      source: item.source ?? "synthetic",
      expectedUsername: item.expectedUsername ?? expectedUsername,
      observedUsername: item.observedUsername === undefined ? expectedUsername : item.observedUsername,
      stablePlatformUserId: item.stablePlatformUserId === undefined ? raw.stablePlatformUserId ?? null : item.stablePlatformUserId,
      profileRoute: item.profileRoute ?? null,
      runId: item.runId ?? `${prefix}-run-${index + 1}`,
      workerId: item.workerId ?? "fixture-worker-a",
      confidence: item.confidence ?? "medium",
      verifiedBadge: item.verifiedBadge ?? false,
      followersSurface: item.followersSurface ?? "normal",
      networkHealthy: item.networkHealthy ?? true,
      sessionHealthy: item.sessionHealthy ?? true,
      uiEvidenceQuality: item.uiEvidenceQuality ?? "high",
      reasonCodes: item.reasonCodes ?? [item.signal],
    });
  });
  if (raw.generatedObservationCount && observations.length) {
    const template = observations[0]!;
    for (let index = observations.length; index < raw.generatedObservationCount; index += 1) {
      observations.push(Object.freeze({
        ...template,
        observationId: `${prefix}-generated-${index + 1}`,
        idempotencyKey: `${prefix}-generated-key-${index + 1}`,
        observedAt: new Date(baseTime - (raw.generatedObservationCount - index) * 1_000).toISOString(),
        runId: `${prefix}-run-${Math.floor(index / 10) + 1}`,
      }));
    }
  }
  return Object.freeze({
    name: raw.name,
    scope,
    expectedUsername,
    stablePlatformUserId: raw.stablePlatformUserId ?? null,
    calculatedAt,
    observations: Object.freeze(observations),
    generatedObservationCount: raw.generatedObservationCount,
    resumeAfter: raw.resumeAfter,
    expected: raw.expected,
  });
}

export async function loadReplayFixtures(path: string): Promise<readonly ReplayFixture[]> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as RawFixtureFile;
  if (!parsed.defaults || !Array.isArray(parsed.fixtures)) throw new Error("target_availability_fixture_file_invalid");
  return Object.freeze(parsed.fixtures.map((fixture) => normalizeFixture(fixture, parsed.defaults)));
}

export function replayTargetAvailability(fixture: ReplayFixture): ReplayReport {
  const totalStart = performance.now();
  const prechecked = orderAndValidateObservations(fixture.scope, fixture.observations);
  const identityStart = performance.now();
  const split = Math.max(0, Math.min(fixture.resumeAfter ?? 0, prechecked.accepted.length));
  const prefix = split ? prechecked.accepted.slice(0, split) : [];
  const suffix = split ? prechecked.accepted.slice(split) : prechecked.accepted;
  const firstIdentity = prefix.length ? resolveTargetIdentity({
    scope: fixture.scope,
    expectedUsername: fixture.expectedUsername,
    stablePlatformUserId: fixture.stablePlatformUserId,
    observations: prefix,
    calculatedAt: fixture.calculatedAt,
  }) : null;
  const finalIdentity = resolveTargetIdentity({
    scope: fixture.scope,
    expectedUsername: fixture.expectedUsername,
    stablePlatformUserId: fixture.stablePlatformUserId,
    previousCurrent: firstIdentity?.current ?? null,
    observations: suffix,
    calculatedAt: fixture.calculatedAt,
  });
  const identityMs = performance.now() - identityStart;

  const assessmentStart = performance.now();
  const assessed = assessAvailability({
    scope: fixture.scope,
    identity: finalIdentity.current,
    observations: prechecked.accepted,
    assessedAt: fixture.calculatedAt,
  });
  const assessmentMs = performance.now() - assessmentStart;

  const currentStart = performance.now();
  const projected = projectAvailabilityCurrent({ scope: fixture.scope, previous: null, assessment: assessed.assessment });
  const idempotentProjection = projectAvailabilityCurrent({ scope: fixture.scope, previous: projected.current, assessment: assessed.assessment });
  const currentMs = performance.now() - currentStart;

  const violations: string[] = [];
  const expected = fixture.expected;
  const actualAccepted = prechecked.accepted.length;
  const actualRejected = prechecked.rejected.length;
  const actualDeduplicated = prechecked.duplicateIds.length;
  if (expected.identityStatus && finalIdentity.current.identityStatus !== expected.identityStatus) violations.push(`identity:${finalIdentity.current.identityStatus}!=${expected.identityStatus}`);
  if (expected.assessmentStatus && assessed.assessment.status !== expected.assessmentStatus) violations.push(`assessment:${assessed.assessment.status}!=${expected.assessmentStatus}`);
  if (expected.currentStatus && projected.current?.availabilityStatus !== expected.currentStatus) violations.push(`current:${projected.current?.availabilityStatus ?? "null"}!=${expected.currentStatus}`);
  if (expected.acceptedCount !== undefined && actualAccepted !== expected.acceptedCount) violations.push(`accepted:${actualAccepted}!=${expected.acceptedCount}`);
  if (expected.rejectedCount !== undefined && actualRejected !== expected.rejectedCount) violations.push(`rejected:${actualRejected}!=${expected.rejectedCount}`);
  if (expected.deduplicatedCount !== undefined && actualDeduplicated !== expected.deduplicatedCount) violations.push(`deduplicated:${actualDeduplicated}!=${expected.deduplicatedCount}`);
  if (idempotentProjection.outcome !== "unchanged") violations.push(`current_retry:${idempotentProjection.outcome}!=unchanged`);
  const totalMs = performance.now() - totalStart;
  const allEvents = [
    ...(firstIdentity?.observability ?? []),
    ...finalIdentity.observability,
    ...assessed.events,
    ...projected.events,
    ...violations.map((reason) => event(fixture.scope, "invariant_violation", fixture.calculatedAt, reason)),
    event(fixture.scope, "replay_completed", fixture.calculatedAt, violations.length ? "with_invariant_violations" : "ok", assessed.assessment.assessmentId),
  ];
  return Object.freeze({
    fixtureName: fixture.name,
    inputs: fixture.observations.length,
    eventsAccepted: actualAccepted,
    eventsRejected: actualRejected,
    deduplicatedEvents: actualDeduplicated,
    generatedTransitions: (firstIdentity?.history.length ?? 0) + finalIdentity.history.length,
    finalIdentity: finalIdentity.current,
    generatedAssessments: Object.freeze([assessed.assessment]),
    finalAvailabilityCurrent: projected.current,
    invariantViolations: Object.freeze(violations),
    timingMs: Object.freeze({ total: totalMs, identity: identityMs, assessment: assessmentMs, current: currentMs }),
    events: Object.freeze(allEvents),
  });
}
