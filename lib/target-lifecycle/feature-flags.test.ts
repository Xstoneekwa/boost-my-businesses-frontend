import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveTargetAvailabilityFeatureFlags,
  targetAvailabilityFlagAllows,
  type TargetAvailabilityFeatureFlags,
} from "./feature-flags.ts";

const ACCOUNT_ONE = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_TWO = "22222222-2222-4222-8222-222222222222";

const flagKeys = [
  "target_availability_observation_capture_enabled",
  "target_availability_writer_enabled",
  "target_availability_shadow_enabled",
  "target_availability_policy_shadow_enabled",
] as const;

const envKeys = [
  "TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED",
  "TARGET_AVAILABILITY_WRITER_ENABLED",
  "TARGET_AVAILABILITY_SHADOW_ENABLED",
  "TARGET_AVAILABILITY_POLICY_SHADOW_ENABLED",
] as const;

const allows = (
  values: Readonly<Record<string, unknown>> | null | undefined,
  accountId = ACCOUNT_ONE,
  flag = flagKeys[0],
) => targetAvailabilityFlagAllows(resolveTargetAvailabilityFeatureFlags(values), flag, accountId);

test("flag absent and allowlist absent stays OFF", () => {
  assert.equal(allows({}), false);
});

test("boolean false stays OFF even for an allowlisted account", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: false,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: ACCOUNT_ONE,
  }), false);
});

test("string false stays OFF even for an allowlisted account", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: "false",
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: ACCOUNT_ONE,
  }), false);
});

test("canonical regression: flag true without an allowlist stays OFF", () => {
  assert.equal(allows({ TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true }), false);
});

test("flag true with an empty allowlist stays OFF", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: "",
  }), false);
});

test("flag true with a whitespace-only allowlist stays OFF", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: "   ",
  }), false);
});

test("an invalid separator invalidates the complete allowlist", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: `${ACCOUNT_ONE};${ACCOUNT_TWO}`,
  }), false);
});

test("an account absent from the allowlist stays OFF", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: ACCOUNT_TWO,
  }), false);
});

test("an explicitly allowlisted account is ON for the selected flag only", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: ACCOUNT_ONE,
  }), true);
});

test("a same-username hint cannot bypass account_id scope", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: ACCOUNT_TWO,
    TARGET_AVAILABILITY_USERNAME_ALLOWLIST: "same.username",
  }), false);
});

test("the kill switch overrides a valid flag and allowlist", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_KILL_SWITCH: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: ACCOUNT_ONE,
  }), false);
});

test("an absent configuration source stays OFF", () => {
  assert.equal(allows(undefined), false);
  assert.equal(allows(null), false);
});

test("an unreadable configuration source fails closed", () => {
  const unreadable = new Proxy({}, {
    get() { throw new Error("configuration_unreadable"); },
  });
  assert.equal(allows(unreadable), false);
});

test("malformed JSON allowlist fails closed", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: `["${ACCOUNT_ONE}"`,
  }), false);
});

test("duplicate allowlist entries normalize deterministically", () => {
  const flags = resolveTargetAvailabilityFeatureFlags({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: `${ACCOUNT_ONE}, ${ACCOUNT_ONE}`,
  });
  assert.deepEqual(flags.accountAllowlist, [ACCOUNT_ONE]);
  assert.equal(targetAvailabilityFlagAllows(flags, flagKeys[0], ACCOUNT_ONE), true);
});

test("case and surrounding spaces normalize deterministically", () => {
  const upper = ACCOUNT_ONE.toUpperCase();
  const flags = resolveTargetAvailabilityFeatureFlags({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: " TRUE ",
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: ` ${upper} `,
  });
  assert.deepEqual(flags.accountAllowlist, [ACCOUNT_ONE]);
  assert.equal(targetAvailabilityFlagAllows(flags, flagKeys[0], ` ${upper} `), true);
});

test("wildcards are never valid account identifiers", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: "*",
  }), false);
});

test("Premium metadata cannot enable an account without an allowlist", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    PACKAGE: "premium",
    ENTITLEMENT: "premium",
  }), false);
});

test("all four flags independently require the explicit allowlist", async (t) => {
  for (let index = 0; index < flagKeys.length; index += 1) {
    await t.test(flagKeys[index], () => {
      const values = {
        [envKeys[index]]: true,
        TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: ACCOUNT_ONE,
      };
      const flags = resolveTargetAvailabilityFeatureFlags(values);

      for (const flag of flagKeys) {
        assert.equal(
          targetAvailabilityFlagAllows(flags, flag, ACCOUNT_ONE),
          flag === flagKeys[index],
        );
      }
    });
  }
});

test("one enabled flag cannot activate another flag", () => {
  const flags: TargetAvailabilityFeatureFlags = resolveTargetAvailabilityFeatureFlags({
    TARGET_AVAILABILITY_WRITER_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: ACCOUNT_ONE,
  });
  assert.equal(targetAvailabilityFlagAllows(flags, flagKeys[1], ACCOUNT_ONE), true);
  assert.equal(targetAvailabilityFlagAllows(flags, flagKeys[0], ACCOUNT_ONE), false);
  assert.equal(targetAvailabilityFlagAllows(flags, flagKeys[2], ACCOUNT_ONE), false);
  assert.equal(targetAvailabilityFlagAllows(flags, flagKeys[3], ACCOUNT_ONE), false);
});

test("a partial or non-normalizable account configuration fails closed", () => {
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: `${ACCOUNT_ONE},not-an-account-id`,
  }), false);
  assert.equal(allows({
    TARGET_AVAILABILITY_OBSERVATION_CAPTURE_ENABLED: true,
    TARGET_AVAILABILITY_ACCOUNT_ALLOWLIST: ACCOUNT_ONE,
  }, "not-an-account-id"), false);
});
