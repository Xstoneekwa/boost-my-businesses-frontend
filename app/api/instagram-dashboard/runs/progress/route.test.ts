import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const progressRouteSource = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("progress route does not infer connected from request completion alone", () => {
  assert.doesNotMatch(progressRouteSource, /requestStatus === "completed"\) return "connected"/);
  assert.match(progressRouteSource, /return runRow \? "completed" : "run_link_missing"/);
  assert.match(progressRouteSource, /Worker finished but did not link a run or publish terminal login evidence/);
});

test("progress route can use safe login provisioner evidence for app-open state", () => {
  assert.match(progressRouteSource, /readLoginProvisionerSummary/);
  assert.match(progressRouteSource, /app_start_ok/);
  assert.match(progressRouteSource, /Instagram package opened by login worker/);
  assert.match(progressRouteSource, /Worker connected locally but did not publish account status/);
  assert.doesNotMatch(progressRouteSource, /secret_ref/i);
});
