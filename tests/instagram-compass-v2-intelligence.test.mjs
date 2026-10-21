import assert from "node:assert/strict";
import test from "node:test";
import {
  assessRisk,
  buildSignalClusters,
  correlateFleet,
  deduplicateSignals,
  prepareFleetHandoff,
  recommend,
  validateExternalSignal,
} from "../lib/instagram-dashboard/compass-v2.ts";

const NOW = "2026-09-09T12:00:00.000Z";

function signal(id, overrides = {}) {
  const source = overrides.source ?? "reddit";
  return {
    id, source, source_native_id: id, url: `https://${source === "meta" ? "metastatus.com" : source === "reddit" ? "www.reddit.com" : source}/${id}`,
    retrieved_at: NOW, published_at: "2026-09-09T11:30:00.000Z",
    publication_date_confidence: "HIGH", first_seen: "2026-09-09T11:30:00.000Z",
    last_seen: "2026-09-09T11:30:00.000Z", platform: "INSTAGRAM",
    signal_type: "USER_REPORT", action_family: "FOLLOW", symptom_family: "TRY_AGAIN_LATER",
    geography: null, platform_version: null, source_credibility: "MEDIUM", access_status: "LIMITED",
    freshness: "CURRENT", volume: 1, velocity: 0, official_confirmation: false,
    content_hash: `hash-${id}`, dedupe_key: `key-${id}`, cluster_id: null,
    exclusion_reason: [], raw_reference: `sha256:${id}`, author_key: `author-${id}`,
    source_family: source, summary: `I cannot follow and Instagram says try again later ${id}`,
    ...overrides,
  };
}

function incident(id, overrides = {}) {
  return {
    id, incident_type: "instagram_action_rate_limit", restriction_evidence: "confirmed_ui",
    reason_code: "FOLLOW_BLOCKED",
    account_id: `account-${id}`, occurred_at: "2026-09-09T11:40:00.000Z", occurrence_count: 1,
    severity: "error", ...overrides,
  };
}

function pipeline(signals, incidents = [], exposed = [], coverageDegraded = false) {
  const cluster = buildSignalClusters(signals, { now: NOW, coverageDegraded })[0];
  const correlation = correlateFleet(cluster, incidents, exposed);
  const risk = assessRisk(cluster, correlation);
  const recommendation = recommend(cluster, correlation, risk, NOW);
  return { cluster, correlation, risk, recommendation };
}

test("normalized contract fails closed on missing, malformed, and unsupported values", () => {
  assert.equal(validateExternalSignal(signal("valid")).platform, "INSTAGRAM");
  for (const invalid of [null, [], { ...signal("a"), platform: "TIKTOK" }, { ...signal("b"), volume: -1 }, { ...signal("c"), source_credibility: "TRUST_ME" }]) {
    assert.throws(() => validateExternalSignal(invalid));
  }
  const missing = signal("missing");
  delete missing.raw_reference;
  assert.throws(() => validateExternalSignal(missing), /MISSING_EXTERNAL_SIGNAL_FIELD:raw_reference/);
  assert.throws(() => validateExternalSignal(signal("fake-official", { official_confirmation: true })), /INVALID_OFFICIAL_CONFIRMATION/);
  assert.throws(() => validateExternalSignal(signal("blocked", { access_status: "BLOCKED" })), /BLOCKED_SOURCE_CANNOT_REPORT_SIGNAL/);
});

test("two-stage dedupe collapses exact records, crossposts and near copies", () => {
  const exact = { ...signal("exact-copy"), id: "different", url: signal("one").url, content_hash: signal("one").content_hash };
  const near = signal("near", { summary: "I cannot follow and Instagram says try again later one" });
  assert.equal(deduplicateSignals([signal("one"), exact, near]).length, 1);
  assert.equal(deduplicateSignals([signal("one"), signal("other", { action_family: "DM", symptom_family: "DM_RESTRICTED" })]).length, 2);
});

test("A external spike without internal impact remains MONITOR", () => {
  const result = pipeline([
    signal("a", { source_family: "reddit" }),
    signal("b", { source: "forum.example", source_family: "forum.example" }),
    signal("c", { source: "meta", source_family: "meta", source_credibility: "HIGH", signal_type: "OFFICIAL_STATUS", official_confirmation: true }),
  ]);
  assert.equal(result.cluster.state, "ACCELERATING");
  assert.equal(result.correlation.internal_evidence_strength, "NONE");
  assert.equal(result.recommendation.action, "MONITOR");
  assert.ok(result.risk.score <= 49);
});

test("B one preventive restriction without external support is isolated and unconfirmed", () => {
  const result = pipeline([signal("isolated",{action_family:"FOLLOW_REVERT",symptom_family:"FOLLOW_REVERT"})], [incident("p", {
    incident_type: "preventive_follow_restriction", restriction_evidence: "preventive",
  })]);
  assert.equal(result.cluster.state, "ISOLATED");
  assert.equal(result.correlation.internal_evidence_strength, "WEAK");
  assert.equal(result.correlation.confirmed_platform_rate_limit, false);
  assert.notEqual(result.recommendation.action, "PAUSE_SCOPE");
});

