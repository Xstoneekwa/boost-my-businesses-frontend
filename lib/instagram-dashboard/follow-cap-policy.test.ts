import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultConfiguredWarmupCaps,
  mergeConfiguredWarmupCapFields,
  resolveEffectiveFollowCapsToday,
  resolvePackageFollowPolicy,
  validateConfiguredFollowCaps,
  validateConfiguredWarmupCaps,
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

test("custom warmup progression accepts 8 / 15 / 25 / 45", () => {
  const policy = resolvePackageFollowPolicy(
    { follow_day: 80, follow_session: 80 },
    { follow_day: 80, follow_session: 80 },
  );
  assert.deepEqual(validateConfiguredWarmupCaps({
    day1: 8,
    day2: 15,
    day3: 25,
    day4Plus: 45,
    packagePolicy: policy,
  }), { ok: true, day1: 8, day2: 15, day3: 25, day4Plus: 45 });
});

test("editing one warmup field preserves the other three persisted fields", () => {
  assert.deepEqual(mergeConfiguredWarmupCapFields({
    patch: { day_1_follow_cap: 8 },
    existing: {
      day_1_follow_cap: 10,
      day_2_follow_cap: 20,
      day_3_follow_cap: 40,
      day_4_plus_follow_cap: 80,
    },
    defaults: { day1: 10, day2: 20, day3: 40, day4Plus: 80 },
  }), { day1: 8, day2: 20, day3: 40, day4Plus: 80 });
});

test("warmup caps reject zero, decimals, package overflow and decreasing sequences", () => {
  const policy = resolvePackageFollowPolicy(
    { follow_day: 80, follow_session: 80 },
    { follow_day: 80, follow_session: 80 },
  );
  assert.equal(validateConfiguredWarmupCaps({ day1: 0, day2: 20, day3: 40, day4Plus: 80, packagePolicy: policy }).ok, false);
  assert.equal(validateConfiguredWarmupCaps({ day1: 10, day2: 20.5, day3: 40, day4Plus: 80, packagePolicy: policy }).ok, false);
  assert.deepEqual(validateConfiguredWarmupCaps({ day1: 10, day2: 20, day3: 40, day4Plus: 100, packagePolicy: policy }), {
    ok: false,
    code: "warmup_cap_exceeds_package",
    message: "Follow warmup caps cannot exceed the package maximum (80).",
  });
  assert.deepEqual(validateConfiguredWarmupCaps({ day1: 20, day2: 10, day3: 30, day4Plus: 40, packagePolicy: policy }), {
    ok: false,
    code: "warmup_progression_not_monotonic",
    message: "Follow warmup progression must satisfy Day 1 <= Day 2 <= Day 3 <= Day 4+.",
  });
});

test("warmup package maximum uses the lower day/session maximum", () => {
  const policy = resolvePackageFollowPolicy(
    { follow_day: 80, follow_session: 50 },
    { follow_day: 80, follow_session: 50 },
  );
  assert.deepEqual(defaultConfiguredWarmupCaps(policy!), {
    day1: 10,
    day2: 20,
    day3: 40,
    day4Plus: 50,
  });
  assert.equal(validateConfiguredWarmupCaps({ day1: 10, day2: 20, day3: 40, day4Plus: 51, packagePolicy: policy }).ok, false);
});

test("Profiles projects Day 1 10 as 10/day and 10/session", () => {
  assert.deepEqual(resolveEffectiveFollowCapsToday({
    packageDayCap: 80,
    packageSessionCap: 80,
    configuredAccountDayCap: 80,
    configuredAccountSessionCap: 80,
    warmupApplied: true,
    warmupCap: 10,
    followsCompletedToday: 0,
  }), { dayCap: 10, sessionCap: 10, remainingDayQuota: 10 });
});

test("Profiles projects custom Day 1 8 as 8/day and 8/session", () => {
  assert.deepEqual(resolveEffectiveFollowCapsToday({
    packageDayCap: 80,
    packageSessionCap: 80,
    configuredAccountDayCap: 80,
    configuredAccountSessionCap: 80,
    warmupApplied: true,
    warmupCap: 8,
    followsCompletedToday: 0,
  }), { dayCap: 8, sessionCap: 8, remainingDayQuota: 8 });
});

test("account session cap 30 limits warmup 10 / 20 / 40 / 80 to 10 / 20 / 30 / 30", () => {
  const projected = [10, 20, 40, 80].map((warmupCap) => resolveEffectiveFollowCapsToday({
    packageDayCap: 80,
    packageSessionCap: 80,
    configuredAccountDayCap: 80,
    configuredAccountSessionCap: 30,
    warmupApplied: true,
    warmupCap,
    followsCompletedToday: 0,
  }).sessionCap);
  assert.deepEqual(projected, [10, 20, 30, 30]);
});

test("Profiles session cap includes the remaining daily quota", () => {
  assert.deepEqual(resolveEffectiveFollowCapsToday({
    packageDayCap: 80,
    packageSessionCap: 80,
    configuredAccountDayCap: 70,
    configuredAccountSessionCap: 60,
    warmupApplied: true,
    warmupCap: 8,
    followsCompletedToday: 3,
  }), { dayCap: 8, sessionCap: 5, remainingDayQuota: 5 });
});
