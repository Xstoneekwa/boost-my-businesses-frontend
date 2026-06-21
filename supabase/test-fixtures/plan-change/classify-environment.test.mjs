import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLASSIFICATION,
  classifyEnvironmentState,
  classificationLabel,
  INVENTORY_TABLES,
} from "./harness-contract.mjs";

function inventoryAllMissing() {
  return Object.fromEntries(INVENTORY_TABLES.map((table) => [table, { state: "missing" }]));
}

describe("classifyEnvironmentState", () => {
  it("classifies empty isolated test DB as D", () => {
    const verdict = classifyEnvironmentState({
      inventory: inventoryAllMissing(),
      isolation: { isolationInconclusive: true, isolationPass: false },
      fingerprint: { diffs: [] },
      ref: "nxntngkhkoynljcagmkq",
    });
    assert.equal(verdict, CLASSIFICATION.D);
    assert.equal(classificationLabel(verdict), "D — empty_baseline_test_database");
  });

  it("does not downgrade D when migration history would be inconclusive", () => {
    const verdict = classifyEnvironmentState({
      inventory: inventoryAllMissing(),
      isolation: { isolationInconclusive: true },
      fingerprint: { diffs: [] },
      ref: "nxntngkhkoynljcagmkq",
    });
    assert.equal(verdict, CLASSIFICATION.D);
  });

  it("classifies partial checkout as B", () => {
    const inventory = inventoryAllMissing();
    inventory.commercial_checkout_sessions = { state: "exists" };
    const verdict = classifyEnvironmentState({
      inventory,
      isolation: { isolationPass: false, isolationInconclusive: true },
      fingerprint: { diffs: [] },
      ref: "nxntngkhkoynljcagmkq",
    });
    assert.equal(verdict, CLASSIFICATION.B);
  });

  it("classifies inaccessible probe as C even on test ref", () => {
    const inventory = inventoryAllMissing();
    inventory.clients = { state: "inaccessible" };
    const verdict = classifyEnvironmentState({
      inventory,
      isolation: { isolationInconclusive: true },
      fingerprint: { diffs: [] },
      ref: "nxntngkhkoynljcagmkq",
    });
    assert.equal(verdict, CLASSIFICATION.C);
  });
});
