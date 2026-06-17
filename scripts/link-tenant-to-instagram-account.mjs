#!/usr/bin/env node
/**
 * Idempotent step-1 linker: attach an existing tenant login to the client that owns an IG account.
 *
 * Usage:
 *   node scripts/link-tenant-to-instagram-account.mjs --dry-run
 *   node scripts/link-tenant-to-instagram-account.mjs --apply
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional env overrides:
 *   LINK_TENANT_USER_ID, LINK_IG_USERNAME, LINK_CLIENT_ID
 */

import { createClient } from "@supabase/supabase-js";

const DEFAULT_IG_USERNAME = "i_m_your_traker";
const DEFAULT_TENANT_USER_ID = "1966b077-82be-47a9-ae38-52dbfd22c586";
const DEFAULT_CLIENT_ID = "00000000-0000-4000-8000-000000002e2a";

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

async function main() {
  const { dryRun, apply } = parseArgs(process.argv.slice(2));
  const supabaseUrl = readEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const tenantUserId = readEnv("LINK_TENANT_USER_ID", DEFAULT_TENANT_USER_ID);
  const igUsername = readEnv("LINK_IG_USERNAME", DEFAULT_IG_USERNAME).replace(/^@+/, "");
  const expectedClientId = readEnv("LINK_CLIENT_ID", DEFAULT_CLIENT_ID);
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: account, error: accountError } = await supabase
    .from("ig_accounts")
    .select("id,username,status,admin_lifecycle_status")
    .ilike("username", igUsername)
    .limit(1)
    .maybeSingle();
  if (accountError) throw new Error(`ig_accounts lookup failed: ${accountError.message}`);
  if (!account?.id) throw new Error(`Instagram account @${igUsername} not found`);

  const { data: link, error: linkError } = await supabase
    .from("client_instagram_accounts")
    .select("id,client_id,account_id,onboarding_status,provisioning_status,login_status")
    .eq("account_id", account.id)
    .limit(1)
    .maybeSingle();
  if (linkError) throw new Error(`client_instagram_accounts lookup failed: ${linkError.message}`);
  if (!link?.client_id) throw new Error(`@${igUsername} is not linked to any client`);

  const clientId = String(link.client_id);
  if (expectedClientId && clientId !== expectedClientId) {
    throw new Error(`Account is linked to ${clientId}, expected ${expectedClientId}. Aborting to avoid moving ownership.`);
  }

  const { data: tenantUser, error: tenantError } = await supabase
    .from("tenant_users")
    .select("user_id,tenant_id,role")
    .eq("user_id", tenantUserId)
    .limit(1)
    .maybeSingle();
  if (tenantError) throw new Error(`tenant_users lookup failed: ${tenantError.message}`);
  if (!tenantUser?.user_id) throw new Error(`tenant user ${tenantUserId} not found`);

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id,name,status")
    .eq("id", clientId)
    .limit(1)
    .maybeSingle();
  if (clientError) throw new Error(`clients lookup failed: ${clientError.message}`);
  if (!client?.id || client.status !== "active") throw new Error(`Client ${clientId} is missing or not active`);

  const { data: existingMembership } = await supabase
    .from("client_users")
    .select("id,client_id,role,status")
    .eq("auth_user_id", tenantUserId)
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle();

  const { data: canManageBefore } = await supabase.rpc("client_can_manage_instagram_account", {
    p_auth_user_id: tenantUserId,
    p_account_id: account.id,
  });

  const plan = {
    mode: dryRun ? "dry-run" : apply ? "apply" : "dry-run",
    tenantUserId,
    igUsername,
    accountId: account.id,
    clientId,
    clientName: client.name,
    tenantIdBefore: tenantUser.tenant_id,
    tenantIdAfter: clientId,
    clientUsersAction: existingMembership?.id
      ? `ensure active membership (${existingMembership.id})`
      : "insert owner membership",
    canManageBefore: Boolean(canManageBefore),
  };

  console.log(JSON.stringify(plan, null, 2));

  if (dryRun) {
    console.log("Dry run only. Re-run with --apply to persist.");
    return;
  }

  if (!existingMembership?.id) {
    const { error: insertError } = await supabase.from("client_users").insert({
      client_id: clientId,
      auth_user_id: tenantUserId,
      role: "owner",
      status: "active",
    });
    if (insertError) throw new Error(`client_users insert failed: ${insertError.message}`);
  } else if (existingMembership.status !== "active") {
    const { error: updateMembershipError } = await supabase
      .from("client_users")
      .update({ status: "active" })
      .eq("id", existingMembership.id);
    if (updateMembershipError) throw new Error(`client_users update failed: ${updateMembershipError.message}`);
  }

  if (tenantUser.tenant_id !== clientId) {
    const { error: tenantUpdateError } = await supabase
      .from("tenant_users")
      .update({ tenant_id: clientId })
      .eq("user_id", tenantUserId);
    if (tenantUpdateError) throw new Error(`tenant_users update failed: ${tenantUpdateError.message}`);
  }

  const { data: canManageAfter } = await supabase.rpc("client_can_manage_instagram_account", {
    p_auth_user_id: tenantUserId,
    p_account_id: account.id,
  });

  console.log(JSON.stringify({
    ok: true,
    canManageAfter: Boolean(canManageAfter),
    rollback: {
      tenant_users: `UPDATE tenant_users SET tenant_id = '${tenantUser.tenant_id ?? ""}' WHERE user_id = '${tenantUserId}';`,
      client_users: existingMembership?.id
        ? null
        : `DELETE FROM client_users WHERE auth_user_id = '${tenantUserId}' AND client_id = '${clientId}';`,
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
