#!/usr/bin/env node
/**
 * Official email-only sync for Instagram login email into ig_account_settings.email.
 * Uses the same validation/persistence rules as persistAccountLoginEmail (settings_sync).
 *
 * Usage:
 *   LOGIN_EMAIL="user@example.com" node scripts/sync-account-login-email.mjs --dry-run
 *   LOGIN_EMAIL="user@example.com" node scripts/sync-account-login-email.mjs --apply
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   LOGIN_EMAIL or I_MY_YOUR_TRAKER_LOGIN_EMAIL (required for --apply)
 *   ACCOUNT_ID (default: 83de9cc9-5c37-42d1-9edc-c924352b17b1)
 *   IG_USERNAME (optional lookup if ACCOUNT_ID omitted)
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_ACCOUNT_ID = "83de9cc9-5c37-42d1-9edc-c924352b17b1";

function readEnv(name, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseArgs(argv) {
  return {
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    apply: argv.includes("--apply"),
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

function normalizeSafeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (["password", "secret", "token", "authorization", "service_role"].some((term) => email.includes(term))) {
    return null;
  }
  return email;
}

async function resolveAccountId(supabase, accountId, igUsername) {
  if (accountId) return accountId;
  if (!igUsername) throw new Error("ACCOUNT_ID or IG_USERNAME is required");
  const { data, error } = await supabase
    .from("ig_accounts")
    .select("id,username")
    .ilike("username", igUsername.replace(/^@+/, ""))
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`ig_accounts lookup failed: ${error.message}`);
  if (!data?.id) throw new Error(`Instagram account @${igUsername} not found`);
  return String(data.id);
}

async function persistLoginEmail(supabase, accountId, email) {
  const { data: existing, error: lookupError } = await supabase
    .from("ig_account_settings")
    .select("account_id,email")
    .eq("account_id", accountId)
    .maybeSingle();
  if (lookupError) throw new Error(`ig_account_settings lookup failed: ${lookupError.message}`);

  if (!existing?.account_id) {
    const { data: account, error: accountError } = await supabase
      .from("ig_accounts")
      .select("username")
      .eq("id", accountId)
      .maybeSingle();
    if (accountError || !account) throw new Error("account_not_found_for_settings_insert");

    const { error: insertError } = await supabase.from("ig_account_settings").insert({
      account_id: accountId,
      username: account.username || "",
      email,
      password: "",
      account_status: "active",
      dry_run_enabled: true,
    });
    if (insertError) throw new Error(`ig_account_settings insert failed: ${insertError.message}`);
  } else {
    const { error: updateError } = await supabase
      .from("ig_account_settings")
      .update({ email })
      .eq("account_id", accountId);
    if (updateError) throw new Error(`ig_account_settings update failed: ${updateError.message}`);
  }
}

async function main() {
  loadDotEnv(join(ROOT, ".env.local"));
  const { dryRun, apply } = parseArgs(process.argv.slice(2));
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const rawEmail = readEnv("LOGIN_EMAIL") || readEnv("I_MY_YOUR_TRAKER_LOGIN_EMAIL");
  const email = normalizeSafeEmail(rawEmail);
  const accountId = await resolveAccountId(
    createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } }),
    readEnv("ACCOUNT_ID", DEFAULT_ACCOUNT_ID),
    readEnv("IG_USERNAME"),
  );
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: account } = await supabase
    .from("ig_accounts")
    .select("id,username")
    .eq("id", accountId)
    .maybeSingle();
  if (!account?.id) throw new Error(`account ${accountId} not found`);

  const { data: settingsBefore } = await supabase
    .from("ig_account_settings")
    .select("email")
    .eq("account_id", accountId)
    .maybeSingle();

  const plan = {
    mode: dryRun ? "dry-run" : apply ? "apply" : "dry-run",
    account_id: accountId,
    username: account.username,
    email_present_in_request: Boolean(rawEmail),
    email_valid: Boolean(email),
    email_available_before: Boolean(normalizeSafeEmail(settingsBefore?.email)),
    mutation_scope: ["ig_account_settings.email"],
    untouched: ["password", "secret_ref", "account_credentials", "account_assignments", "clients", "packages"],
  };

  console.log(JSON.stringify(plan, null, 2));

  if (!rawEmail) {
    console.error("STOP: set LOGIN_EMAIL or I_MY_YOUR_TRAKER_LOGIN_EMAIL with the real Instagram login email.");
    process.exit(1);
  }
  if (!email) {
    console.error("STOP: provided email is empty or invalid.");
    process.exit(1);
  }

  if (dryRun) {
    console.log("Dry run only. Re-run with --apply to persist ig_account_settings.email.");
    return;
  }

  await persistLoginEmail(supabase, accountId, email);

  const { data: settingsAfter } = await supabase
    .from("ig_account_settings")
    .select("email")
    .eq("account_id", accountId)
    .maybeSingle();

  const report = {
    ok: true,
    account_id: accountId,
    username: account.username,
    email_available_after: Boolean(normalizeSafeEmail(settingsAfter?.email)),
    email_source: "ig_account_settings",
  };
  mkdirSync(join(ROOT, "runs"), { recursive: true });
  writeFileSync(join(ROOT, "runs", "sync-account-login-email.apply.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
