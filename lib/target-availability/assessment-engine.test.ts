import assert from "node:assert/strict";
import test from "node:test";
import { assessAvailability } from "./assessment-engine.ts";
import type { AvailabilityObservation, AvailabilityScope, AvailabilitySignal } from "./engine-types.ts";
import { resolveTargetIdentity } from "./identity-engine.ts";

const scope: AvailabilityScope = { tenantId: "tenant-a", accountId: "account-a", targetId: "target-a" };
const assessedAt = "2026-07-30T12:00:00.000Z";
const row = (id: string, signal: AvailabilitySignal, patch: Partial<AvailabilityObservation> = {}): AvailabilityObservation => ({
  ...scope,
  observationId: id,
  idempotencyKey: `assessment-key-${id}`,
  signal,
  observedAt: `2026-07-30T10:${String(Number(id.replace(/\D/g, "")) % 60).padStart(2, "0")}:00.000Z`,
  source: "synthetic",
  expectedUsername: "target.one",
  observedUsername: "target.one",
  runId: `run-${id}`,
  networkHealthy: true,
  sessionHealthy: true,
  uiEvidenceQuality: "high",
  followersSurface: "normal",
  ...patch,
});

const assess = (observations: readonly AvailabilityObservation[], stableId: string | null = null) => {
  const identity = resolveTargetIdentity({ scope, expectedUsername: "target.one", stablePlatformUserId: stableId, observations, calculatedAt: assessedAt }).current;
  return assessAvailability({ scope, identity, observations, assessedAt }).assessment;
};

test("all 19 canonical signals are accepted and serialize deterministically", () => {
  const signals: AvailabilitySignal[] = [
    "profile_available", "profile_unavailable", "account_deleted", "account_suspended", "account_banned",
    "username_changed", "username_change_suspected", "login_wall", "access_restricted", "verified_badge_present",
    "followers_surface_restricted", "verified_followers_restricted", "temporary_instagram_error", "network_error",
    "ui_inconsistency", "identity_conflict", "ambiguous_identity", "stale_observation", "insufficient_evidence",
  ];
  for (const [index, signal] of signals.entries()) {
    const observation = row(String(index + 1), signal);
    const first = assess([observation]);
    const second = assess([observation]);
    assert.deepEqual(first, second, signal);
    assert.doesNotThrow(() => JSON.stringify(first), signal);
  }
});

test("verified badge alone and restriction without badge never confirm verified restriction", () => {
  assert.notEqual(assess([row("01", "verified_badge_present", { verifiedBadge: true })]).status, "verified_restricted_confirmed");
  assert.notEqual(assess([
    row("02", "followers_surface_restricted", { followersSurface: "restricted" }),
    row("03", "followers_surface_restricted", { followersSurface: "restricted" }),
  ]).status, "verified_restricted_confirmed");
});

test("badge plus one restriction is suspected and repeated distinct runs confirm", () => {
  const badge = row("04", "verified_badge_present", { verifiedBadge: true });
  const one = row("05", "verified_followers_restricted", { verifiedBadge: true, followersSurface: "restricted" });
  assert.equal(assess([badge, one]).status, "verified_restricted_suspected");
  const two = row("06", "verified_followers_restricted", { verifiedBadge: true, followersSurface: "restricted" });
  assert.equal(assess([badge, one, two]).status, "verified_restricted_confirmed");
});

test("temporary errors never confirm permanent unavailability and later availability wins", () => {
  const error = row("07", "temporary_instagram_error", { observedAt: "2026-07-30T11:50:00.000Z" });
  assert.equal(assess([error]).status, "temporarily_unavailable");
  const recovered = row("08", "profile_available", { observedAt: "2026-07-30T11:55:00.000Z" });
  assert.equal(assess([error, recovered]).status, "available");
});

test("terminal signals require the documented repeat policy", () => {
  assert.equal(assess([row("09", "account_deleted")]).status, "unavailable_suspected");
  assert.equal(assess([row("10", "account_deleted"), row("11", "account_deleted")]).status, "unavailable_confirmed");
});

test("stable-id rename and identity conflict dominate availability", () => {
  const rename = row("12", "username_changed", { observedUsername: "new.name", stablePlatformUserId: "ig-100" });
  assert.equal(assess([rename], "ig-100").status, "identity_changed");
  const conflict = row("13", "identity_conflict", { stablePlatformUserId: "ig-200" });
  assert.equal(assess([conflict], "ig-100").status, "conflicting_evidence");
});

test("stale observations cannot remain authoritative", () => {
  const stale = row("14", "profile_available", { observedAt: "2026-06-01T00:00:00.000Z" });
  const output = assess([stale]);
  assert.equal(output.status, "stale");
  assert.equal(output.confidence, "unknown");
});

test("scope mismatch is rejected before assessment aggregation", () => {
  const foreign = row("15", "profile_available", { tenantId: "tenant-b" });
  const identity = resolveTargetIdentity({ scope, expectedUsername: "target.one", observations: [foreign], calculatedAt: assessedAt }).current;
  const output = assessAvailability({ scope, identity, observations: [foreign], assessedAt });
  assert.equal(output.assessment.status, "insufficient_evidence");
  assert.deepEqual(output.rejectedObservationIds, ["15"]);
});
