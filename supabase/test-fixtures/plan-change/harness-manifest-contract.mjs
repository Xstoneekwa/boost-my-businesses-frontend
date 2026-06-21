/**
 * Plan Change harness manifest contract (no DB access).
 */

export const AUDIT_STATUS = {
  PENDING: "pending",
  PARTIAL: "partial",
  COMPLETE: "complete",
};

export const MINIMAL_PUBLIC_TABLES = [
  "clients",
  "ig_devices",
  "ig_accounts",
  "tenant_users",
  "client_users",
  "client_subscriptions",
  "client_instagram_accounts",
  "commercial_checkout_sessions",
  "client_account_entitlements",
  "commercial_checkout_audit_events",
];

export const EXTERNAL_SCHEMAS = ["auth"];

export const EXTERNAL_TABLES = ["auth.users"];

export const REQUIRED_CUSTOM_TYPES = ["user_role"];

export const REQUIRED_TRIGGER_FUNCTIONS = ["set_updated_at", "validate_client_subscription_type"];

export const EXCLUDED_TRIGGER_OBJECTS = [
  {
    name: "ig_accounts_release_schedule_capacity_on_admin_lifecycle",
    table: "ig_accounts",
    function: "release_schedule_capacity_on_account_admin_lifecycle",
  },
];

export const RLS_EXPLICIT_POLICY_TABLES = [
  "clients",
  "client_users",
  "client_subscriptions",
  "client_instagram_accounts",
];

export const OBSERVED_GRANT_ROLES = ["anon", "authenticated", "service_role", "postgres"];

export const TRIGGER_FUNCTION_EVIDENCE = [
  {
    name: "set_updated_at",
    language: "plpgsql",
    volatility: "volatile",
    securityDefiner: false,
    hasFunctionConfig: false,
  },
  {
    name: "validate_client_subscription_type",
    language: "plpgsql",
    volatility: "volatile",
    securityDefiner: false,
    hasFunctionConfig: true,
    snapshotFidelityRequirement:
      "Future schema-only export must preserve function configuration (proconfig); never inspect or store function body in manifest",
  },
];

/**
 * @param {object} evidence
 * @returns {{ type: 'BLOCKED', kind: string, name: string, detail: string }[]}
 */
