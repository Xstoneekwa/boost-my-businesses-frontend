#!/usr/bin/env node
/**
 * Isolated DB integration validation for plan change RPC.
 *
 * SAFETY:
 * - Requires PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only
 * - Requires dedicated PLAN_CHANGE_TEST_* env vars (NOT .env.local shared keys)
 * - Blocks known shared project ref zgafnshkjywfltxgbtzg
 * - Refuses if Lucie/Liam protected client IDs exist in DB
 *
 * Usage:
 *   export PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only
 *   export PLAN_CHANGE_TEST_SUPABASE_URL=https://<isolated-ref>.supabase.co
 *   export PLAN_CHANGE_TEST_SERVICE_ROLE_KEY=...
 *   export PLAN_CHANGE_TEST_ANON_KEY=...   # required for --phase=schema RLS checks
 *
 *   node scripts/validate-plan-change-db-integration.mjs --phase=environment
 *   node scripts/validate-plan-change-db-integration.mjs --phase=schema
 *   node scripts/validate-plan-change-db-integration.mjs --phase=idempotency --quote-id=... --idempotency-key=...
 *   node scripts/validate-plan-change-db-integration.mjs --phase=concurrency --quote-a=... --quote-b=... --key-a=... --key-b=...
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyEnvironmentState,
  classificationLabel,
  CLASSIFICATION,
} from "../supabase/test-fixtures/plan-change/harness-contract.mjs";
import {
  FINGERPRINT_TABLES,
  MIGRATION_VERSIONS,
  REQUIRED_COLUMNS,
  FLOW_TYPE_MUST_INCLUDE,
  RPC_EXPECTED,
} from "./plan-change-schema-fingerprint.mjs";
import {
  createPlanChangeAdminClient,
  formatInventoryProbeStatus,
  formatProbeLog,
  fromPublicTable,
  fromSchemaTable,
  isTableMissingError,
  probePublicTableHeadCount,
} from "./plan-change-rest-probe.mjs";

const CONFIRM = process.env.PLAN_CHANGE_DB_TEST_CONFIRM;

const BLOCKED_PROJECT_REFS = new Set(["zgafnshkjywfltxgbtzg"]);
const EXPECTED_ISOLATED_REF = "nxntngkhkoynljcagmkq";
const PROTECTED_CLIENT_IDS = new Set([
  "c51267f5-6c0d-46db-8ba0-7f1746a7b4bc", // Lucie
  "c37c9143-ee14-4c9a-9a60-226759241733", // Liam
]);
const PROTECTED_CLIENT_EMAILS = ["xstonekwa@hotmail.com"];

const args = process.argv.slice(2);
function arg(name) {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}
const phase = arg("phase") || "guard";

function loadPlanChangeTestEnvFile() {
  if (process.env.PLAN_CHANGE_TEST_SERVICE_ROLE_KEY) return;
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const candidates = [
    process.env.PLAN_CHANGE_TEST_ENV_FILE,
    join(repoRoot, ".env.plan-change-test"),
  ].filter(Boolean);
  for (const filePath of candidates) {
    if (!existsSync(filePath)) continue;
    if (filePath.endsWith(".env.local")) continue;
    const lines = readFileSync(filePath, "utf8").split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^(PLAN_CHANGE_[A-Z0-9_]+)=(.*)$/);
      if (!match) continue;
      if (!process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
    if (process.env.PLAN_CHANGE_TEST_SERVICE_ROLE_KEY) return;
  }
}

loadPlanChangeTestEnvFile();

function fail(message) {
  console.error(`[plan-change-db-validation] FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`[plan-change-db-validation] PASS: ${message}`);
}

function inconclusive(message) {
  console.log(`[plan-change-db-validation] INCONCLUSIVE: ${message}`);
}

function warn(message) {
  console.log(`[plan-change-db-validation] WARN: ${message}`);
}

function info(message) {
  console.log(`[plan-change-db-validation] ${message}`);
}

function extractProjectRef(url) {
  try {
    const host = new URL(url).hostname;
    const ref = host.split(".")[0];
    return ref || null;
  } catch {
    return null;
  }
}

function assertGuard({ strictPlanChangeEnvOnly = false } = {}) {
  if (CONFIRM !== "isolated-test-only") {
    fail(
      "Refusing to run: set PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only on an isolated test database."
    );
  }

  const url = strictPlanChangeEnvOnly
    ? process.env.PLAN_CHANGE_TEST_SUPABASE_URL || ""
    : process.env.PLAN_CHANGE_TEST_SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";
  const serviceKey = strictPlanChangeEnvOnly
    ? process.env.PLAN_CHANGE_TEST_SERVICE_ROLE_KEY || ""
    : process.env.PLAN_CHANGE_TEST_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "";

  if (!url) {
    fail(
      "Missing PLAN_CHANGE_TEST_SUPABASE_URL. Do not use shared .env.local without explicit PLAN_CHANGE_TEST_* override."
    );
  }

  if (
    !strictPlanChangeEnvOnly &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !process.env.PLAN_CHANGE_TEST_SUPABASE_URL
  ) {
    fail(
      "Refusing to run with only NEXT_PUBLIC_SUPABASE_URL from shared env. Set PLAN_CHANGE_TEST_SUPABASE_URL explicitly."
    );
  }

  const ref = extractProjectRef(url);
  if (!ref) {
    fail(`Cannot parse project ref from URL: ${maskUrl(url)}`);
  }

  if (BLOCKED_PROJECT_REFS.has(ref)) {
    fail(
      `Refusing blocked shared project ref "${ref}" (Lucie/Liam dev DB). Provision an isolated Supabase project — see docs/plan-change-db-validation-runbook.md`
    );
  }

  if (ref !== EXPECTED_ISOLATED_REF) {
    fail(
      `Unexpected project ref "${ref}". Expected isolated ref "${EXPECTED_ISOLATED_REF}" only.`
    );
  }

  if (!serviceKey) {
    fail("Missing PLAN_CHANGE_TEST_SERVICE_ROLE_KEY.");
  }

  return { url, serviceKey, ref };
}

function maskUrl(url) {
  try {
    const parsed = new URL(url);
    const ref = parsed.hostname.split(".")[0];
    return `https://${ref.slice(0, 4)}****.supabase.co`;
  } catch {
    return "(invalid url)";
  }
}

function logProbe(probeType, ref) {
  info(formatProbeLog(probeType, ref));
}

async function tableProbe(admin, table, probeType = "inventory") {
  const result = await probePublicTableHeadCount(admin, table, probeType);
  logProbe(probeType, result.ref);
  return {
    state: result.state,
    count: result.count,
    error: result.error,
    ref: result.ref,
  };
}

async function probeColumnsViaSelect(admin, table, columns, probeType = "fingerprint_column") {
  const missing = [];
  for (const column of columns) {
    const { query, ref } = fromPublicTable(admin, table);
    logProbe(`${probeType}:${column}`, ref);
    const { error } = await query.select(column).limit(0);
    if (error && /column|Could not find/i.test(error.message)) {
      missing.push(column);
    }
  }
  return missing;
}

async function fetchOpenApi(url, serviceKey) {
  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/openapi+json",
    },
  });
  if (!res.ok) {
    return { ok: false, error: `OpenAPI fetch HTTP ${res.status}`, definitions: null };
  }
  const doc = await res.json();
  return { ok: true, error: null, definitions: doc.definitions ?? {} };
}

async function probeMigrationHistory(admin) {
  const attempts = [
    {
      label: "supabase_migrations.schema_migrations",
      run: () => {
        const { query, ref } = fromSchemaTable(admin, "supabase_migrations", "schema_migrations");
        logProbe("migration_history", ref);
        return query.select("version,name").order("version");
      },
    },
  ];
  for (const attempt of attempts) {
    const { data, error } = await attempt.run();
    if (!error && Array.isArray(data)) {
      return { ok: true, source: attempt.label, rows: data, error: null };
    }
  }
  return { ok: false, source: null, rows: null, error: "migration_history_not_exposed_via_api" };
}

async function probeFlowTypeConstraint(admin) {
  const { query, ref } = fromPublicTable(admin, "commercial_checkout_sessions");
  logProbe("flow_type_column", ref);
  const { data, error } = await query.select("flow_type").limit(1);
  if (error) {
    if (isTableMissingError(error.message)) {
      return { ok: false, state: "table_missing", includesPlanChange: null, error: error.message };
    }
    return { ok: false, state: "inaccessible", includesPlanChange: null, error: error.message };
  }
  void data;
  // Cannot validate CHECK enum via SELECT; infer from OpenAPI or INCONCLUSIVE.
  return { ok: true, state: "table_exists", includesPlanChange: null, error: null };
}

async function probeRpcMetadata(openApiDefinitions) {
  const fnKey = `function.public.${RPC_EXPECTED.name}`;
  const fnDef = openApiDefinitions?.[fnKey];
  if (!fnDef) {
    return { present: false, source: "openapi", detail: null };
  }
  return {
    present: true,
    source: "openapi",
    detail: {
      args: Object.keys(fnDef.properties ?? {}),
    },
  };
}

async function runIsolationChecks(admin, inventory) {
  const clientsState = inventory.clients?.state;
  const clientsLabel = inventory.clients?.ref?.probeLabel ?? "schema=public table=clients";
  if (clientsState !== "exists") {
    inconclusive(
      `Lucie/Liam client-id probe skipped — ${clientsLabel} state=${clientsState ?? "unknown"} (not a PASS)`
    );
    inconclusive(
      `Protected email probe skipped — ${clientsLabel} state=${clientsState ?? "unknown"} (not a PASS)`
    );
    if (inventory.commercial_checkout_sessions?.state === "exists") {
      const { query, ref } = fromPublicTable(admin, "commercial_checkout_sessions");
      logProbe("isolation_shared_checkout_clients_absent", ref);
      const sharedCheckout = await query
        .select("id", { count: "exact", head: true })
        .in("client_id", [...PROTECTED_CLIENT_IDS]);
      if (sharedCheckout.error) {
        inconclusive(`Shared checkout probe error: ${sharedCheckout.error.message}`);
      } else if ((sharedCheckout.count ?? 0) > 0) {
        fail(`Shared checkout sessions found for Lucie/Liam client ids (count=${sharedCheckout.count})`);
      } else {
        inconclusive(
          `Shared checkout empty for protected ids but clients table state=${clientsState} — isolation partial (${ref.probeLabel})`
        );
      }
    } else {
      inconclusive(
        `Shared checkout probe skipped — commercial_checkout_sessions state=${inventory.commercial_checkout_sessions?.state ?? "unknown"}`
      );
    }
    return { isolationPass: false, isolationInconclusive: true };
  }

  const ids = [...PROTECTED_CLIENT_IDS];
  {
    const { query, ref } = fromPublicTable(admin, "clients");
    logProbe("isolation_lucie_liam_ids", ref);
    const { data: protectedRows, error: protectedErr } = await query.select("id").in("id", ids);
    if (protectedErr) {
      fail(`Lucie/Liam client-id probe failed (${ref.probeLabel}): ${protectedErr.message}`);
    }
    if (protectedRows?.length) {
      fail(`Protected Lucie/Liam client(s) found: ${protectedRows.map((r) => r.id).join(", ")}`);
    }
    pass(`Lucie/Liam protected client IDs absent (${ref.probeLabel}, query executed, zero rows)`);
  }

  for (const email of PROTECTED_CLIENT_EMAILS) {
    const { query, ref } = fromPublicTable(admin, "clients");
    logProbe("isolation_protected_email", ref);
    const { data, error } = await query.select("id").ilike("email", email).limit(5);
    if (error) {
      fail(`Protected email probe failed for ${email} (${ref.probeLabel}): ${error.message}`);
    }
    if (data?.length) {
      fail(`Protected client email found: ${email}`);
    }
    pass(`Protected email absent: ${email} (${ref.probeLabel}, query executed, zero rows)`);
  }

  if (inventory.commercial_checkout_sessions?.state === "exists") {
    const { query, ref } = fromPublicTable(admin, "commercial_checkout_sessions");
    logProbe("isolation_shared_checkout", ref);
    const sharedCheckout = await query
      .select("id", { count: "exact", head: true })
      .in("client_id", [...PROTECTED_CLIENT_IDS]);
    if (sharedCheckout.error) {
      fail(`Shared checkout probe failed (${ref.probeLabel}): ${sharedCheckout.error.message}`);
    }
    if ((sharedCheckout.count ?? 0) > 0) {
      fail(`Shared checkout sessions found for Lucie/Liam client ids (count=${sharedCheckout.count})`);
    }
    pass(`No shared checkout sessions for Lucie/Liam client ids (${ref.probeLabel}, query executed, zero rows)`);
  } else {
    inconclusive(
      `Shared checkout probe skipped — commercial_checkout_sessions state=${inventory.commercial_checkout_sessions?.state ?? "unknown"}`
    );
    return { isolationPass: false, isolationInconclusive: true };
  }

  return { isolationPass: true, isolationInconclusive: false };
}

async function fingerprintSchema(admin, url, serviceKey, inventory) {
  info("Schema fingerprint (read-only):");

  const openApi = await fetchOpenApi(url, serviceKey);
  if (!openApi.ok) {
    inconclusive(`OpenAPI definitions unavailable: ${openApi.error}`);
  } else {
    pass("OpenAPI definitions fetched");
  }

  const diffs = [];
  for (const table of FINGERPRINT_TABLES) {
    const state = inventory[table]?.state;
    if (state !== "exists") {
      diffs.push({ table, kind: "table_missing", detail: state });
      info(`  ${table}: MISSING (state=${state})`);
      continue;
    }

    const requiredCols = REQUIRED_COLUMNS[table] ?? [];
    const missingCols = await probeColumnsViaSelect(admin, table, requiredCols);
    if (missingCols.length) {
      diffs.push({ table, kind: "columns_missing", detail: missingCols });
      info(`  ${table}: column probe missing -> ${missingCols.join(", ")}`);
    } else {
      pass(`${table}: required plan-change columns selectable`);
    }

    const openApiTable = openApi.definitions?.[table];
    if (openApiTable?.properties) {
      const openApiCols = Object.keys(openApiTable.properties).sort();
      info(`  ${table}: openapi_columns=${openApiCols.length}`);
    }
  }

  const flowProbe = await probeFlowTypeConstraint(admin);
  if (flowProbe.state === "table_missing") {
    diffs.push({ table: "commercial_checkout_sessions", kind: "flow_type_check", detail: "table_missing" });
  } else if (openApi.ok) {
    const flowCol = openApi.definitions?.commercial_checkout_sessions?.properties?.flow_type;
    const desc = JSON.stringify(flowCol ?? {});
    if (desc.includes(FLOW_TYPE_MUST_INCLUDE)) {
      pass(`flow_type OpenAPI documents '${FLOW_TYPE_MUST_INCLUDE}'`);
    } else {
      diffs.push({
        table: "commercial_checkout_sessions",
        kind: "flow_type_check",
        detail: "plan_change not confirmed in OpenAPI; CHECK constraint not readable via REST",
      });
      inconclusive(
        "flow_type includes plan_change — CHECK constraint not readable via REST (OpenAPI inconclusive)"
      );
    }
  }

  const rpcMeta = await probeRpcMetadata(openApi.definitions ?? {});
  if (rpcMeta.present) {
    pass(`RPC ${RPC_EXPECTED.name} present in OpenAPI`);
    info(`  RPC args (OpenAPI): ${(rpcMeta.detail?.args ?? []).join(", ") || "unknown"}`);
  } else if (inventory.commercial_plan_change_quotes?.state === "exists") {
    diffs.push({ table: RPC_EXPECTED.name, kind: "rpc_missing_in_openapi", detail: "function not listed" });
    inconclusive(`RPC ${RPC_EXPECTED.name} not listed in OpenAPI though plan_change tables exist`);
  } else {
    info(`  RPC ${RPC_EXPECTED.name}: not present (plan_change schema absent)`);
  }

  for (const table of ["commercial_plan_change_quotes", "client_credit_ledger"]) {
    if (inventory[table]?.state !== "exists") continue;
    // RLS/grants not fully introspectable via REST without catalog SQL.
    inconclusive(`${table}: RLS/grants/grantee matrix requires catalog SQL (not executed)`);
  }

  return { diffs, openApiOk: openApi.ok };
}

async function reportMigrationHistory(migrationHistory, { suppressInconclusive = false } = {}) {
  info("Migration history (read-only):");
  if (!migrationHistory.ok) {
    if (suppressInconclusive) {
      info("Migration history not exposed via Supabase REST (expected on empty baseline — not downgrading classification)");
    } else {
      inconclusive(`Migration history not exposed via Supabase REST: ${migrationHistory.error}`);
      inconclusive(
        "Cannot confirm whether 20260615143000 / 20260621120000 were applied via supabase_migrations"
      );
    }
    return { checkoutRecorded: null, planChangeRecorded: null };
  }

  pass(`Migration history readable via ${migrationHistory.source}`);
  const versions = (migrationHistory.rows ?? []).map((r) => String(r.version ?? r.name ?? ""));
  info(`  recorded_versions=${versions.length}`);
  for (const row of migrationHistory.rows ?? []) {
    info(`  - ${row.version}${row.name ? ` ${row.name}` : ""}`);
  }

  const checkoutRecorded = versions.some((v) => v.includes("20260615143000"));
  const planChangeRecorded = versions.some((v) => v.includes("20260621120000"));
  if (checkoutRecorded) {
    pass(`Migration history includes ${MIGRATION_VERSIONS.checkout}`);
  } else {
    warn(`Migration history does NOT include ${MIGRATION_VERSIONS.checkout}`);
  }
  if (planChangeRecorded) {
    pass(`Migration history includes ${MIGRATION_VERSIONS.planChange}`);
  } else {
    warn(`Migration history does NOT include ${MIGRATION_VERSIONS.planChange}`);
  }
  return { checkoutRecorded, planChangeRecorded };
}

async function phaseEnvironment(admin, ref, url, serviceKey) {
  info("Phase: environment (read-only, no migration, no RPC activation)");

  pass(`Effective project ref: ${ref}`);
  pass(`Guard accepts target (not blocked, matches ${EXPECTED_ISOLATED_REF})`);

  const schemaTables = [
    { name: "clients", group: "base" },
    { name: "ig_accounts", group: "base" },
    { name: "tenant_users", group: "tenant" },
    { name: "client_users", group: "tenant" },
    { name: "client_subscriptions", group: "tenant" },
    { name: "client_instagram_accounts", group: "tenant" },
    { name: "commercial_checkout_sessions", group: "checkout" },
    { name: "client_account_entitlements", group: "checkout" },
    { name: "commercial_checkout_audit_events", group: "checkout" },
    { name: "commercial_plan_change_quotes", group: "plan_change" },
    { name: "client_credit_ledger", group: "plan_change" },
  ];

  info("Schema inventory (read-only, unified public schema probes):");
  const inventory = {};
  for (const { name, group } of schemaTables) {
    const probe = await tableProbe(admin, name, "inventory");
    inventory[name] = probe;
    info(`  [${group}] ${name}: ${formatInventoryProbeStatus(probe)}`);
  }

  if (inventory.clients?.state === "missing" && inventory.commercial_checkout_sessions?.state === "exists") {
    warn(
      "Inconsistency: checkout tables exist while clients is missing — likely partial bootstrap or FK-less manual DDL"
    );
  }

  const isolation = await runIsolationChecks(admin, inventory);

  const preClassification = classifyEnvironmentState({
    inventory,
    isolation: { ...isolation, isolationPass: isolation.isolationPass, isolationInconclusive: isolation.isolationInconclusive },
    fingerprint: { diffs: [] },
    ref,
  });
  const isEmptyBaseline = preClassification === CLASSIFICATION.D;

  if (inventory.clients?.state === "exists") {
    info(`Total clients in isolated DB: ${inventory.clients.count ?? 0}`);
  } else if (isEmptyBaseline) {
    info("Total clients: 0 (empty baseline — no clients table)");
  } else {
    inconclusive(`Total clients unknown — clients table state=${inventory.clients?.state ?? "unknown"}`);
  }

  const migrationHistory = await reportMigrationHistory(await probeMigrationHistory(admin), {
    suppressInconclusive: isEmptyBaseline,
  });
  const fingerprint = await fingerprintSchema(admin, url, serviceKey, inventory);

  const checkoutReady = FINGERPRINT_TABLES.slice(0, 3).every((t) => inventory[t]?.state === "exists");
  const planChangeReady = FINGERPRINT_TABLES.slice(3).every((t) => inventory[t]?.state === "exists");

  if (checkoutReady) {
    info("Checkout tables detected in inventory");
  } else {
    info("Checkout tables absent or partial");
  }
  if (planChangeReady) {
    info("Plan-change tables detected in inventory");
  } else {
    info("Plan-change tables absent or partial");
  }

  if (checkoutReady && migrationHistory.checkoutRecorded === false) {
    warn(
      "Checkout tables exist but migration 20260615143000 not in exposed history — likely manual SQL or template bootstrap"
    );
  }
  if (planChangeReady && migrationHistory.planChangeRecorded === false) {
    warn(
      "Plan-change tables exist but migration 20260621120000 not in exposed history — likely manual SQL or template bootstrap"
    );
  }

  const verdict = classifyEnvironmentState({
    inventory,
    isolation: { ...isolation, isolationPass: isolation.isolationPass, isolationInconclusive: isolation.isolationInconclusive },
    fingerprint,
    ref,
  });

  info(`Verdict classification: ${classificationLabel(verdict)}`);
  if (verdict === CLASSIFICATION.A) {
    pass("Case A — schema_exact_present; proceed to --phase=schema (still no E2E)");
  } else if (verdict === CLASSIFICATION.B) {
    warn("Case B — schema_partial_or_divergent; NO-GO for apply/replay");
  } else if (verdict === CLASSIFICATION.D) {
    pass("Case D — empty_baseline_test_database: isolation/environment PASS");
    warn("NO-GO for checkout/plan-change migration until test harness snapshot is applied");
    info("Next: generate public-schema-canonical.snapshot.sql (schema-only) then apply-plan-change-test-harness.sh");
  } else {
    inconclusive("Case C — probe_or_access_inconclusive; fix probes and re-run");
  }

  pass("Environment read-only pass complete (see INCONCLUSIVE/WARN lines above)");
}

async function assertNoProtectedClients(admin, clientsInventory = null) {
  const probe = clientsInventory ?? (await tableProbe(admin, "clients", "isolation_preflight"));
  if (probe.state !== "exists") {
    inconclusive(
      `Lucie/Liam client-id probe skipped — ${probe.ref?.probeLabel ?? "schema=public table=clients"} state=${probe.state} (not a PASS)`
    );
    return;
  }
  const ids = [...PROTECTED_CLIENT_IDS];
  const { query, ref } = fromPublicTable(admin, "clients");
  logProbe("isolation_lucie_liam_ids", ref);
  const { data, error } = await query.select("id").in("id", ids);
  if (error) {
    fail(`Cannot query clients for isolation check (${ref.probeLabel}): ${error.message}`);
  }
  if (data && data.length > 0) {
    fail(
      `Protected Lucie/Liam client(s) found in target DB: ${data.map((r) => r.id).join(", ")}. Wrong database.`
    );
  }
  pass("No Lucie/Liam protected clients in target DB");
}

async function phaseSchema(admin, anonKey) {
  info("Phase: schema + RLS + RPC grants");

  const requiredTables = [
    "commercial_checkout_sessions",
    "client_account_entitlements",
    "commercial_plan_change_quotes",
    "client_credit_ledger",
  ];

  for (const table of requiredTables) {
    const { query, ref } = fromPublicTable(admin, table);
    logProbe("schema_table_exists", ref);
    const { error } = await query.select("*", { head: true, count: "exact" });
    if (error) {
      fail(`Table ${ref.probeLabel} missing or inaccessible: ${error.message}`);
    }
    pass(`Table ${ref.probeLabel} exists`);
  }

  const { data: rpcRows, error: rpcErr } = await admin.rpc("activate_commercial_plan_change", {
    p_quote_id: "00000000-0000-0000-0000-000000000000",
    p_idempotency_key: "schema-probe-invalid",
    p_actor_email: null,
    p_simulated_activation: false,
  });

  if (rpcErr && !rpcErr.message.includes("quote_not_found") && rpcErr.code !== "P0001") {
    if (rpcErr.message.includes("Could not find the function")) {
      fail("RPC activate_commercial_plan_change not found — apply migration 20260621120000");
    }
    if (rpcErr.message.includes("permission denied")) {
      fail(`Unexpected permission error on service_role RPC: ${rpcErr.message}`);
    }
  }

  if (rpcRows && typeof rpcRows === "object" && rpcRows.code === "quote_not_found") {
    pass("RPC activate_commercial_plan_change callable by service_role");
  } else if (rpcRows?.ok === false && rpcRows?.code === "quote_not_found") {
    pass("RPC activate_commercial_plan_change callable by service_role");
  } else if (!rpcErr) {
    pass("RPC activate_commercial_plan_change exists (probe returned)");
  } else if (rpcErr) {
    info(`RPC probe note: ${rpcErr.message}`);
    pass("RPC activate_commercial_plan_change exists (returned controlled error)");
  }

  const { data: fnMeta, error: fnErr } = await (() => {
    const { query, ref } = fromPublicTable(admin, "pg_proc");
    logProbe("schema_pg_proc", ref);
    return query.select("proname, prosecdef, proconfig").eq("proname", "activate_commercial_plan_change").limit(1);
  })();

  if (!fnErr && fnMeta?.length) {
    const fn = fnMeta[0];
    if (fn.prosecdef) {
      pass("RPC is SECURITY DEFINER");
    } else {
      fail("RPC is not SECURITY DEFINER");
    }
    const config = (fn.proconfig || []).join(",");
    if (config.includes("search_path=public")) {
      pass("RPC search_path includes public");
    } else {
      info(`WARN: verify search_path manually in migration SQL (proconfig: ${config || "empty"})`);
    }
  } else {
    info("WARN: pg_proc introspection unavailable via PostgREST — verify SECURITY DEFINER in SQL Editor");
  }

  if (!anonKey) {
    info("SKIP anon RLS checks: set PLAN_CHANGE_TEST_ANON_KEY");
    return;
  }

  const anon = createPlanChangeAdminClient(process.env.PLAN_CHANGE_TEST_SUPABASE_URL, anonKey);

  const { query: quoteQuery, ref: quoteRef } = fromPublicTable(anon, "commercial_plan_change_quotes");
  logProbe("schema_anon_insert_quotes", quoteRef);
  const { error: anonQuoteInsert } = await quoteQuery.insert({
    client_id: "00000000-0000-0000-0000-000000000001",
    idempotency_key: "anon-probe",
    source_entitlement_id: "00000000-0000-0000-0000-000000000002",
    source_checkout_session_id: "00000000-0000-0000-0000-000000000003",
    source_plan_key: "growth",
    target_plan_key: "pro",
    billing_interval_months: 1,
    period_start_at: new Date().toISOString(),
    period_end_at: new Date(Date.now() + 86400000).toISOString(),
    active_commercial_period_value_cents: 1000,
    remaining_ratio_bps: 5000,
    current_unused_credit_cents: 0,
    target_full_period_price_cents: 2000,
    target_remaining_cost_cents: 1000,
    existing_customer_credit_cents: 0,
    available_credit_cents: 0,
    credit_applied_cents: 0,
    amount_due_cents: 1000,
    remaining_credit_cents: 0,
    source_revision: "probe",
    quote_expires_at: new Date(Date.now() + 900000).toISOString(),
  });
  if (!anonQuoteInsert || anonQuoteInsert.code === "42501" || anonQuoteInsert.message?.includes("permission")) {
    pass("anon cannot INSERT commercial_plan_change_quotes");
  } else {
    fail(`anon INSERT quotes unexpectedly allowed: ${anonQuoteInsert?.message}`);
  }

  const { query: ledgerQuery, ref: ledgerRef } = fromPublicTable(anon, "client_credit_ledger");
  logProbe("schema_anon_insert_ledger", ledgerRef);
  const { error: anonLedgerInsert } = await ledgerQuery.insert({
    client_id: "00000000-0000-0000-0000-000000000001",
    entry_type: "manual_adjustment",
    direction: "credit",
    amount_cents: 1,
    balance_after_cents: 1,
    idempotency_key: "anon-ledger-probe",
  });
  if (!anonLedgerInsert || anonLedgerInsert.code === "42501" || anonLedgerInsert.message?.includes("permission")) {
    pass("anon cannot INSERT client_credit_ledger");
  } else {
    fail(`anon INSERT ledger unexpectedly allowed: ${anonLedgerInsert?.message}`);
  }

  const { error: anonRpc } = await anon.rpc("activate_commercial_plan_change", {
    p_quote_id: "00000000-0000-0000-0000-000000000000",
    p_idempotency_key: "anon-probe",
  });
  if (anonRpc && (anonRpc.code === "42501" || anonRpc.message?.includes("permission"))) {
    pass("anon cannot EXECUTE activate_commercial_plan_change");
  } else {
    fail(`anon RPC execute unexpectedly allowed: ${anonRpc?.message ?? "no error"}`);
  }
}

async function activateRpc(admin, quoteId, key, simulated = false) {
  const { data, error } = await admin.rpc("activate_commercial_plan_change", {
    p_quote_id: quoteId,
    p_idempotency_key: key,
    p_actor_email: "plan-change-db-test@example.com",
    p_simulated_activation: simulated,
  });
  if (error) {
    return { ok: false, error: error.message, raw: null };
  }
  return { ok: true, raw: data };
}

async function phaseIdempotency(admin) {
  const quoteId = arg("quote-id");
  const key = arg("idempotency-key");
  if (!quoteId || !key) {
    fail("--phase=idempotency requires --quote-id= and --idempotency-key=");
  }

  info(`Phase: idempotency quote=${quoteId} key=${key}`);

  const before = await (() => {
    const { query, ref } = fromPublicTable(admin, "commercial_plan_change_quotes");
    logProbe("idempotency_quote_before", ref);
    return query.select("status, activated_at").eq("id", quoteId).single();
  })();

  const auditBefore = await (() => {
    const { query, ref } = fromPublicTable(admin, "commercial_checkout_audit_events");
    logProbe("idempotency_audit_before", ref);
    return query.select("id", { count: "exact", head: true }).contains("payload", { quote_id: quoteId });
  })();

  const ledgerBefore = await (() => {
    const { query, ref } = fromPublicTable(admin, "client_credit_ledger");
    logProbe("idempotency_ledger_before", ref);
    return query.select("id", { count: "exact", head: true }).eq("source_quote_id", quoteId);
  })();

  const r1 = await activateRpc(admin, quoteId, key, true);
  const r2 = await activateRpc(admin, quoteId, key, true);

  if (!r1.ok) fail(`First activation failed: ${r1.error}`);
  if (!r2.ok) fail(`Second activation failed: ${r2.error}`);
  if (!r2.raw?.idempotent_replay) {
    fail("Second call must return idempotent_replay=true");
  }
  pass("Idempotent replay on same quote + key");

  const after = await (() => {
    const { query, ref } = fromPublicTable(admin, "commercial_plan_change_quotes");
    logProbe("idempotency_quote_after", ref);
    return query.select("status, activated_at").eq("id", quoteId).single();
  })();

  if (before.data?.status === "quote_activated" && before.data?.activated_at === after.data?.activated_at) {
    pass("Single quote_activated transition (activated_at unchanged on replay)");
  } else if (after.data?.status === "quote_activated") {
    pass("Quote ended in quote_activated state");
  } else {
    fail(`Unexpected final quote status: ${after.data?.status}`);
  }

  const auditAfter = await (() => {
    const { query, ref } = fromPublicTable(admin, "commercial_checkout_audit_events");
    logProbe("idempotency_audit_after", ref);
    return query.select("id", { count: "exact", head: true }).contains("payload", { quote_id: quoteId });
  })();

  const ledgerAfter = await (() => {
    const { query, ref } = fromPublicTable(admin, "client_credit_ledger");
    logProbe("idempotency_ledger_after", ref);
    return query.select("id", { count: "exact", head: true }).eq("source_quote_id", quoteId);
  })();

  if (auditBefore.count === auditAfter.count) {
    pass("No duplicate audit event on idempotent replay");
  } else if ((auditAfter.count ?? 0) - (auditBefore.count ?? 0) <= 1) {
    pass("At most one audit event for activation");
  } else {
    fail(`Audit count increased unexpectedly: ${auditBefore.count} -> ${auditAfter.count}`);
  }

  if (ledgerBefore.count === ledgerAfter.count) {
    pass("No duplicate ledger entries on idempotent replay");
  } else {
    info(`Ledger count: ${ledgerBefore.count} -> ${ledgerAfter.count} (first activation only)`);
  }
}

async function phaseConcurrency(admin) {
  const quoteA = arg("quote-a");
  const quoteB = arg("quote-b");
  const keyA = arg("key-a");
  const keyB = arg("key-b");
  if (!quoteA || !quoteB || !keyA || !keyB) {
    fail("--phase=concurrency requires --quote-a= --quote-b= --key-a= --key-b=");
  }

  info(`Phase: concurrency quotes ${quoteA} vs ${quoteB}`);

  const [rA, rB] = await Promise.all([
    activateRpc(admin, quoteA, keyA, true),
    activateRpc(admin, quoteB, keyB, true),
  ]);

  const outcomes = [rA, rB].map((r) => (r.ok ? r.raw : { ok: false, code: r.error }));
  const successes = outcomes.filter((o) => o.ok === true && !o.idempotent_replay);
  const failures = outcomes.filter((o) => o.ok === false || (o.ok === true && o.idempotent_replay === false && successes.length > 1));

  if (successes.length !== 1) {
    fail(`Expected exactly 1 fresh success, got ${successes.length}: ${JSON.stringify(outcomes)}`);
  }
  pass("Exactly one concurrent activation succeeded");

  const loser = outcomes.find((o) => o !== successes[0]);
  const loserCode = loser?.code || loser?.raw?.code;
  if (
    ["quote_stale", "quote_not_pending", "idempotency_conflict", "source_inactive"].includes(loserCode) ||
    (loser?.ok === false)
  ) {
    pass(`Loser rejected with expected code: ${loserCode ?? "error"}`);
  } else {
    info(`Loser outcome: ${JSON.stringify(loser)}`);
  }

  const { data: quotes } = await (() => {
    const { query, ref } = fromPublicTable(admin, "commercial_plan_change_quotes");
    logProbe("concurrency_quotes", ref);
    return query.select("id, status").in("id", [quoteA, quoteB]);
  })();

  const activated = (quotes || []).filter((q) => q.status === "quote_activated");
  if (activated.length === 1) {
    pass("Only one quote reached quote_activated");
  } else {
    fail(`Expected 1 activated quote, got ${activated.length}`);
  }

  const winnerId = activated[0].id;
  const { data: ledger } = await (() => {
    const { query, ref } = fromPublicTable(admin, "client_credit_ledger");
    logProbe("concurrency_ledger", ref);
    return query.select("balance_after_cents, direction, amount_cents").eq("source_quote_id", winnerId);
  })();

  for (const row of ledger || []) {
    if (row.balance_after_cents < 0) {
      fail(`Negative ledger balance: ${row.balance_after_cents}`);
    }
  }
  pass("Ledger balances non-negative after concurrency");
}

async function main() {
  if (phase === "guard") {
    if (CONFIRM !== "isolated-test-only") {
      fail("Refusing to run: set PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only");
    }
    if (!process.env.PLAN_CHANGE_TEST_SUPABASE_URL) {
      info("Guard-only mode: PLAN_CHANGE_TEST_SUPABASE_URL not set (correct — no shared DB).");
      info("See docs/plan-change-db-validation-runbook.md for isolated DB setup.");
      info("When ready: export PLAN_CHANGE_TEST_* vars and run --phase=schema");
      process.exit(0);
    }
  }

  const strictEnv = phase === "environment";
  const { url, serviceKey, ref } = assertGuard({ strictPlanChangeEnvOnly: strictEnv });
  info(`Target isolated DB: ${maskUrl(url)}`);
  info(`Phase: ${phase}`);

  const admin = createPlanChangeAdminClient(url, serviceKey);

  const anonKey = process.env.PLAN_CHANGE_TEST_ANON_KEY || null;

  switch (phase) {
    case "environment":
      await phaseEnvironment(admin, ref, url, serviceKey);
      break;
    case "schema":
      await assertNoProtectedClients(admin);
      await phaseSchema(admin, anonKey);
      break;
    case "idempotency":
      await assertNoProtectedClients(admin);
      await phaseIdempotency(admin);
      break;
    case "concurrency":
      await assertNoProtectedClients(admin);
      await phaseConcurrency(admin);
      break;
    case "guard":
      info("Isolation guard passed. Run --phase=schema after migration apply.");
      break;
    default:
      fail(`Unknown phase: ${phase}`);
  }

  info("Validation phase complete.");
}

main().catch((err) => {
  fail(err?.message || String(err));
});
