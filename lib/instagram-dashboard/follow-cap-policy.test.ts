import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePackageFollowPolicy,
  validateConfiguredFollowCaps,
} from "./follow-cap-policy.ts";

const packages = [
  { code: "growth", day: 80, session: 80 },
  { code: "pro", day: 120, session: 120 },
  { code: "premium", day: 120, session: 120 },
  { code: "internal_test", day: 20, session: 20 },
] as const;

for (const packageRow of packages) {
  test(`${packageRow.code} resolves package defaults and maxima`, () => {
    const policy = resolvePackageFollowPolicy(
      { follow_day: packageRow.day, follow_session: packageRow.session },
      { follow_day: packageRow.day, follow_session: packageRow.session },
    );
    assert.deepEqual(policy, {
      defaultDayCap: packageRow.day,
      defaultSessionCap: packageRow.session,
      maxDayCap: packageRow.day,
      maxSessionCap: packageRow.session,
    });
  });

  test(`${packageRow.code} accepts lower values and rejects package overflow`, () => {
    const policy = resolvePackageFollowPolicy(
      { follow_day: packageRow.day, follow_session: packageRow.session },
      { follow_day: packageRow.day, follow_session: packageRow.session },
    );
    assert.equal(validateConfiguredFollowCaps({
      configuredDayCap: Math.max(1, packageRow.day - 1),
      configuredSessionCap: Math.max(1, packageRow.session - 1),
      packagePolicy: policy,
    }).ok, true);
    assert.equal(validateConfiguredFollowCaps({
      configuredDayCap: packageRow.day + 1,
      configuredSessionCap: packageRow.session,
      packagePolicy: policy,
    }).ok, false);
    assert.equal(validateConfiguredFollowCaps({
      configuredDayCap: packageRow.day,
      configuredSessionCap: packageRow.session + 1,
      packagePolicy: policy,
    }).ok, false);
  });
}

test("package defaults may be lower than package maxima", () => {
  assert.deepEqual(
    resolvePackageFollowPolicy(
      { follow_day: 50, follow_session: 30 },
      { follow_day: 80, follow_session: 80 },
    ),
    { defaultDayCap: 50, defaultSessionCap: 30, maxDayCap: 80, maxSessionCap: 80 },
  );
});

test("Outreach-only or missing package Follow policy fails closed", () => {
  const policy = resolvePackageFollowPolicy(
    { follow_day: null, follow_session: null },
    { follow_day: null, follow_session: null },
  );
  assert.equal(policy, null);
  assert.deepEqual(validateConfiguredFollowCaps({
    configuredDayCap: 1,
    configuredSessionCap: 1,
    packagePolicy: policy,
  }), {
    ok: false,
    code: "package_follow_policy_unavailable",
    message: "Cannot save Follow limits: the account has no active package Follow policy.",
  });
});

test("configured values must be positive integers", () => {
  const policy = resolvePackageFollowPolicy(
    { follow_day: 80, follow_session: 80 },
    { follow_day: 80, follow_session: 80 },
  );
  for (const invalid of [0, -1, 1.5, "invalid"]) {
    assert.equal(validateConfiguredFollowCaps({
      configuredDayCap: invalid,
      configuredSessionCap: 10,
      packagePolicy: policy,
    }).ok, false);
    assert.equal(validateConfiguredFollowCaps({
      configuredDayCap: 10,
      configuredSessionCap: invalid,
      packagePolicy: policy,
    }).ok, false);
  }
});
