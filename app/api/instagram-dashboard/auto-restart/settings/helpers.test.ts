import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAutoRestartPatch,
  validateAutoRestartPatch,
  type AutoRestartSettingsPatch,
} from "./helpers.ts";

test("empty and invalid JSON fallback preserve canonical Auto Restart defaults", () => {
  const patch = normalizeAutoRestartPatch({});
  assert.equal(patch.auto_restart_enabled, false);
  assert.equal(patch.mode, "production");
  assert.equal(patch.check_every_minutes, 20);
  assert.equal(patch.restart_delay_minutes, 20);
  assert.equal(patch.max_attempts_per_session, 3);
  assert.equal(patch.max_retries_after_initial_failure, 2);
  assert.equal(patch.resume_follow_if_quota_remaining, true);
  assert.equal(patch.resume_unfollow_if_quota_remaining, true);
});

test("valid, partial and boolean patches preserve existing-row fallbacks", () => {
  const patch = normalizeAutoRestartPatch({
    auto_restart_enabled: true,
    check_every_minutes: 45,
    restart_yellow_accounts: true,
    resume_follow_if_quota_remaining: false,
  }, {
    restart_delay_minutes: 31,
    max_retries_after_initial_failure: 4,
    respect_six_hour_window: false,
  });
  assert.equal(patch.auto_restart_enabled, true);
  assert.equal(patch.check_every_minutes, 45);
  assert.equal(patch.restart_delay_minutes, 31);
  assert.equal(patch.max_retries_after_initial_failure, 4);
  assert.equal(patch.restart_yellow_accounts, true);
  assert.equal(patch.resume_follow_if_quota_remaining, false);
  assert.equal(patch.respect_six_hour_window, false);
});

test("numeric limits, invalid values and unknown properties remain bounded and ignored", () => {
  const body = {
    check_every_minutes: -10,
    restart_delay_minutes: 5000,
    max_attempts_per_session: "invalid",
    max_retries_after_initial_failure: 99,
    max_restarts_per_day_per_account: -2,
    max_restarts_per_window_per_account: 100,
    phone_rest_max_session_minutes: 2000,
    phone_rest_min_rest_minutes: -1,
    unknown_property: "ignored",
  } as AutoRestartSettingsPatch & { unknown_property: string };
  const patch = normalizeAutoRestartPatch(body);
  assert.equal(patch.check_every_minutes, 1);
  assert.equal(patch.restart_delay_minutes, 1440);
  assert.equal(patch.max_attempts_per_session, 3);
  assert.equal(patch.max_retries_after_initial_failure, 20);
  assert.equal(patch.max_restarts_per_day_per_account, 0);
  assert.equal(patch.max_restarts_per_window_per_account, 50);
  assert.equal(patch.phone_rest_max_session_minutes, 1440);
  assert.equal(patch.phone_rest_min_rest_minutes, 0);
  assert.equal("unknown_property" in patch, false);
});

test("active settings validation remains fail-closed", () => {
  const patch = normalizeAutoRestartPatch({ auto_restart_enabled: true });
  assert.equal(validateAutoRestartPatch(patch, {
    ready: false,
    missing: ["auto_restart_settings"],
    settingsWritable: false,
  }), "auto_restart_foundation_not_deployed");

  const previousToken = process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN;
  delete process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN;
  try {
    assert.equal(validateAutoRestartPatch(patch, {
      ready: true,
      missing: [],
      settingsWritable: true,
    }), "production_mode_tick_token_not_configured");
  } finally {
    if (previousToken === undefined) delete process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN;
    else process.env.INSTAGRAM_AUTO_RESTART_TICK_TOKEN = previousToken;
  }
});
