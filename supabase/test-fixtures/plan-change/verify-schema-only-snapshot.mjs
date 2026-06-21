#!/usr/bin/env node
/**
 * Validates a future schema-only snapshot before Plan Change test harness apply.
 * Read-only file checks — no DB access.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditExternalDependencies,
  auditManifestDependenciesDeclared,
  findForbiddenPlanChangeObjects,
  findForbiddenSecrets,
  findMissingRequiredTables,
} from "./snapshot-validation-rules.mjs";
import {
  assertSnapshotApplyAllowed,
  validateManifestCompleteInventory,
} from "./harness-manifest-contract.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(ROOT, "manifest.json");

function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

function fail(message) {
  console.error(`[verify-schema-only-snapshot] FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[verify-schema-only-snapshot] PASS: ${message}`);
}

function info(message) {
  console.log(`[verify-schema-only-snapshot] ${message}`);
}

function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

/**
 * @param {string} sql
 * @param {object} manifest
 * @param {{ skipManifestAudit?: boolean }} options
 */
export function validateSnapshotContent(sql, manifest, options = {}) {
  const secretViolations = findForbiddenSecrets(sql);
  if (secretViolations.length) {
    fail(`${secretViolations[0].message} (${secretViolations[0].id})`);
  }
  pass("No forbidden data/secrets detected (SQL roles in GRANT/REVOKE are allowed)");

  const planChangeObjects = findForbiddenPlanChangeObjects(sql);
  if (planChangeObjects.length) {
    const obj = planChangeObjects[0];
    fail(`Plan-change object must be absent before harness apply: ${obj.type} ${obj.name}`);
  }
  pass("Plan-change objects absent from snapshot (quotes, ledger, RPC)");

  const missingTables = findMissingRequiredTables(sql, manifest.requiredCheckoutObjects.tables);
  if (missingTables.length) {
    fail(`Required checkout/base table missing from snapshot DDL: ${missingTables[0]}`);
  }
  pass(`All ${manifest.requiredCheckoutObjects.tables.length} required tables present in snapshot DDL`);

  if (!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/im.test(sql)) {
    info("WARN: no ENABLE ROW LEVEL SECURITY found — future --phase=schema RLS validation may fail");
  } else {
    pass("RLS enable statements present in snapshot");
  }

  if (!/\bGRANT\b/im.test(sql) && !/\bREVOKE\b/im.test(sql)) {
    info("WARN: no GRANT/REVOKE found — ensure snapshot was generated without --no-privileges");
  } else {
    pass("GRANT/REVOKE statements present in snapshot");
  }

  if (!options.skipManifestAudit) {
    const manifestAuditIssues = auditManifestDependenciesDeclared(manifest.externalDependencies);
    if (manifestAuditIssues.length) {
      for (const issue of manifestAuditIssues) {
        fail(`BLOCKED: ${issue.detail} (${issue.kind}:${issue.name})`);
      }
    }

    const inventoryIssues = validateManifestCompleteInventory(manifest);
    for (const issue of inventoryIssues) {
      fail(`BLOCKED: ${issue.detail} (${issue.kind}:${issue.name})`);
    }

    const dependencyIssues = auditExternalDependencies(sql, manifest.externalDependencies);
    for (const issue of dependencyIssues) {
      fail(`BLOCKED: ${issue.detail} (${issue.kind}:${issue.name})`);
    }
    pass("External dependency declarations consistent with snapshot");
  }

  if (!/create\s+schema\s+public/im.test(sql) && !/SET\s+search_path\s*=\s*public/im.test(sql)) {
    info("WARN: explicit public schema marker not found — verify snapshot targets schema public");
  } else {
    pass("Snapshot references schema public");
  }
}

function verifyChecksum(sql, manifest) {
  const expected = manifest.snapshot?.sha256;
  if (!expected) {
    info("INCONCLUSIVE: manifest.snapshot.sha256 not set — checksum verification skipped until snapshot generated");
    return null;
  }
  const actual = createHash("sha256").update(sql, "utf8").digest("hex");
  if (actual !== expected) {
    fail(`Snapshot SHA-256 mismatch (expected manifest checksum, got ${actual.slice(0, 12)}...)`);
  }
  pass("Snapshot SHA-256 matches manifest");
  return actual;
}

function main() {
  const manifest = loadManifest();

  const applyGate = assertSnapshotApplyAllowed(manifest);
  if (!applyGate.ok) {
    fail(applyGate.message);
  }

  const snapshotArg = arg("snapshot") || join(ROOT, manifest.snapshot.relativePath);
  const snapshotPath = resolve(snapshotArg);

  if (!existsSync(snapshotPath)) {
    fail(`Snapshot file not found: ${snapshotPath} (generate after explicit GO)`);
  }

  info(`Validating snapshot: ${snapshotPath}`);
  const sql = readFileSync(snapshotPath, "utf8");
  if (!sql.trim()) {
    fail("Snapshot file is empty");
  }

  validateSnapshotContent(sql, manifest);
  const checksum = verifyChecksum(sql, manifest);

  console.log(
    JSON.stringify(
      {
        ok: true,
        snapshotPath,
        sha256: checksum,
        byteLength: Buffer.byteLength(sql, "utf8"),
        requiredTables: manifest.requiredCheckoutObjects.tables,
        forbiddenPlanChange: manifest.forbiddenBeforePlanChangeMigration,
        externalDependencies: manifest.externalDependencies,
      },
      null,
      2
    )
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
