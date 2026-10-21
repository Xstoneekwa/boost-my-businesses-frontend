import assert from "node:assert/strict";
import test from "node:test";
import { projectSocialProfileFollowerDelta3d as project } from "./social-profile-growth-projection.ts";

const row = (count, day, extra = {}) => ({ account_id: "fixture-account", username_normalized: "fixture", followers_count: count, following_count: 239, observed_at: `2026-08-${String(day).padStart(2, "0")}T12:00:00Z`, lookup_status: "found", source_provider: "searchapi", ...extra });
const initial = [row(10, 1), row(27, 4)];
const now = "2026-09-01T12:00:00Z";

test("last complete +17 survives missing, invalid and baseline-less observations", () => {
  for (const latest of [[], [row(80, 20)], [row(null, 7)], [row(-1, 7)], [row(200, 7, { lookup_status: "not_found" })], [row(200, 7, { observed_at: "invalid" })], [row(200, 7, { source_provider: "" })], [row(200, 7, { observed_at: "2099-01-01T00:00:00Z" })]]) {
    const result = project({ rows: [...initial, ...latest], now });
    assert.equal(result.value, 17);
    assert.equal(result.currentCapturedAt, initial[1].observed_at);
  }
});

test("a complete newer delta replaces +17 with negative, zero or positive", () => {
  for (const [count, expected] of [[13, -14], [27, 0], [47, 20]]) {
    const result = project({ rows: [...initial, row(count, 7)], now });
    assert.equal(result.value, expected);
  }
});

test("no history is null and cross-account inputs fail closed", () => {
  assert.equal(project({ rows: [], now }).value, null);
  assert.equal(project({ rows: [initial[0], row(27, 4, { account_id: "other" })], now }).value, null);
});
