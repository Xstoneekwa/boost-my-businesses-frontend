import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("stop never reports success from run id presence alone", () => {
  assert.doesNotMatch(source, /runStopped\s*\|\|\s*Boolean\(runId\)/);
  assert.match(source, /if \(runId && !runTerminalConfirmed\)/);
  assert.match(source, /run_terminalization_not_persisted/);
});

test("stop terminalizes the exact linked request after run confirmation", () => {
  assert.match(source, /\.from\("account_run_requests"\)[\s\S]*?status: "canceled"/);
  assert.match(source, /\.eq\("id", canceledRequestId\)/);
  assert.match(source, /request_terminalization_not_persisted/);
});

test("stop success response is backed by persisted terminal states", () => {
  assert.match(source, /stopped: runTerminalConfirmed/);
  assert.match(source, /canceled_request: requestTerminalConfirmed/);
});
