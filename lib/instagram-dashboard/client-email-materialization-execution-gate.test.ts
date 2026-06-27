import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV,
  evaluateClientEmailMaterializationExecutionGate,
} from "./client-email-materialization-execution-gate.ts";

test("execution gate is closed when env var is absent", () => {
  const gate = evaluateClientEmailMaterializationExecutionGate({});
  assert.equal(gate.enabled, false);
  assert.equal(gate.reason, "unset");
});

test("execution gate is closed for false and non-exact values", () => {
  assert.deepEqual(evaluateClientEmailMaterializationExecutionGate({
    [CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV]: "false",
  }), { enabled: false, reason: "not_true" });
  assert.deepEqual(evaluateClientEmailMaterializationExecutionGate({
    [CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV]: "TRUE",
  }), { enabled: false, reason: "not_true" });
  assert.deepEqual(evaluateClientEmailMaterializationExecutionGate({
    [CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV]: "1",
  }), { enabled: false, reason: "not_true" });
  assert.deepEqual(evaluateClientEmailMaterializationExecutionGate({
    [CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV]: " yes ",
  }), { enabled: false, reason: "not_true" });
});

test("execution gate opens only for exact true string", () => {
  const gate = evaluateClientEmailMaterializationExecutionGate({
    [CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV]: "true",
  });
  assert.equal(gate.enabled, true);
  assert.equal(gate.reason, "enabled");
});

test("execution gate projection never exposes raw env value", () => {
  const gate = evaluateClientEmailMaterializationExecutionGate({
    [CLIENT_EMAIL_MATERIALIZE_ENABLED_ENV]: "super-secret-true",
  });
  assert.equal("CLIENT_EMAIL_MATERIALIZE_ENABLED" in gate, false);
  assert.equal(Object.keys(gate).sort().join(","), "enabled,reason");
});
