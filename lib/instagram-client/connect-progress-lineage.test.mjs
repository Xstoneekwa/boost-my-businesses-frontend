import assert from "node:assert/strict";
import test from "node:test";

import {
  hasCanonicalClientConnectLineage,
  isExplicitTerminalClientConnectProgress,
  reconcileClientConnectProgressLineage,
} from "./connect-operation-state.ts";

function snapshot(status, overrides = {}) {
  return {
    account_id: "account-1",
    connect_status: status,
    message: status,
    request_id: "request-1",
    request_status: "running",
    run_status: "running",
    verification: { required: false, code_submitted: false, challenge_status: null },
    action_required: null,
    steps: [],
    connected: status === "connected",
    failed: status === "failed" || status === "blocked",
    generated_at: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

test("queued worker start and challenge keep the canonical modal lineage", () => {
  for (const status of ["queued", "running", "verification_required", "verification_resume_active"]) {
    const incoming = snapshot(status);
    assert.equal(reconcileClientConnectProgressLineage({ previous: null, incoming }), incoming);
  }
});

test("one missing active projection retains the last canonical snapshot", () => {
  const previous = snapshot("running");
  const missing = snapshot("not_created", {
    request_id: null,
    request_status: null,
    run_status: null,
  });
  assert.equal(
    reconcileClientConnectProgressLineage({ previous, incoming: missing }),
    previous,
  );
});

test("operation token retains lineage while the first projection is absent", () => {
  const missing = snapshot("not_created", { request_id: null, request_status: null, run_status: null });
  assert.equal(hasCanonicalClientConnectLineage(missing, "signed-operation-token"), true);
  assert.equal(
    reconcileClientConnectProgressLineage({ previous: null, incoming: missing, operationToken: "signed-operation-token" }),
    null,
  );
});

test("explicit success failure cancellation and operator block replace transient state", () => {
  const previous = snapshot("running");
  for (const status of ["connected", "failed", "cancelled", "blocked"]) {
    const terminal = snapshot(status);
    assert.equal(isExplicitTerminalClientConnectProgress(terminal), true);
    assert.equal(reconcileClientConnectProgressLineage({ previous, incoming: terminal }), terminal);
  }
});
