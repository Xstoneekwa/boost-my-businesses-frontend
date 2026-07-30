import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS,
  parseTargetAvailabilityRuntimeCaps,
  parseTargetAvailabilityRuntimeState,
  signalFromDatabaseObservation,
  targetAvailabilityRuntimeActive,
} from "./runtime-pipeline.ts";

const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

test("runtime defaults fail closed with bounded caps", () => {
  const state = parseTargetAvailabilityRuntimeState({});
  assert.equal(state.scopeMode, "off");
  assert.equal(targetAvailabilityRuntimeActive(state), false);
  assert.deepEqual(state.caps, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS);
});

test("global scope requires every producer and shadow but never policy shadow", () => {
  const state = parseTargetAvailabilityRuntimeState({
    capture_enabled: true,
    writer_enabled: true,
    identity_producer_enabled: true,
    assessment_producer_enabled: true,
    current_projector_enabled: true,
    shadow_enabled: true,
    scope_mode: "all_active_accounts",
    auto_killed: false,
    human_reenable_required: false,
  });
  assert.equal(targetAvailabilityRuntimeActive(state), true);
  assert.equal(state.explicitAccountAllowlist.length, 0);
});

test("explicit scope never interprets an empty or malformed allowlist as global", () => {
  const common = {
    capture_enabled: true,
    writer_enabled: true,
    identity_producer_enabled: true,
    assessment_producer_enabled: true,
    current_projector_enabled: true,
    shadow_enabled: true,
    scope_mode: "explicit_allowlist",
  };
  assert.equal(targetAvailabilityRuntimeActive(parseTargetAvailabilityRuntimeState(common)), false);
  assert.equal(targetAvailabilityRuntimeActive(parseTargetAvailabilityRuntimeState({
    ...common,
    explicit_account_allowlist: ["invalid"],
  })), false);
  assert.equal(targetAvailabilityRuntimeActive(parseTargetAvailabilityRuntimeState({
    ...common,
    explicit_account_allowlist: [ACCOUNT_ID],
  })), true);
});

test("invalid and oversized caps fall back instead of widening limits", () => {
  const caps = parseTargetAvailabilityRuntimeCaps({
    observations_per_run: 999_999,
    observations_per_account_day: -1,
    retries: 99,
    global_concurrency: 0,
  });
  assert.equal(caps.observationsPerRun, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.observationsPerRun);
  assert.equal(caps.observationsPerAccountDay, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.observationsPerAccountDay);
  assert.equal(caps.retries, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.retries);
  assert.equal(caps.globalConcurrency, DEFAULT_TARGET_AVAILABILITY_RUNTIME_CAPS.globalConcurrency);
});

test("verified badge alone is never a restriction proof", () => {
  assert.equal(signalFromDatabaseObservation({ verified_badge: true, followers_surface: "normal", profile_found: true }), "profile_available");
  assert.equal(signalFromDatabaseObservation({ verified_badge: true, followers_surface: "restricted" }), "verified_followers_restricted");
});

test("ambiguity and identity conflicts stay explicit", () => {
  assert.equal(signalFromDatabaseObservation({ reason_codes: ["target_identity_conflict"] }), "identity_conflict");
  assert.equal(signalFromDatabaseObservation({ navigation_timeout: true }), "temporary_instagram_error");
  assert.equal(signalFromDatabaseObservation({ reason_codes: ["target_ui_ambiguity"] }), "ui_inconsistency");
});