test("C external spike plus several confirmed UI incidents produces high correlation", () => {
  const result = pipeline([
    signal("a", { source_family: "reddit" }), signal("b", { source: "forum.example", source_family: "forum.example" }),
    signal("c", { source: "meta", source_family: "meta", source_credibility: "HIGH", signal_type: "OFFICIAL_STATUS", official_confirmation: true }),
  ], [incident("1"), incident("2"), incident("3")], ["account-1", "account-2", "account-3", "account-4"]);
  assert.equal(result.correlation.internal_evidence_strength, "CONFIRMED");
  assert.equal(result.correlation.confirmed_platform_rate_limit, true);
  assert.ok(["HIGH", "CRITICAL"].includes(result.risk.level));
  assert.ok(["REDUCE_ACTIVITY", "PAUSE_SELECTED"].includes(result.recommendation.action));
});

test("D stale duplicated chatter does not escalate", () => {
  const stale = signal("stale", { first_seen: "2026-09-07T10:00:00.000Z", last_seen: "2026-09-07T10:00:00.000Z", published_at: "2026-09-07T10:00:00.000Z" });
  const result = pipeline([stale, { ...stale, id: "copy" }]);
  assert.equal(result.cluster.unique_signal_count, 1);
  assert.equal(result.cluster.state, "RESOLVED");
  assert.equal(result.risk.level, "LOW");
});

test("E accelerating external cluster plus first confirmed match is an early warning", () => {
  const result = pipeline([signal("a"), signal("b", { source: "forum.example", source_family: "forum.example" }), signal("c")], [incident("one")]);
  assert.equal(result.cluster.state, "ACCELERATING");
  assert.equal(result.correlation.internal_evidence_strength, "CONFIRMED");
  assert.ok(result.risk.score >= 50);
});

test("F declining trend reduces risk and keeps recovery monitoring", () => {
  const signals = [
    signal("old1", { first_seen: "2026-09-09T03:00:00.000Z", last_seen: "2026-09-09T03:00:00.000Z", published_at: "2026-09-09T03:00:00.000Z" }),
    signal("old2", { first_seen: "2026-09-09T04:00:00.000Z", last_seen: "2026-09-09T04:00:00.000Z", published_at: "2026-09-09T04:00:00.000Z", source: "forum.example", source_family: "forum.example" }),
    signal("recent"),
  ];
  const result = pipeline(signals);
  assert.equal(result.cluster.state, "DECLINING");
  assert.equal(result.recommendation.action, "MONITOR");
});

test("G identical symptom outside the temporal window is a weak/no correlation", () => {
  const result = pipeline([signal("current")], [incident("old", { occurred_at: "2026-09-01T12:00:00.000Z" })]);
  assert.equal(result.correlation.matched_incidents.length, 0);
  assert.equal(result.correlation.internal_evidence_strength, "NONE");
});

test("H follow revert without confirmed UI is never a confirmed rate limit", () => {
  const result = pipeline([signal("follow",{action_family:"FOLLOW_REVERT",symptom_family:"FOLLOW_REVERT"})], [incident("revert", {
    incident_type: "preventive_follow_restriction", restriction_evidence: "preventive", occurrence_count: 3,
  })]);
  assert.equal(result.correlation.internal_evidence_strength, "STRONG");
  assert.equal(result.correlation.confirmed_platform_rate_limit, false);
});

test("degraded coverage caps confidence and distinguishes no data from no incident", () => {
  const result = pipeline([signal("limited")], [], [], true);
  assert.equal(result.cluster.coverage_status, "DEGRADED");
  assert.ok(result.risk.confidence <= 45);
  assert.equal(result.recommendation.action, "NEEDS_MORE_EVIDENCE");
});

test("Fleet handoff is immutable intent and cannot execute a mutation", () => {
  const result = pipeline([signal("a"), signal("b", { source: "forum.example", source_family: "forum.example" }), signal("c")], [incident("one")]);
  const handoff = prepareFleetHandoff(result.cluster, result.correlation, result.risk, result.recommendation, NOW);
  assert.equal(handoff.actions_executable, false);
  assert.equal(handoff.open_in_fleet, true);
  assert.deepEqual(handoff.fleet_flow, ["PREVIEW", "CONFIRMATION", "APPLY"]);
  assert.ok(handoff.idempotency_key.length === 64);
});

test("risk is deterministic and returns exact factor contributions", () => {
  const first = pipeline([signal("a"), signal("b", { source: "forum.example", source_family: "forum.example" })], [incident("one")]);
  const second = pipeline([signal("a"), signal("b", { source: "forum.example", source_family: "forum.example" })], [incident("one")]);
  assert.deepEqual(first.risk, second.risk);
  assert.deepEqual(Object.keys(first.risk.risk_factors).sort(), ["exposed_count", "external_credibility", "external_momentum", "freshness", "internal_affected_count", "internal_evidence", "recurrence", "severity"]);
});
