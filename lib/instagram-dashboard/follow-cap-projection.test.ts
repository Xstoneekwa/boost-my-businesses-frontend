import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectFollowCaps } from "./follow-cap-projection.ts";

test("warmup limits daily cap while session also respects remaining", () => {
  const result = projectFollowCaps({
    packageDayCap: 120,
    packageSessionCap: 120,
    adminDayCap: null,
    adminSessionCap: null,
    warmupApplied: true,
    warmupDayCap: 20,
    followedToday: 5,
  });
  assert.equal(result.effectiveDayCap, 20);
  assert.equal(result.dailyRemaining, 15);
  assert.equal(result.effectiveSessionCap, 15);
  assert.equal(result.dailySource, "warmup");
});

test("session override never becomes the daily limiting source", () => {
  const result = projectFollowCaps({
    packageDayCap: 120,
    packageSessionCap: 120,
    adminDayCap: null,
    adminSessionCap: 10,
    warmupApplied: false,
    warmupDayCap: null,
    followedToday: 0,
  });
  assert.equal(result.effectiveDayCap, 120);
  assert.equal(result.dailySource, "package_default");
  assert.equal(result.effectiveSessionCap, 10);
  assert.equal(result.sessionSource, "admin_override");
});

test("Profiles reads persisted admin cap columns as canonical aliases", () => {
  const source = readFileSync(
    new URL("../../app/api/instagram-dashboard/profiles/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /\["manual_follow_day_cap", "max_actions_per_day"\]/);
  assert.match(source, /\["manual_follow_session_cap", "follow_limit"\]/);
});
