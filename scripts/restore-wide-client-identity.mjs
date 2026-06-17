#!/usr/bin/env node
/**
 * Restore internal identity on the wide test/holding client after accidental Liam Ekwa rename.
 *
 * Usage:
 *   node scripts/restore-wide-client-identity.mjs --dry-run
 *   node scripts/restore-wide-client-identity.mjs --apply --after-dry-run
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional: WIDE_CLIENT_ID, RESTORE_CLIENT_NAME
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DRY_RUN_REPORT = join(ROOT, "runs", "restore-wide-client-identity.dry-run.json");
const APPLY_REPORT = join(ROOT, "runs", "restore-wide-client-identity.apply.json");

const DEFAULTS = {
  wideClientId: "00000000-0000-4000-8000-000000002e2a",
  dedicatedClientId: "c37c9143-ee14-4c9a-9a60-226759241733",
  restoreName: "Entry 2A Test Client",
  targetUsername: "i_m_your_traker",
  expectedWideAccountCount: 6,
};

const EXPECTED_WIDE_USERNAMES = [
  "botapp",
  "cinema_catchup",
  "growth_with_bmb",
  "j_automatise_pour_toi",
  "liam_bel_epee",
  "lorielebras_autom",
];

function readEnv(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    apply: argv.includes("--apply"),
    afterDryRun: argv.includes("--after-dry-run"),
  };
}

function loadDotEnv(path) {
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split("\n")) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^"|"$/g, "");
    }
  } catch {
    // optional
  }
}

function fingerprintClient(row) {
  return createHash("sha256").update(JSON.stringify({
    id: row?.id,
    name: row?.name,
    metadata: row?.metadata ?? {},
  })).digest("hex");
}

function scrubMetadata(metadata) {
  const base = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? { ...metadata }
    : {};
  for (const key of ["first_name", "last_name", "display_name", "contact_email", "phone"]) {
    delete base[key];
  }
  return {
    ...base,
    display_name: readEnv("RESTORE_CLIENT_NAME", DEFAULTS.restoreName),
    source: "internal_test_client",
    holding_pool: true,
  };
}

function rollbackSql(backup) {
  const metadataJson = JSON.stringify(backup.metadata ?? {}).replace(/'/g, "''");
  const name = String(backup.name ?? "").replace(/'/g, "''");
  return `-- Rollback restore-wide-client-identity.mjs
UPDATE clients
SET name = '${name}', metadata = '${metadataJson}'::jsonb
WHERE id = '${backup.id}';`;
}

async function loadClientAccounts(supabase, clientId) {
  const { data: links, error } = await supabase
    .from("client_instagram_accounts")
    .select("account_id")
    .eq("client_id", clientId);
  if (error) throw new Error(`client_instagram_accounts lookup failed: ${error.message}`);
  const accountIds = (links ?? []).map((row) => String(row.account_id)).filter(Boolean);
  if (!accountIds.length) return [];
  const { data: accounts, error: accountsError } = await supabase
    .from("ig_accounts")
    .select("id,username,status,admin_lifecycle_status")
    .in("id", accountIds);
  if (accountsError) throw new Error(`ig_accounts lookup failed: ${accountsError.message}`);
  return (accounts ?? []).sort((a, b) => String(a.username).localeCompare(String(b.username)));
}

async function auditState(supabase, config) {
  const [{ data: wideClient }, { data: dedicatedClient }] = await Promise.all([
    supabase.from("clients").select("id,name,status,metadata,created_at,updated_at").eq("id", config.wideClientId).maybeSingle(),
    supabase.from("clients").select("id,name,status,metadata").eq("id", config.dedicatedClientId).maybeSingle(),
  ]);
  if (!wideClient?.id) throw new Error("wide client not found");
  if (!dedicatedClient?.id) throw new Error("dedicated client not found");

  const [wideAccounts, dedicatedAccounts] = await Promise.all([
    loadClientAccounts(supabase, config.wideClientId),
    loadClientAccounts(supabase, config.dedicatedClientId),
  ]);

  const wideUsernames = wideAccounts.map((row) => String(row.username));
  const dedicatedUsernames = dedicatedAccounts.map((row) => String(row.username));
  const nextMetadata = scrubMetadata(wideClient.metadata);

  return {
    config,
    wideClient,
    dedicatedClient,
    wideAccounts,
    dedicatedAccounts,
    wideUsernames,
    dedicatedUsernames,
    nextMetadata,
    nextName: config.restoreName,
    fingerprint: fingerprintClient(wideClient),
    checks: {
      wideCurrentlyLiam: String(wideClient.name) === "Liam Ekwa",
      dedicatedStillLiam: String(dedicatedClient.name) === "Liam Ekwa",
      dedicatedSingleAccount: dedicatedUsernames.length === 1 && dedicatedUsernames[0] === config.targetUsername,
      wideHasSixAccounts: wideUsernames.length === config.expectedWideAccountCount,
      wideMissingTarget: !wideUsernames.includes(config.targetUsername),
      wideUsernamesMatch: EXPECTED_WIDE_USERNAMES.every((username) => wideUsernames.includes(username)),
    },
    backup: {
      id: wideClient.id,
      name: wideClient.name,
      metadata: wideClient.metadata ?? {},
    },
    rollbackSql: rollbackSql({
      id: wideClient.id,
      name: wideClient.name,
      metadata: wideClient.metadata ?? {},
    }),
    mutation: {
      table: "clients",
      id: config.wideClientId,
      set: {
        name: config.restoreName,
        metadata: nextMetadata,
      },
    },
  };
}

function assertPreApply(state) {
  const failures = [];
  if (!state.checks.wideCurrentlyLiam) failures.push("wide client is not currently named Liam Ekwa");
  if (!state.checks.dedicatedStillLiam) failures.push("dedicated client is not Liam Ekwa");
  if (!state.checks.dedicatedSingleAccount) failures.push("dedicated client does not contain only i_m_your_traker");
  if (!state.checks.wideHasSixAccounts) failures.push(`wide client account count is ${state.wideUsernames.length}, expected ${state.config.expectedWideAccountCount}`);
  if (!state.checks.wideMissingTarget) failures.push("i_m_your_traker is still linked to wide client");
  if (!state.checks.wideUsernamesMatch) failures.push("wide client account set does not match expected 6 usernames");
  if (failures.length) throw new Error(`pre-apply checks failed: ${failures.join("; ")}`);
}

async function assertPostApply(supabase, config) {
  const state = await auditState(supabase, config);
  const failures = [];
  if (String(state.wideClient.name) !== config.restoreName) failures.push("wide client name not restored");
  if (String(state.dedicatedClient.name) !== "Liam Ekwa") failures.push("dedicated client name changed");
  if (state.dedicatedUsernames.length !== 1 || state.dedicatedUsernames[0] !== config.targetUsername) {
    failures.push("dedicated client account set changed");
  }
  if (state.wideUsernames.length !== config.expectedWideAccountCount) failures.push("wide client account count changed");
  if (state.wideUsernames.includes(config.targetUsername)) failures.push("target account reappeared on wide client");

  const meta = state.wideClient.metadata && typeof state.wideClient.metadata === "object" ? state.wideClient.metadata : {};
  if (meta.first_name === "Liam" || meta.last_name === "Ekwa") failures.push("wide metadata still contains Liam identity");
  if (String(meta.contact_email || "").toLowerCase().includes("ekwax@yahoo.fr")) failures.push("wide metadata still contains tenant contact email");
  if (meta.holding_pool !== true) failures.push("wide metadata missing holding_pool=true");
  if (meta.source !== "internal_test_client") failures.push("wide metadata source not internal_test_client");

  const { data: settings } = await supabase
    .from("ig_account_settings")
    .select("email")
    .eq("account_id", state.dedicatedAccounts[0]?.id)
    .maybeSingle();
  if (!settings?.email) failures.push("dedicated account email missing after apply");

  if (failures.length) throw new Error(`post-apply checks failed: ${failures.join("; ")}`);
  return state;
}

async function main() {
  loadDotEnv(join(ROOT, ".env.local"));
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const config = {
    wideClientId: readEnv("WIDE_CLIENT_ID", DEFAULTS.wideClientId),
    dedicatedClientId: DEFAULTS.dedicatedClientId,
    restoreName: readEnv("RESTORE_CLIENT_NAME", DEFAULTS.restoreName),
    targetUsername: DEFAULTS.targetUsername,
    expectedWideAccountCount: DEFAULTS.expectedWideAccountCount,
  };

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const state = await auditState(supabase, config);
  assertPreApply(state);

  const report = {
    mode: args.dryRun ? "dry-run" : "apply",
    generatedAt: new Date().toISOString(),
    fingerprint: state.fingerprint,
    checks: state.checks,
    backup: state.backup,
    mutation: state.mutation,
    wideUsernames: state.wideUsernames,
    dedicatedUsernames: state.dedicatedUsernames,
    rollbackSql: state.rollbackSql,
  };

  mkdirSync(join(ROOT, "runs"), { recursive: true });
  if (args.dryRun) {
    writeFileSync(DRY_RUN_REPORT, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report, null, 2));
    console.log("Dry run only. Re-run with --apply --after-dry-run to persist.");
    return;
  }

  if (args.afterDryRun) {
    const previous = JSON.parse(readFileSync(DRY_RUN_REPORT, "utf8"));
    if (previous.fingerprint !== state.fingerprint) {
      throw new Error("Dry-run fingerprint mismatch. Re-run --dry-run before --apply.");
    }
  } else {
    throw new Error("Apply blocked. Run --dry-run then --apply --after-dry-run.");
  }

  const { error } = await supabase
    .from("clients")
    .update({
      name: state.nextName,
      metadata: state.nextMetadata,
    })
    .eq("id", config.wideClientId)
    .eq("name", "Liam Ekwa");

  if (error) throw new Error(`clients update failed: ${error.message}`);

  const post = await assertPostApply(supabase, config);
  const applyReport = {
    ok: true,
    appliedAt: new Date().toISOString(),
    rowsUpdated: 1,
    wideClient: { id: post.wideClient.id, name: post.wideClient.name },
    dedicatedClient: { id: post.dedicatedClient.id, name: post.dedicatedClient.name },
    wideUsernames: post.wideUsernames,
    dedicatedUsernames: post.dedicatedUsernames,
    rollbackSql: state.rollbackSql,
  };
  writeFileSync(APPLY_REPORT, `${JSON.stringify(applyReport, null, 2)}\n`);
  console.log(JSON.stringify(applyReport, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
