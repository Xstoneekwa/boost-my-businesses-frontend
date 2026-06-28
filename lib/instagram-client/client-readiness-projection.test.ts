import assert from "node:assert/strict";
import test from "node:test";

import {
  clientReadinessIsAutomaticPreparationInProgress,
  clientReadinessIsBlocked,
  clientReadinessMessage,
  projectClientReadinessStatus,
} from "./client-readiness-projection.ts";
import type { ReadinessNowResult } from "../instagram-dashboard/readiness-now.ts";

function readiness(overrides: Partial<ReadinessNowResult>): ReadinessNowResult {
  return {
    audience: "client",
    readiness_status: "waiting_scheduled_assignment",
    client_status: "waiting_next_slot",
    client_message: "",
    preflight_request_created: false,
    idempotent: false,
    next_action: "wait_for_scheduler_assignment",
    reason: "waiting_scheduled_assignment",
    blockers: ["missing_assignment"],
    ...overrides,
  };
}

test("missing assignment maps to preparation_pending", () => {
  const status = projectClientReadinessStatus(readiness({}));
  assert.equal(status, "preparation_pending");
  assert.match(clientReadinessMessage(status, "fr"), /préparons votre compte automatiquement/i);
});

test("ready_to_connect stays ready when assignment exists", () => {
  const status = projectClientReadinessStatus(readiness({
    readiness_status: "ready_to_connect",
    client_status: "ready_to_connect",
    reason: "readiness_passive_ready_to_connect",
    blockers: [],
    assignment_status: "ready",
  }));
  assert.equal(status, "ready_to_connect");
});

test("automatic preparation helper excludes blocked states", () => {
  assert.equal(clientReadinessIsAutomaticPreparationInProgress("preparation_pending"), true);
  assert.equal(clientReadinessIsAutomaticPreparationInProgress("secure_preparation_in_progress"), true);
  assert.equal(clientReadinessIsBlocked("preparation_blocked"), true);
  assert.equal(clientReadinessIsAutomaticPreparationInProgress("preparation_blocked"), false);
});
