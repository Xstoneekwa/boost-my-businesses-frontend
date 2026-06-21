import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  AUDIT_SQL_FILES,
  findAuditSqlViolations,
  validateAuditSqlContent,
} from "./validate-audit-sql.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

function readSql(name) {
  return readFileSync(join(ROOT, name), "utf8");
}

const VALID_CATALOG_SNIPPET = `
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '3s';
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
ROLLBACK;
`;

describe("validate-audit-sql production files", () => {
  for (const file of [
  ...AUDIT_SQL_FILES,
  "audit-minimal-baseline-contract.sql",
  "audit-minimal-trigger-functions.sql",
  "audit-minimal-extension-usage.sql",
]) {
    it(`${file} passes static validation`, () => {
      validateAuditSqlContent(readSql(file), file);
    });

    it(`${file} begins READ ONLY transaction and ends with ROLLBACK`, () => {
      const sql = readSql(file);
      assert.match(sql, /\bBEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/i);
      assert.match(sql, /\bROLLBACK\s*;/i);
    });
  }
});

describe("validate-audit-sql forbidden patterns", () => {
  it("refuses COMMIT", () => {
    const sql = `${VALID_CATALOG_SNIPPET.replace("ROLLBACK;", "COMMIT;")}`;
    assert.ok(findAuditSqlViolations(sql).some((v) => v.id === "commit"));
  });

  it("refuses SELECT * FROM public.clients", () => {
    const sql = `
BEGIN TRANSACTION READ ONLY;
SELECT * FROM public.clients;
ROLLBACK;
`;
    const violations = findAuditSqlViolations(sql);
    assert.ok(violations.some((v) => v.id === "select_star"));
    assert.ok(violations.some((v) => v.id === "from_public_table"));
  });

  it("refuses SELECT FROM auth.users", () => {
    const sql = `
BEGIN TRANSACTION READ ONLY;
SELECT id FROM auth.users;
ROLLBACK;
`;
    assert.ok(findAuditSqlViolations(sql).some((v) => v.id === "from_auth_users"));
  });

  it("refuses pg_get_functiondef and prosrc", () => {
    const withDef = `
BEGIN TRANSACTION READ ONLY;
SELECT pg_get_functiondef(1);
ROLLBACK;
`;
    assert.ok(findAuditSqlViolations(withDef).some((v) => v.id === "pg_get_functiondef"));

    const withProsrc = `
BEGIN TRANSACTION READ ONLY;
SELECT prosrc FROM pg_proc;
ROLLBACK;
`;
    assert.ok(findAuditSqlViolations(withProsrc).some((v) => v.id === "prosrc"));
  });

  it("accepts a valid catalogue-only query", () => {
    assert.doesNotThrow(() => validateAuditSqlContent(VALID_CATALOG_SNIPPET, "fixture"));
  });
});
