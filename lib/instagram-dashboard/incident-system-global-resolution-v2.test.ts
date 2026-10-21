import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { operationalBlockerFromCanonicalIncident } from "./operational-blocker.ts";

const snapshot = JSON.parse(readFileSync(new URL("./incident-system-approved-labels-v2.json", import.meta.url), "utf8"));

test("approved canonical labels across all inventoried incident types do not drift silently", () => {
  assert.equal(Object.keys(snapshot.canonical_blocker_labels).length, 32);
  for (const [incident_type, label] of Object.entries(snapshot.canonical_blocker_labels)) {
    const blocker = operationalBlockerFromCanonicalIncident({
      incident_id: "synthetic-incident", incident_type, reason_code: incident_type, severity: "error",
    });
    assert.equal(blocker?.label, label, incident_type);
  }
});

test("only the approved timed families render the expiry in the business calendar", () => {
  assert.equal(snapshot.operator_approved_timed_label, "Pause until YYYY-MM-DD");
  assert.deepEqual(snapshot.timed_reasons, ["instagram_action_rate_limit", "preventive_follow_restriction"]);
  for (const reason_code of snapshot.timed_reasons) {
    const blocker = operationalBlockerFromCanonicalIncident({
      incident_id: "synthetic-timed", incident_type: "instagram_account_restriction", reason_code,
      severity: "error", not_before: "2026-09-15T23:30:00Z",
    });
    assert.equal(blocker?.label, "Pause until 2026-09-16");
    assert.equal(blocker?.notBefore, "2026-09-15T23:30:00Z");
  }
});
