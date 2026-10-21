import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_RATE_LIMIT_POLICY_SOURCE,
  isIncidentOnlyActionRateLimit,
  projectActionRateLimitPause,
} from "./action-rate-limit-policy.ts";

test("prospective V2 marker is required and historical incidents are not silently reclassified", () => {
  assert.equal(isIncidentOnlyActionRateLimit({ reason: "instagram_action_rate_limit", metadata: {} }), false);
  assert.equal(isIncidentOnlyActionRateLimit({
    reason: "instagram_action_rate_limit",
    metadata: { incident_only_blocker_v2: true },
  }), true);
});

test("client wording distinguishes BMB recommendation from Instagram expiry", () => {
  const fr = projectActionRateLimitPause({
    detected_at: "2026-08-29T11:14:55Z",
    recommended_pause_until: "2026-08-31T11:14:55Z",
    pause_policy_source: ACTION_RATE_LIMIT_POLICY_SOURCE,
    instagram_exact_expiry_provided: false,
  }, "fr");
  const en = projectActionRateLimitPause({}, "en");
  assert.equal(fr.label, "Pause de 48 h requise");
  assert.equal(en.label, "48h pause required");
  assert.equal(fr.instagramExactExpiryProvided, false);
  assert.match(fr.explanation, /BMB/);
});