export function validateConfirmedCatalogEvidence(evidence = {}) {
  const issues = [];

  const tables = evidence.sourcePublicTables ?? [];
  if (tables.length !== MINIMAL_PUBLIC_TABLES.length) {
    issues.push({
      type: "BLOCKED",
      kind: "evidence_table_count",
      name: "sourcePublicTables",
      detail: `confirmedCatalogEvidence must list exactly ${MINIMAL_PUBLIC_TABLES.length} public tables`,
    });
  }

  for (const table of MINIMAL_PUBLIC_TABLES) {
    if (!tables.includes(table)) {
      issues.push({
        type: "BLOCKED",
        kind: "evidence_missing_table",
        name: table,
        detail: `confirmedCatalogEvidence missing table: ${table}`,
      });
    }
  }

  if (!tables.includes("ig_devices")) {
    issues.push({
      type: "BLOCKED",
      kind: "evidence_missing_ig_devices",
      name: "ig_devices",
      detail: "confirmedCatalogEvidence must include ig_devices",
    });
  }

  if (!Array.isArray(evidence.externalTables) || evidence.externalTables.length !== 1 || evidence.externalTables[0] !== "auth.users") {
    issues.push({
      type: "BLOCKED",
      kind: "evidence_external_tables",
      name: "auth.users",
      detail: "Only auth.users is allowed as external table dependency",
    });
  }

  const customTypes = evidence.customTypes ?? [];
  const userRole = customTypes.find((t) => t.name === "user_role" && t.schema === "public" && t.kind === "enum");
  if (!userRole || !(userRole.usedBy ?? []).includes("tenant_users.role")) {
    issues.push({
      type: "BLOCKED",
      kind: "evidence_user_role_enum",
      name: "user_role",
      detail: "confirmedCatalogEvidence must declare public.user_role enum used by tenant_users.role",
    });
  }

  if (evidence.ddlAudit?.columnsAuditedOnAllTables !== true) {
    issues.push({
      type: "BLOCKED",
      kind: "evidence_columns",
      name: "ddlAudit.columnsAuditedOnAllTables",
      detail: "Columns must be audited on all 10 scope tables",
    });
  }

  const constraints = evidence.ddlAudit?.constraintsAudited ?? {};
  for (const key of ["primaryKey", "foreignKey", "unique", "check"]) {
    if (constraints[key] !== true) {
      issues.push({
        type: "BLOCKED",
        kind: "evidence_constraints",
        name: key,
        detail: `PK/FK/UNIQUE/CHECK constraints must be audited (${key})`,
      });
    }
  }

  const indexes = evidence.ddlAudit?.indexesAudited ?? {};
  if (indexes.allScopeTables !== true || indexes.includesPartialIndexes !== true || indexes.includesExpressionIndexes !== true) {
    issues.push({
      type: "BLOCKED",
      kind: "evidence_indexes",
      name: "ddlAudit.indexesAudited",
      detail: "Indexes must be audited on all scope tables, including partial and expression indexes",
    });
  }

  if (evidence.rls?.enabledOnAllPublicTables !== true) {
    issues.push({
      type: "BLOCKED",
      kind: "evidence_rls",
      name: "rls.enabledOnAllPublicTables",
      detail: "RLS must be enabled on all 10 public tables",
    });
  }

  const policyTables = evidence.rls?.explicitClientPoliciesOnlyOn ?? [];
  if (JSON.stringify([...policyTables].sort()) !== JSON.stringify([...RLS_EXPLICIT_POLICY_TABLES].sort())) {
    issues.push({
      type: "BLOCKED",
      kind: "evidence_rls_policies",
      name: "rls.explicitClientPoliciesOnlyOn",
      detail: "Explicit client policies only on clients, client_users, client_subscriptions, client_instagram_accounts",
    });
  }

  if (!Array.isArray(evidence.extensionsRequiredByScope) || evidence.extensionsRequiredByScope.length !== 0) {
    issues.push({
      type: "BLOCKED",
      kind: "evidence_extensions",
      name: "extensionsRequiredByScope",
      detail: "No extensions are required by the minimal harness scope",
    });
  }

  const triggerFns = evidence.triggerFunctions ?? [];
  for (const expected of TRIGGER_FUNCTION_EVIDENCE) {
    const found = triggerFns.find((fn) => fn.name === expected.name);
    if (!found) {
      issues.push({
        type: "BLOCKED",
        kind: "evidence_missing_trigger_function",
        name: expected.name,
        detail: `Missing trigger function evidence: ${expected.name}`,
      });
      continue;
    }
    if (found.language !== expected.language || found.volatility !== expected.volatility || found.securityDefiner !== expected.securityDefiner) {
      issues.push({
        type: "BLOCKED",
        kind: "evidence_trigger_function_metadata",
        name: expected.name,
        detail: `Trigger function metadata mismatch for ${expected.name}`,
      });
    }
    if (found.hasFunctionConfig !== expected.hasFunctionConfig) {
      issues.push({
        type: "BLOCKED",
        kind: "evidence_function_config_flag",
        name: expected.name,
        detail: `hasFunctionConfig must be ${expected.hasFunctionConfig} for ${expected.name}`,
      });
    }
    if (expected.hasFunctionConfig && !found.snapshotFidelityRequirement) {
      issues.push({
        type: "BLOCKED",
        kind: "evidence_snapshot_fidelity",
        name: expected.name,
        detail: "validate_client_subscription_type must document snapshot fidelity requirement for function config",
      });
    }
  }

  const excluded = (evidence.excludedTriggers ?? []).find(
    (t) => t.name === EXCLUDED_TRIGGER_OBJECTS[0].name && t.securityDefiner === true && t.timing === "AFTER UPDATE"
  );
  if (!excluded) {
    issues.push({
      type: "BLOCKED",
      kind: "evidence_excluded_trigger",
      name: EXCLUDED_TRIGGER_OBJECTS[0].name,
      detail: "Excluded scheduler ig_accounts trigger must be documented",
    });
  }

  return issues;
}

