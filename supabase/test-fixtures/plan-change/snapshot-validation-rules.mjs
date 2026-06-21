/**
 * Schema-only snapshot validation rules (no DB access).
 * Distinguishes legitimate SQL role identifiers from real secrets.
 */

export const LEGITIMATE_SQL_ROLES = ["service_role", "anon", "authenticated", "postgres", "PUBLIC"];

/** @typedef {{ id: string, message: string }} SecretViolation */

/**
 * @param {string} sql
 * @returns {SecretViolation[]}
 */
export function findForbiddenSecrets(sql) {
  /** @type {SecretViolation[]} */
  const violations = [];

  if (/^\s*COPY\s+/im.test(sql)) {
    violations.push({ id: "copy", message: "COPY statements are forbidden" });
  }

  if (/^\s*INSERT\s+INTO\s+/im.test(sql)) {
    violations.push({ id: "insert", message: "INSERT INTO statements are forbidden" });
  }

  if (/postgres(?:ql)?:\/\/[^:\s'"]+:[^@\s'"]+@/i.test(sql)) {
    violations.push({
      id: "postgresql_url_with_password",
      message: "PostgreSQL URL with embedded credentials is forbidden",
    });
  }

  if (/password\s*=\s*['"][^'"]{3,}['"]/i.test(sql)) {
    violations.push({ id: "password_assignment", message: "Password assignment forbidden" });
  }

  if (/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/.test(sql)) {
    violations.push({ id: "jwt_like", message: "JWT-like secret material forbidden" });
  }

  if (/\bsb_[a-z]+_[A-Za-z0-9]{20,}\b/.test(sql)) {
    violations.push({ id: "supabase_key", message: "Supabase key material (sb_...) forbidden" });
  }

  if (/Bearer\s+[A-Za-z0-9._-]{20,}/i.test(sql)) {
    violations.push({ id: "bearer_token", message: "Bearer token value forbidden" });
  }

  if (/service_role['"]?\s*,\s*['"][A-Za-z0-9._-]{40,}['"]/i.test(sql)) {
    violations.push({ id: "service_role_key_value", message: "service_role key value forbidden" });
  }

  return violations;
}

/**
 * @param {string} sql
 * @returns {boolean}
 */
export function containsLegitimateServiceRoleGrant(sql) {
  return /GRANT\s+.+\s+TO\s+service_role\s*;/im.test(sql);
}

const FORBIDDEN_PLAN_CHANGE_OBJECTS = [
  {
    type: "table",
    name: "commercial_plan_change_quotes",
    pattern: /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?commercial_plan_change_quotes/im,
  },
  {
    type: "table",
    name: "client_credit_ledger",
    pattern: /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?client_credit_ledger/im,
  },
  {
    type: "function",
    name: "activate_commercial_plan_change",
    pattern: /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?activate_commercial_plan_change/im,
  },
];

/**
 * @param {string} sql
 * @returns {{ type: string, name: string }[]}
 */
export function findForbiddenPlanChangeObjects(sql) {
  return FORBIDDEN_PLAN_CHANGE_OBJECTS.filter((obj) => obj.pattern.test(sql)).map((obj) => ({
    type: obj.type,
    name: obj.name,
  }));
}

function requiredTablePattern(table) {
  return new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\b`,
    "im"
  );
}

/**
 * @param {string} sql
 * @param {string[]} requiredTables
 * @returns {string[]}
 */
export function findMissingRequiredTables(sql, requiredTables) {
  return requiredTables.filter((table) => !requiredTablePattern(table).test(sql));
}

/**
 * Detect extensions referenced in snapshot SQL.
 * @param {string} sql
 * @returns {string[]}
 */
export function detectExtensionsInSnapshot(sql) {
  const found = new Set();
  for (const match of sql.matchAll(/CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([^"\s;]+)"?/gi)) {
    found.add(match[1].replace(/"/g, ""));
  }
  return [...found];
}

/**
 * Detect non-public schema references (e.g. auth.users FK).
 * @param {string} sql
 * @returns {string[]}
 */
export function detectExternalSchemaReferences(sql) {
  const found = new Set();
  for (const match of sql.matchAll(/\b(auth)\.[a-z_]+/gi)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

/**
 * Detect roles cited in GRANT/REVOKE statements.
 * @param {string} sql
 * @returns {string[]}
 */
export function detectRolesInSnapshot(sql) {
  const found = new Set();
  for (const line of sql.split("\n")) {
    if (!/^\s*(GRANT|REVOKE)\b/i.test(line)) continue;
    const toMatch = line.match(/\bTO\s+([^;]+)/i);
    if (toMatch) {
      for (const part of toMatch[1].split(",")) {
        const name = part.trim().replace(/^"|"$/g, "");
        if (name) found.add(name);
      }
    }
    const fromMatch = line.match(/\bFROM\s+([^;]+)/i);
    if (fromMatch) {
      for (const part of fromMatch[1].split(",")) {
        const name = part.trim().replace(/^"|"$/g, "");
        if (name) found.add(name);
      }
    }
  }
  return [...found].sort();
}

/**
 * @param {string} sql
 * @param {{
 *   auditStatus?: string,
 *   extensions?: string[] | null,
 *   schemas?: string[] | null,
 *   functions?: string[] | null,
 *   roles?: string[] | null,
 * }} declared
 * @returns {{ type: 'BLOCKED', kind: string, name: string, detail: string }[]}
 */
export function auditExternalDependencies(sql, declared = {}) {
  if (declared.auditStatus !== "complete") {
    return [];
  }

  const issues = [];
  const extensions = declared.extensions ?? [];
  const schemas = declared.schemas ?? [];
  const functions = declared.functions ?? [];
  const roles = declared.roles ?? [];

  const foundExtensions = detectExtensionsInSnapshot(sql);
  const foundSchemas = detectExternalSchemaReferences(sql);
  const foundRoles = detectRolesInSnapshot(sql);

  for (const ext of foundExtensions) {
    if (!extensions.includes(ext)) {
      issues.push({
        type: "BLOCKED",
        kind: "undeclared_extension_in_snapshot",
        name: ext,
        detail: `Snapshot uses extension "${ext}" but manifest.externalDependencies.extensions does not declare it`,
      });
    }
  }

  for (const schema of foundSchemas) {
    if (!schemas.includes(schema)) {
      issues.push({
        type: "BLOCKED",
        kind: "undeclared_schema_reference",
        name: schema,
        detail: `Snapshot references schema "${schema}" but manifest.externalDependencies.schemas does not declare it`,
      });
    }
  }

  for (const role of foundRoles) {
    if (!roles.includes(role)) {
      issues.push({
        type: "BLOCKED",
        kind: "undeclared_role_in_snapshot",
        name: role,
        detail: `Snapshot GRANT/REVOKE cites role "${role}" but manifest.externalDependencies.roles does not declare it`,
      });
    }
  }

  for (const ext of extensions) {
    if (!foundExtensions.includes(ext)) {
      issues.push({
        type: "BLOCKED",
        kind: "manifest_extension_missing_in_snapshot",
        name: ext,
        detail: `Manifest declares extension "${ext}" but snapshot has no CREATE EXTENSION for it`,
      });
    }
  }

  for (const schema of schemas) {
    if (!foundSchemas.some((s) => s === schema) && !new RegExp(`\\b${schema}\\.`, "i").test(sql)) {
      issues.push({
        type: "BLOCKED",
        kind: "manifest_schema_missing_in_snapshot",
        name: schema,
        detail: `Manifest declares schema "${schema}" but snapshot does not reference it`,
      });
    }
  }

  for (const fn of functions) {
    if (!new RegExp(`\\b${fn}\\s*\\(`, "i").test(sql)) {
      issues.push({
        type: "BLOCKED",
        kind: "manifest_function_missing_in_snapshot",
        name: fn,
        detail: `Manifest declares function "${fn}" but snapshot does not contain it`,
      });
    }
  }

  for (const role of roles) {
    if (!foundRoles.includes(role)) {
      issues.push({
        type: "BLOCKED",
        kind: "manifest_role_missing_in_snapshot",
        name: role,
        detail: `Manifest declares role "${role}" but snapshot has no GRANT/REVOKE citing it`,
      });
    }
  }

  return issues;
}

/**
 * @param {{
 *   auditStatus?: string,
 *   extensions?: string[] | null,
 *   schemas?: string[] | null,
 *   functions?: string[] | null,
 *   roles?: string[] | null,
 * }} declared
 * @returns {{ type: 'BLOCKED', kind: string, name: string, detail: string }[]}
 */
export { auditManifestDependenciesDeclared } from "./harness-manifest-contract.mjs";
