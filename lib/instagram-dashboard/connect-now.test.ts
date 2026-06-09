import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./connect-now.ts", import.meta.url), "utf8");

test("connect only maps connecting when request is active", () => {
  assert.match(source, /const requestActive = isActiveRunRequestStatus\(readiness\.run_request_status\)/);
  assert.match(source, /const requestQueued = \(readiness\.preflight_request_created === true \|\| idempotent\) && requestActive/);
  assert.match(source, /status = requestQueued \|\| \(idempotent && requestActive\) \? "connecting" : "try_again_later"/);
});

test("connect exposes retry message for stale failed preflight", () => {
  assert.match(source, /login_preflight_request_not_active/);
  assert.match(source, /La connexion précédente a échoué ou expiré/);
});

test("connect never treats inactive request as queued", () => {
  assert.match(source, /ACTIVE_RUN_REQUEST_STATUSES = \["queued", "claimed", "starting", "running"\]/);
  assert.doesNotMatch(source, /request_queued: readiness\.preflight_request_created === true;/);
});