/**
 * @param {string | undefined} auditStatus
 * @returns {{ type: 'BLOCKED', kind: string, name: string, detail: string }[]}
 */
export function auditManifestDependenciesDeclared(declared = {}) {
  const { auditStatus } = declared;

  if (auditStatus === AUDIT_STATUS.PENDING || auditStatus == null) {
    return [
      {
        type: "BLOCKED",
        kind: "audit_pending",
        name: "externalDependencies",
        detail: `manifest.externalDependencies.auditStatus must be "complete" before snapshot validation (current: ${auditStatus ?? "missing"})`,
      },
    ];
  }

  if (auditStatus === AUDIT_STATUS.PARTIAL) {
    return [
      {
        type: "BLOCKED",
        kind: "audit_partial",
        name: "externalDependencies",
        detail:
          'manifest.externalDependencies.auditStatus is "partial" — catalogue confirmed but full DDL not validated; snapshot/apply remain BLOCKED until "complete"',
      },
    ];
  }

  if (auditStatus !== AUDIT_STATUS.COMPLETE) {
    return [
      {
        type: "BLOCKED",
        kind: "audit_invalid",
        name: "externalDependencies",
        detail: `Invalid manifest.externalDependencies.auditStatus: ${auditStatus}`,
      },
    ];
  }

  return [];
}

/**
 * @param {object} manifest
 * @returns {{ type: 'BLOCKED', kind: string, name: string, detail: string }[]}
 */
export function validateManifestCompleteInventory(manifest) {
  const issues = [];
  const tables = manifest.requiredCheckoutObjects?.tables ?? [];
  const scope = manifest.minimalHarnessScope ?? [];
  const evidence = manifest.confirmedCatalogEvidence ?? {};

  if (tables.length !== MINIMAL_PUBLIC_TABLES.length) {
    issues.push({
      type: "BLOCKED",
      kind: "table_count_mismatch",
      name: "requiredCheckoutObjects.tables",
      detail: `Expected ${MINIMAL_PUBLIC_TABLES.length} public tables in manifest`,
    });
  }

  for (const table of MINIMAL_PUBLIC_TABLES) {
    if (!tables.includes(table)) {
      issues.push({
        type: "BLOCKED",
        kind: "missing_required_table",
        name: table,
        detail: `Required public table missing from manifest: ${table}`,
      });
    }
  }

  if (!tables.includes("ig_devices")) {
    issues.push({
      type: "BLOCKED",
      kind: "missing_ig_devices",
      name: "ig_devices",
      detail: "ig_devices is mandatory in minimal harness scope",
    });
  }

  const includedTables = scope.filter((row) => row.category === "table" && row.included === true);
  if (includedTables.length !== MINIMAL_PUBLIC_TABLES.length) {
    issues.push({
      type: "BLOCKED",
      kind: "scope_table_count_mismatch",
      name: "minimalHarnessScope",
      detail: `minimalHarnessScope must include exactly ${MINIMAL_PUBLIC_TABLES.length} public tables`,
    });
  }

  const externalSchemas = manifest.externalDependencies?.schemas ?? [];
  if (!EXTERNAL_SCHEMAS.every((schema) => externalSchemas.includes(schema))) {
    issues.push({
      type: "BLOCKED",
      kind: "external_schema_mismatch",
      name: "auth",
      detail: "Only auth external schema is allowed",
    });
  }

  if ((evidence.externalTables ?? []).some((t) => t !== "auth.users")) {
    issues.push({
      type: "BLOCKED",
      kind: "external_table_mismatch",
      name: "externalTables",
      detail: "Only auth.users external table dependency is allowed",
    });
  }

  const declaredFunctions = manifest.externalDependencies?.functions ?? [];
  for (const fn of REQUIRED_TRIGGER_FUNCTIONS) {
    if (!declaredFunctions.includes(fn)) {
      issues.push({
        type: "BLOCKED",
        kind: "missing_required_function",
        name: fn,
        detail: `Required trigger function missing from manifest: ${fn}`,
      });
    }
  }

  const unexpectedFunctions = declaredFunctions.filter((fn) => !REQUIRED_TRIGGER_FUNCTIONS.includes(fn));
  if (unexpectedFunctions.length) {
    issues.push({
      type: "BLOCKED",
      kind: "unexpected_function",
      name: unexpectedFunctions[0],
      detail: "Only set_updated_at and validate_client_subscription_type are allowed trigger functions",
    });
  }

  const excluded = scope.find(
    (row) =>
      row.object === EXCLUDED_TRIGGER_OBJECTS[0].name &&
      row.included === false &&
      row.category === "trigger"
  );
  if (!excluded) {
    issues.push({
      type: "BLOCKED",
      kind: "missing_excluded_trigger",
      name: EXCLUDED_TRIGGER_OBJECTS[0].name,
      detail: "Scheduler ig_accounts lifecycle trigger must be explicitly excluded from scope",
    });
  }

  issues.push(...validateConfirmedCatalogEvidence(evidence));

  return issues;
}

