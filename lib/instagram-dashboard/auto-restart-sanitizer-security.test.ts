import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeTickFailureReason } from "./auto-restart-tick-helpers.ts";

for (const reason of [
  "resume_plan_lineage_mismatch",
  "canonical_resume_lineage_missing",
  "restriction_preflight_not_authorized",
]) {
  test(`preserves explicitly recognized reason ${reason}`, () => {
    assert.equal(sanitizeTickFailureReason(reason), reason);
  });
}

for (const secret of [
  "account_token_synthetic123",
  "account_token_0123456789abcdef0123456789abcdef",
  "access_token=shortSecret",
  "refresh_token=shortSecret",
  "Bearer shortSecret",
  "worker_secret_0123456789abcdef0123456789abcdef",
  "session_secret=shortSecret",
  'authorization="two secret words"',
  "unknown_0123456789abcdef0123456789abcdef",
]) {
  test(`redacts synthetic sensitive material (${secret.split(/[=_ ]/)[0]})`, () => {
    const result = sanitizeTickFailureReason(secret);
    assert.match(result, /\[redacted\]/);
    assert.doesNotMatch(result, /shortSecret|synthetic123|0123456789abcdef|two secret words/);
    const mixed = sanitizeTickFailureReason(`resume_plan_lineage_mismatch ${secret}`);
    assert.match(mixed, /^resume_plan_lineage_mismatch /);
    assert.match(mixed, /\[redacted\]/);
    assert.doesNotMatch(mixed, /shortSecret|synthetic123|0123456789abcdef|two secret words/);
  });
}
