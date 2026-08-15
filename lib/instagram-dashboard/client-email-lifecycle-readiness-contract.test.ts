import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readinessSource = readFileSync(
  new URL("./client-email-lifecycle-readiness.ts", import.meta.url),
  "utf8",
);

test("readiness uses canonical scheduler health instead of historical disconnected placeholders", () => {
  assert.match(readinessSource, /loadClientEmailLifecycleSchedulerHealth/);
  assert.match(readinessSource, /schedulerHealth\.status !== "healthy"/);
  assert.match(readinessSource, /materializationBlockingReasons\.push\(schedulerHealth\.reason\)/);
  assert.match(readinessSource, /dispatchBlockingReasons\.push\(schedulerHealth\.reason\)/);
  assert.doesNotMatch(readinessSource, /materialize writer is not connected yet/);
  assert.doesNotMatch(readinessSource, /scheduler is not connected yet/);
  assert.doesNotMatch(readinessSource, /production expects it closed until explicit GO/);
});

test("readiness still fails closed when the canonical provider gate is closed", () => {
  assert.match(readinessSource, /evaluateClientEmailSendingGate/);
  assert.match(readinessSource, /if \(!sendingGate\.allowed\)/);
  assert.match(readinessSource, /dispatchBlockingReasons\.push\(sendingGate\.message\)/);
});
