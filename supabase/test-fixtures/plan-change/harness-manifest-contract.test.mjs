import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  AUDIT_STATUS,
  MINIMAL_PUBLIC_TABLES,
  REQUIRED_TRIGGER_FUNCTIONS,
  TRIGGER_FUNCTION_EVIDENCE,
  assertSnapshotApplyAllowed,
  auditManifestDependenciesDeclared,
  validateConfirmedCatalogEvidence,
  validateManifestCompleteInventory,
  validateManifestSchema,
} from "./harness-manifest-contract.mjs";
import { auditManifestDependenciesDeclared as snapshotAuditDeclared } from "./snapshot-validation-rules.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));

describe("harness-manifest-contract auditStatus", () => {
  it("pending blocks snapshot validation", () => {
    const issues = auditManifestDependenciesDeclared({
      auditStatus: AUDIT_STATUS.PENDING,
      extensions: null,
      schemas: null,
      functions: null,
      roles: null,
    });
    assert.ok(issues.some((i) => i.kind === "audit_pending"));
  });

  it("partial blocks snapshot validation", () => {
    const issues = auditManifestDependenciesDeclared({ auditStatus: AUDIT_STATUS.PARTIAL });
    assert.ok(issues.some((i) => i.kind === "audit_partial"));
    assert.ok(snapshotAuditDeclared({ auditStatus: AUDIT_STATUS.PARTIAL }).some((i) => i.kind === "audit_partial"));
  });

  it("complete passes auditStatus gate", () => {
    const issues = auditManifestDependenciesDeclared({ auditStatus: AUDIT_STATUS.COMPLETE });
    assert.deepEqual(issues, []);
  });
});

describe("harness-manifest-contract complete catalog evidence", () => {
  it("manifest auditStatus is complete", () => {
    assert.equal(MANIFEST.externalDependencies.auditStatus, AUDIT_STATUS.COMPLETE);
  });

  it("has exactly 10 public tables including ig_devices", () => {
    assert.deepEqual([...MANIFEST.confirmedCatalogEvidence.sourcePublicTables].sort(), [...MINIMAL_PUBLIC_TABLES].sort());
    assert.ok(MANIFEST.confirmedCatalogEvidence.sourcePublicTables.includes("ig_devices"));
  });

  it("auth.users is the only external dependency", () => {
    assert.deepEqual(MANIFEST.confirmedCatalogEvidence.externalTables, ["auth.users"]);
  });

  it("requires no extensions in scope", () => {
    assert.deepEqual(MANIFEST.externalDependencies.extensions, []);
    assert.deepEqual(MANIFEST.confirmedCatalogEvidence.extensionsRequiredByScope, []);
  });

  it("documents both required trigger functions with metadata", () => {
    assert.deepEqual(MANIFEST.externalDependencies.functions, REQUIRED_TRIGGER_FUNCTIONS);
    assert.deepEqual(
      MANIFEST.confirmedCatalogEvidence.triggerFunctions.map((fn) => fn.name).sort(),
      REQUIRED_TRIGGER_FUNCTIONS.sort()
    );
  });

  it("marks validate_client_subscription_type function config as snapshot fidelity requirement", () => {
    const fn = MANIFEST.confirmedCatalogEvidence.triggerFunctions.find(
      (row) => row.name === "validate_client_subscription_type"
    );
    assert.ok(fn);
    assert.equal(fn.hasFunctionConfig, true);
    assert.match(fn.snapshotFidelityRequirement, /preserve function configuration/i);
    const scopeFn = MANIFEST.minimalHarnessScope.find((row) => row.object === "validate_client_subscription_type");
    assert.equal(scopeFn.hasFunctionConfig, true);
    assert.ok(scopeFn.snapshotFidelityRequirement);
  });

  it("set_updated_at has no function config requirement", () => {
    const fn = MANIFEST.confirmedCatalogEvidence.triggerFunctions.find((row) => row.name === "set_updated_at");
    assert.ok(fn);
    assert.equal(fn.hasFunctionConfig, false);
    assert.equal(fn.securityDefiner, false);
  });

  it("excludes scheduler ig_accounts trigger", () => {
    const excluded = MANIFEST.confirmedCatalogEvidence.excludedTriggers.find(
      (row) => row.name === "ig_accounts_release_schedule_capacity_on_admin_lifecycle"
    );
    assert.ok(excluded);
    assert.equal(excluded.securityDefiner, true);
    assert.equal(excluded.timing, "AFTER UPDATE");
  });

  it("confirmed catalog evidence passes validation", () => {
    assert.deepEqual(validateConfirmedCatalogEvidence(MANIFEST.confirmedCatalogEvidence), []);
  });

  it("complete manifest inventory and evidence pass without gaps", () => {
    assert.deepEqual(validateManifestCompleteInventory(MANIFEST), []);
    assert.deepEqual(validateManifestSchema(MANIFEST), []);
    const gate = assertSnapshotApplyAllowed(MANIFEST);
    assert.equal(gate.ok, true);
  });

  it("partial manifest still blocks snapshot/apply", () => {
    const partialManifest = {
      ...MANIFEST,
      externalDependencies: { ...MANIFEST.externalDependencies, auditStatus: AUDIT_STATUS.PARTIAL },
    };
    const gate = assertSnapshotApplyAllowed(partialManifest);
    assert.equal(gate.ok, false);
  });

  it("trigger function evidence contract matches manifest", () => {
    for (const expected of TRIGGER_FUNCTION_EVIDENCE) {
      const found = MANIFEST.confirmedCatalogEvidence.triggerFunctions.find((fn) => fn.name === expected.name);
      assert.ok(found);
      assert.equal(found.language, expected.language);
      assert.equal(found.volatility, expected.volatility);
      assert.equal(found.securityDefiner, expected.securityDefiner);
      assert.equal(found.hasFunctionConfig, expected.hasFunctionConfig);
    }
  });
});
