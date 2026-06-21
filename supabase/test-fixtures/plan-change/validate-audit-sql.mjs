/**
 * Static validator for catalogue-only audit SQL files (no DB access).
 * Ensures read-only transaction envelope and metadata-only queries.
 */

import { readFileSync } from "node:fs";

/** @typedef {{ id: string, message: string, line?: number }} AuditSqlViolation */

const AUDIT_SQL_FILES = [
  "audit-reference-schema.sql",
  "audit-test-target.sql",
  "audit-minimal-baseline-contract.sql",
  "audit-minimal-trigger-functions.sql",
  "audit-minimal-extension-usage.sql",
];

const FORBIDDEN_RULES = [
  { id: "commit", pattern: /^\s*COMMIT\b/im, message: "COMMIT is forbidden — use ROLLBACK only" },
  {
    id: "mutating",
    pattern: /^\s*(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|COPY|GRANT|REVOKE)\b/im,
    message: "Mutating SQL statement forbidden",
  },
  {
    id: "read_write_tx",
    pattern: /\bSET\s+TRANSACTION\s+READ\s+WRITE\b/i,
    message: "SET TRANSACTION READ WRITE forbidden",
  },
  {
    id: "read_only_off",
    pattern: /\bdefault_transaction_read_only\s*=\s*off\b/i,
    message: "Disabling default_transaction_read_only forbidden",
  },
  {
    id: "from_public_table",
    pattern: /\bFROM\s+public\.\w+/i,
    message: "Direct read FROM public.<table> forbidden — use information_schema/pg_catalog",
  },
  {
    id: "join_public_table",
    pattern: /\bJOIN\s+public\.\w+/i,
    message: "Direct read JOIN public.<table> forbidden",
  },
  {
    id: "from_auth_users",
    pattern: /\bFROM\s+auth\.users\b/i,
    message: "Row read FROM auth.users forbidden",
  },
  {
    id: "from_storage",
    pattern: /\bFROM\s+storage\.\w+/i,
    message: "Read FROM storage.* forbidden",
  },
  { id: "select_star", pattern: /\bSELECT\s+\*/i, message: "SELECT * forbidden" },
  {
    id: "pg_get_functiondef",
    pattern: /\bpg_get_functiondef\s*\(/i,
    message: "pg_get_functiondef forbidden — metadata signatures only",
  },
  { id: "prosrc", pattern: /\bprosrc\b/i, message: "prosrc forbidden — no function bodies" },
  {
    id: "pg_get_viewdef",
    pattern: /\bpg_get_viewdef\s*\(/i,
    message: "pg_get_viewdef forbidden — no view definitions",
  },
  {
    id: "policy_body_columns",
    pattern: /\bSELECT\b[^;]*\b(qual|with_check)\b/i,
    message: "Policy body columns (qual/with_check) forbidden — names only",
  },
  {
    id: "psql_meta",
    pattern: /^\\[!io]/im,
    message: "Dangerous psql meta-command forbidden (\\!, \\i, \\o)",
  },
  {
    id: "postgres_url",
    pattern: /postgres(?:ql)?:\/\/[^:\s'"]+:[^@\s'"]+@/i,
    message: "PostgreSQL URL with credentials forbidden",
  },
  {
    id: "jwt_like",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/,
    message: "JWT-like secret forbidden",
  },
  {
    id: "password_assignment",
    pattern: /password\s*=\s*['"][^'"]{3,}['"]/i,
    message: "Password assignment forbidden",
  },
];

const ALLOWED_CATALOG_SOURCES = [
  /\binformation_schema\./i,
  /\bpg_catalog\./i,
  /\bpg_extension\b/i,
  /\bpg_proc\b/i,
  /\bpg_namespace\b/i,
  /\bpg_type\b/i,
  /\bpg_trigger\b/i,
  /\bpg_class\b/i,
  /\bpg_roles\b/i,
  /\bpg_policy\b/i,
  /\bpg_policies\b/i,
  /\bpg_get_function_identity_arguments\s*\(/i,
  /\bpg_depend\b/i,
  /\bpg_am\b/i,
];

/**
 * @param {string} sql
 * @returns {AuditSqlViolation[]}
 */
export function findAuditSqlViolations(sql) {
  /** @type {AuditSqlViolation[]} */
  const violations = [];
  const lines = sql.split("\n");

  for (const rule of FORBIDDEN_RULES) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trimStart().startsWith("--")) continue;
      if (rule.pattern.test(line)) {
        violations.push({
          id: rule.id,
          message: rule.message,
          line: i + 1,
        });
        break;
      }
    }
  }

  return violations;
}

/**
 * @param {string} sql
 * @returns {AuditSqlViolation[]}
 */
export function findAuditSqlRequirementViolations(sql) {
  /** @type {AuditSqlViolation[]} */
  const violations = [];

  if (!/\bBEGIN\s+TRANSACTION\s+READ\s+ONLY\s*;/i.test(sql)) {
    violations.push({
      id: "missing_begin_read_only",
      message: "Must start with BEGIN TRANSACTION READ ONLY;",
    });
  }

  if (!/\bROLLBACK\s*;/i.test(sql)) {
    violations.push({
      id: "missing_rollback",
      message: "Must end with ROLLBACK;",
    });
  }

  const hasCatalogQuery = ALLOWED_CATALOG_SOURCES.some((pattern) => pattern.test(sql));
  if (!hasCatalogQuery) {
    violations.push({
      id: "missing_catalog_query",
      message: "Must contain at least one allowed catalogue query source",
    });
  }

  return violations;
}

/**
 * @param {string} sql
 * @param {string} [label]
 * @returns {{ ok: true, label: string }}
 */
export function validateAuditSqlContent(sql, label = "audit.sql") {
  const forbidden = findAuditSqlViolations(sql);
  if (forbidden.length) {
    const hit = forbidden[0];
    throw new Error(
      `[validate-audit-sql] FAIL ${label}: ${hit.message} (${hit.id}${hit.line ? ` line ${hit.line}` : ""})`
    );
  }

  const requirements = findAuditSqlRequirementViolations(sql);
  if (requirements.length) {
    const hit = requirements[0];
    throw new Error(`[validate-audit-sql] FAIL ${label}: ${hit.message} (${hit.id})`);
  }

  return { ok: true, label };
}

export { AUDIT_SQL_FILES };

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("[validate-audit-sql] Usage: node validate-audit-sql.mjs <audit.sql>");
    process.exit(1);
  }
  const sql = readFileSync(filePath, "utf8");
  validateAuditSqlContent(sql, filePath);
  console.log(`[validate-audit-sql] PASS: ${filePath}`);
}

const isMain = process.argv[1] && process.argv[1].endsWith("validate-audit-sql.mjs");
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