/**
 * @param {object} manifest
 * @returns {{ ok: false, message: string } | { ok: true }}
 */
export function assertSnapshotApplyAllowed(manifest) {
  const status = manifest.externalDependencies?.auditStatus;
  if (status !== AUDIT_STATUS.COMPLETE) {
    return {
      ok: false,
      message: `Harness snapshot/apply BLOCKED until externalDependencies.auditStatus is "complete" (current: ${status ?? "missing"})`,
    };
  }

  const inventoryIssues = validateManifestCompleteInventory(manifest);
  if (inventoryIssues.length) {
    return { ok: false, message: inventoryIssues[0].detail };
  }

  return { ok: true };
}

/**
 * @param {object} manifest
 * @returns {string[]}
 */
export function validateManifestSchema(manifest) {
  const errors = [];
  const deps = manifest.externalDependencies;
  if (!deps) {
    errors.push("externalDependencies missing");
    return errors;
  }

  if (!Object.values(AUDIT_STATUS).includes(deps.auditStatus)) {
    errors.push(`invalid auditStatus: ${deps.auditStatus}`);
  }

  if (deps.auditStatus === AUDIT_STATUS.PENDING) {
    for (const key of ["extensions", "functions", "roles"]) {
      if (deps[key] !== null) {
        errors.push(`pending audit must use null for ${key}`);
      }
    }
  }

  if (deps.auditStatus === AUDIT_STATUS.PARTIAL || deps.auditStatus === AUDIT_STATUS.COMPLETE) {
    for (const key of ["extensions", "schemas", "functions", "roles"]) {
      if (!Array.isArray(deps[key])) {
        errors.push(`${deps.auditStatus} audit requires array for ${key}`);
      }
    }
  }

  if (!manifest.confirmedCatalogEvidence) {
    errors.push("confirmedCatalogEvidence missing");
  } else if (manifest.externalDependencies?.auditStatus === AUDIT_STATUS.COMPLETE) {
    const evidenceErrors = validateConfirmedCatalogEvidence(manifest.confirmedCatalogEvidence).map(
      (issue) => issue.detail
    );
    errors.push(...evidenceErrors);
  }

  if (!Array.isArray(manifest.minimalHarnessScope) || manifest.minimalHarnessScope.length === 0) {
    errors.push("minimalHarnessScope missing or empty");
  }

  return errors;
}
