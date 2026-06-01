import assert from "node:assert/strict";
import test from "node:test";
import {
  FOLLOW_SOURCE_ROTATION_BOUNDS,
  FOLLOW_SOURCE_ROTATION_DEFAULTS,
  followSourceRotationChangedFields,
  redactedFollowSourceRotationSummary,
  validateFollowSourceRotationInteger,
} from "../lib/instagram-dashboard/follow-source-settings.ts";

test("follow source rotation defaults stay conservative", () => {
  assert.equal(FOLLOW_SOURCE_ROTATION_DEFAULTS.max_follows_per_target_per_run, 2);
  assert.equal(FOLLOW_SOURCE_ROTATION_DEFAULTS.max_targets_per_run, 3);
});

test("follow source rotation bounds allow controlled production candidates", () => {
  assert.deepEqual(FOLLOW_SOURCE_ROTATION_BOUNDS.max_follows_per_target_per_run, { min: 1, max: 50 });
  assert.deepEqual(FOLLOW_SOURCE_ROTATION_BOUNDS.max_targets_per_run, { min: 1, max: 10 });
  assert.deepEqual(
    validateFollowSourceRotationInteger(30, "max_follows_per_target_per_run"),
    { value: 30, error: "" },
  );
  assert.deepEqual(
    validateFollowSourceRotationInteger(4, "max_targets_per_run"),
    { value: 4, error: "" },
  );
});

test("follow source rotation validation rejects invalid values without clamping", () => {
  assert.equal(
    validateFollowSourceRotationInteger(0, "max_follows_per_target_per_run").error,
    "max_follows_per_target_per_run_out_of_bounds_1_50",
  );
  assert.equal(
    validateFollowSourceRotationInteger(51, "max_follows_per_target_per_run").error,
    "max_follows_per_target_per_run_out_of_bounds_1_50",
  );
  assert.equal(
    validateFollowSourceRotationInteger(11, "max_targets_per_run").error,
    "max_targets_per_run_out_of_bounds_1_10",
  );
});

test("follow source rotation audit summary is safe", () => {
  assert.deepEqual(
    followSourceRotationChangedFields(
      { max_follows_per_target_per_run: 2, max_targets_per_run: 3 },
      { max_follows_per_target_per_run: 30, max_targets_per_run: 4 },
    ),
    ["max_follows_per_target_per_run", "max_targets_per_run"],
  );
  assert.deepEqual(
    redactedFollowSourceRotationSummary({
      max_follows_per_target_per_run: 30,
      max_targets_per_run: 4,
      source: "account_setting",
    }),
    {
      max_follows_per_target_per_run: 30,
      max_targets_per_run: 4,
      source: "account_setting",
    },
  );
});
