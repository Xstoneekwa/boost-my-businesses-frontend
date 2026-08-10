import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const INITDB = "/opt/homebrew/bin/initdb";
const PG_CTL = "/opt/homebrew/bin/pg_ctl";
const PSQL = "/opt/homebrew/bin/psql";

const IDS = {
  client: "10000000-0000-4000-8000-000000000001",
  actor: "10000000-0000-4000-8000-000000000002",
  admin: "10000000-0000-4000-8000-00000000000f",
  entitlement: "10000000-0000-4000-8000-000000000003",
  subscription: "10000000-0000-4000-8000-000000000004",
  idempotency: "10000000-0000-4000-8000-000000000005",
  attemptA: "10000000-0000-4000-8000-000000000006",
  attemptB: "10000000-0000-4000-8000-000000000007",
  restartKey: "10000000-0000-4000-8000-000000000008",
  rollbackEntitlement: "10000000-0000-4000-8000-000000000009",
  rollbackIdempotency: "10000000-0000-4000-8000-00000000000a",
  rollbackAttempt: "10000000-0000-4000-8000-00000000000b",
  leaseEntitlement: "10000000-0000-4000-8000-00000000000c",
  leaseIdempotency: "10000000-0000-4000-8000-00000000000d",
  leaseAttempt: "10000000-0000-4000-8000-00000000000e",
};

const bootstrap = String.raw`
create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create schema if not exists vault;
create table auth.users (id uuid primary key);

create table public.clients (id uuid primary key, status text not null);
create table public.client_users (
  client_id uuid not null, auth_user_id uuid not null, status text not null, role text not null
);
create table public.tenant_users (user_id uuid primary key, tenant_id uuid null, role text not null);
create table public.client_account_entitlements (
  id uuid primary key, client_id uuid not null, status text not null,
  commercial_package_code text not null, account_id uuid null,
  consumed_at timestamptz null, updated_at timestamptz not null default now()
);
create table public.client_subscriptions (
  id uuid primary key, client_id uuid not null, subscription_type text not null,
  status text not null, starts_at timestamptz not null, ends_at timestamptz null
);
create table public.ig_accounts (
  id uuid primary key default gen_random_uuid(), username text not null, display_name text not null default '',
  status text not null, login_method text not null, avatar_url text null, followers_count integer null,
  is_private boolean null, is_verified boolean null, username_verified_at timestamptz null,
  username_verification_status text null, public_profile_metadata jsonb not null default '{}'::jsonb,
  admin_lifecycle_status text not null default 'active', archived_at timestamptz null, trashed_at timestamptz null
);
create table public.ig_account_settings (
  account_id uuid primary key, username text, display_name text, email text, password text,
  account_status text, app_package text, dry_run_enabled boolean, follow_enabled boolean,
  like_enabled boolean, welcome_dm_enabled boolean, cold_dm_enabled boolean, unfollow_enabled boolean
);
create table public.ig_account_filters (account_id uuid primary key);
create table public.ig_account_follow_settings (account_id uuid primary key);
create table public.ig_account_unfollow_settings (account_id uuid primary key, unfollow_enabled boolean);
create table public.ig_account_dm_settings (account_id uuid primary key, welcome_enabled boolean, outreach_enabled boolean);
create table vault.secrets (id uuid primary key, secret text not null);
create table public.account_credentials (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, client_id uuid not null,
  username_at_submission text, secret_ref text, secret_provider text, credentials_version integer,
  action text, external_request_id text, request_id text, submitted_by uuid, submitted_via text
);
create table public.client_instagram_accounts (
  id uuid primary key default gen_random_uuid(), client_id uuid not null, account_id uuid not null,
  label text, onboarding_status text, provisioning_status text, login_status text,
  login_state_version bigint not null default 0,
  updated_at timestamptz default now(),
  constraint client_instagram_accounts_login_state_version_check check (login_state_version >= 1)
);
create table public.account_commercial_packages (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, package_code text not null,
  status text not null, source text not null, metadata_safe jsonb not null default '{}'::jsonb
);
create table public.client_subscription_accounts (
  id uuid primary key default gen_random_uuid(), subscription_id uuid not null,
  client_instagram_account_id uuid not null, account_id uuid not null, status text not null
);
create table public.commercial_checkout_audit_events (
  id uuid primary key default gen_random_uuid(), entitlement_id uuid null, event_type text not null,
  client_id uuid not null, payload jsonb not null default '{}'::jsonb, created_at timestamptz default now()
);
create table public.ig_targets (
  id uuid primary key default gen_random_uuid(), account_id uuid not null, status text,
  quality_status text, verification_status text, archived_at timestamptz null, deleted_at timestamptz null
);

create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
create or replace function public.create_instagram_credentials_vault_secret(
  p_secret_payload text, p_secret_name text, p_secret_description text
) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into vault.secrets(id, secret) values (v_id, p_secret_payload);
  return v_id;
end $$;
create or replace function public.rotate_instagram_account_credentials(
  p_account_id uuid, p_client_id uuid, p_username_at_submission text, p_secret_ref text,
  p_secret_provider text, p_credentials_version integer, p_action text,
  p_external_request_id text, p_request_id text, p_submitted_by uuid, p_submitted_via text
) returns public.account_credentials language plpgsql as $$
declare v_row public.account_credentials;
begin
  insert into public.account_credentials(
    account_id, client_id, username_at_submission, secret_ref, secret_provider,
    credentials_version, action, external_request_id, request_id, submitted_by, submitted_via
  ) values (
    p_account_id, p_client_id, p_username_at_submission, p_secret_ref, p_secret_provider,
    p_credentials_version, p_action, p_external_request_id, p_request_id, p_submitted_by, p_submitted_via
  ) returning * into v_row;
  return v_row;
end $$;

insert into public.clients values ('${IDS.client}', 'active');
insert into auth.users values ('${IDS.actor}');
insert into auth.users values ('${IDS.admin}');
insert into public.client_users values ('${IDS.client}', '${IDS.actor}', 'active', 'owner');
insert into public.tenant_users values ('${IDS.admin}', null, 'superadmin');
insert into public.client_account_entitlements(id, client_id, status, commercial_package_code)
values ('${IDS.entitlement}', '${IDS.client}', 'entitlement_reserved', 'pro'),
       ('${IDS.rollbackEntitlement}', '${IDS.client}', 'entitlement_reserved', 'growth'),
       ('${IDS.leaseEntitlement}', '${IDS.client}', 'entitlement_reserved', 'premium');
insert into public.client_subscriptions values (
  '${IDS.subscription}', '${IDS.client}', 'full_cycle', 'active', now() - interval '1 day', null
);
`;

function psqlArgs(port, sql) {
  return [
    "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres",
    "-c", `set statement_timeout = '12s'; set lock_timeout = '8s'; ${sql}`,
  ];
}

async function query(port, sql) {
  const { stdout } = await execFileAsync(PSQL, psqlArgs(port, sql));
  return stdout.trim();
}

function concurrentQuery(port, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn(PSQL, psqlArgs(port, sql), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || `psql exited ${code}`)));
  });
}

function beginSql(attemptId) {
  return `select public.begin_instagram_account_onboarding_v1(
    '${IDS.client}', 'client', '${IDS.actor}', 'client_dashboard',
    '${IDS.entitlement}', '${IDS.idempotency}', '${attemptId}',
    'postgres-concurrency-test', 'atomic_test_account', '', 'not-a-real-password',
    '{"username":"atomic_test_account","lookupStatus":"found","followersCount":42}'::jsonb,
    '{"scheduleMode":"scheduled","deviceId":"deferred-device"}'::jsonb
  )::text`;
}

async function count(port, table, where = "true") {
  return Number(await query(port, `select count(*) from ${table} where ${where}`));
}

test("PostgreSQL RPC is atomic, concurrent, resumable, and enforces the DB target count", { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "client-onboarding-pg-"));
  const dataDir = path.join(root, "data");
  const socketDir = path.join(root, "socket");
  const serverLog = path.join(root, "postgres.log");
  const port = 55432 + Math.floor(Math.random() * 500);
  await execFileAsync(INITDB, ["-D", dataDir, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await execFileAsync("/bin/mkdir", ["-p", socketDir]);
  await execFileAsync(PG_CTL, ["-D", dataDir, "-l", serverLog, "-o", `-p ${port} -k ${socketDir}`, "-w", "start"]);
  t.after(async () => {
    await execFileAsync(PG_CTL, ["-D", dataDir, "-m", "fast", "-w", "stop"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  const bootstrapPath = path.join(root, "bootstrap.sql");
  const migrationPath = new URL("../../supabase/migrations/20260721120000_client_instagram_onboarding_sessions.sql", import.meta.url);
  const protectionMigrationPath = new URL("../../supabase/migrations/20260726041500_account_protection_lists_v1.sql", import.meta.url);
  const protectionIndexesPath = new URL("../../supabase/migrations/20260726044000_account_protection_lists_v1_fk_indexes.sql", import.meta.url);
  const protectionRuntimePath = new URL("../../supabase/migrations/20260726050000_account_protection_lists_onboarding_and_worker_snapshot.sql", import.meta.url);
  const atomicProtectionPath = new URL("../../supabase/migrations/20260726150027_atomic_onboarding_protection_lists.sql", import.meta.url);
  const canonicalMigrationPath = new URL("../../supabase/migrations/20260809210000_canonical_instagram_account_onboarding_v1.sql", import.meta.url);
  const canonicalRollbackPath = new URL("../../supabase/rollback/20260809210000_canonical_instagram_account_onboarding_v1.down.sql", import.meta.url);
  const loginStateInitialVersionPath = new URL("../../supabase/migrations/20260811005500_onboarding_login_state_initial_version_v1.sql", import.meta.url);
  await writeFile(bootstrapPath, bootstrap);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", bootstrapPath]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", migrationPath.pathname]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", protectionMigrationPath.pathname]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", protectionIndexesPath.pathname]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", protectionRuntimePath.pathname]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", atomicProtectionPath.pathname]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", canonicalMigrationPath.pathname]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", loginStateInitialVersionPath.pathname]);
  t.diagnostic("temporary PostgreSQL schema ready");

  const adminAuth = JSON.parse(await query(port, `select public.authorize_instagram_account_onboarding_actor_v1(
    '${IDS.client}', 'admin', '${IDS.admin}', 'admin_dashboard'
  )::text`));
  assert.equal(adminAuth.ok, true);
  assert.equal(adminAuth.effective_client_actor_id, IDS.actor);
  const invalidActorPair = JSON.parse(await query(port, `select public.authorize_instagram_account_onboarding_actor_v1(
    '${IDS.client}', 'admin', '${IDS.admin}', 'botapp'
  )::text`));
  assert.equal(invalidActorPair.ok, false);
  assert.equal(invalidActorPair.reason, "onboarding_actor_access_denied");

  const [first, second] = await Promise.all([
    concurrentQuery(port, beginSql(IDS.attemptA)),
    concurrentQuery(port, beginSql(IDS.attemptB)),
  ]);
  const beginResults = [JSON.parse(first), JSON.parse(second)];
  t.diagnostic("concurrent begin completed");
  assert.equal(beginResults.every((result) => result.ok === true), true);
  assert.equal(await count(port, "public.ig_accounts"), 1);
  assert.equal(await count(port, "public.client_instagram_accounts"), 1);
  assert.equal(await count(port, "public.client_subscription_accounts"), 1);
  assert.equal(await count(port, "public.client_instagram_onboarding_sessions"), 1);
  assert.equal(await count(port, "public.account_credentials"), 1);
  assert.equal(await count(port, "vault.secrets"), 1);
  assert.equal(await count(port, "public.commercial_checkout_audit_events", "event_type = 'client_instagram_onboarding_started'"), 1);
  assert.equal(await count(port, "public.commercial_checkout_audit_events", "event_type = 'canonical_instagram_account_onboarding_started'"), 1);
  assert.equal(await query(port, "select login_state_version from public.client_instagram_accounts limit 1"), "1");
  assert.equal(await query(port, `select actor_type || ':' || source_surface from public.client_instagram_onboarding_sessions where idempotency_key = '${IDS.idempotency}'`), "client:client_dashboard");
  assert.equal(await query(port, `select source_context->>'deviceId' from public.client_instagram_onboarding_sessions where idempotency_key = '${IDS.idempotency}'`), "deferred-device");
  assert.equal(await query(port, `select status from public.client_account_entitlements where id = '${IDS.entitlement}'`), "entitlement_consumed");

  await query(port, `create or replace function public.reject_atomic_failure_link()
    returns trigger language plpgsql as $$
    begin
      if exists (select 1 from public.ig_accounts where id = new.account_id and username = 'atomic_failure') then
        raise exception 'forced_post_vault_failure';
      end if;
      return new;
    end $$;
    create trigger reject_atomic_failure_link
      before insert on public.client_subscription_accounts
      for each row execute function public.reject_atomic_failure_link()`);
  const rollback = JSON.parse(await query(port, `select public.begin_client_instagram_onboarding(
    '${IDS.client}', '${IDS.actor}', '${IDS.rollbackEntitlement}', '${IDS.rollbackIdempotency}', '${IDS.rollbackAttempt}',
    'postgres-rollback-test', 'atomic_failure', '', 'not-a-real-password',
    '{"username":"atomic_failure","lookupStatus":"found","followersCount":8}'::jsonb
  )::text`));
  t.diagnostic("post-Vault failure rolled back");
  assert.equal(rollback.reason, "atomic_provisioning_failed");
  assert.equal(await count(port, "public.ig_accounts"), 1);
  assert.equal(await count(port, "public.account_credentials"), 1);
  assert.equal(await count(port, "vault.secrets"), 1);
  assert.equal(await count(port, "public.client_instagram_accounts"), 1);
  assert.equal(await count(port, "public.client_subscription_accounts"), 1);
  assert.equal(await query(port, `select status from public.client_account_entitlements where id = '${IDS.rollbackEntitlement}'`), "entitlement_reserved");
  assert.equal(await query(port, `select status from public.client_instagram_onboarding_sessions where idempotency_key = '${IDS.rollbackIdempotency}'`), "failed_retryable");
  await query(port, "drop trigger reject_atomic_failure_link on public.client_subscription_accounts");

  const resumed = JSON.parse(await query(port, `select public.begin_client_instagram_onboarding(
    '${IDS.client}', '${IDS.actor}', '${IDS.rollbackEntitlement}', '${IDS.rollbackIdempotency}', gen_random_uuid(),
    'postgres-resume-test', 'atomic_failure', '', 'not-a-real-password',
    '{"username":"atomic_failure","lookupStatus":"found","followersCount":8}'::jsonb
  )::text`));
  t.diagnostic("failed retryable session resumed without duplicate session or entitlement");
  assert.equal(resumed.ok, true);
  assert.equal(await count(port, "public.client_instagram_onboarding_sessions", `idempotency_key = '${IDS.rollbackIdempotency}'`), 1);
  assert.equal(await count(port, "public.client_account_entitlements", `id = '${IDS.rollbackEntitlement}'`), 1);
  assert.equal(await count(port, "public.ig_accounts", "username = 'atomic_failure'"), 1);
  assert.equal(await query(port, `select status from public.client_account_entitlements where id = '${IDS.rollbackEntitlement}'`), "entitlement_consumed");

  await query(port, `insert into public.client_instagram_onboarding_sessions(
    client_id, entitlement_id, created_by, idempotency_key, requested_username, package_code,
    status, current_step, attempt_id, lease_owner, lease_expires_at, expires_at
  ) values (
    '${IDS.client}', '${IDS.leaseEntitlement}', '${IDS.actor}', '${IDS.leaseIdempotency}',
    'leased_account', 'premium', 'creating', 'connection', '${IDS.leaseAttempt}',
    'lease-holder', now() + interval '60 seconds', now() + interval '7 days'
  )`);
  const leased = JSON.parse(await query(port, `select public.begin_client_instagram_onboarding(
    '${IDS.client}', '${IDS.actor}', '${IDS.leaseEntitlement}', '${IDS.leaseIdempotency}', '${IDS.leaseAttempt}',
    'second-lease-holder', 'leased_account', '', 'not-a-real-password',
    '{"username":"leased_account","lookupStatus":"found"}'::jsonb
  )::text`));
  t.diagnostic("active creation lease rejected");
  assert.equal(leased.reason, "creation_lease_active");
  assert.equal(await count(port, "public.ig_accounts", "username = 'leased_account'"), 0);

  const sessionId = await query(port, `select id from public.client_instagram_onboarding_sessions
    where idempotency_key = '${IDS.idempotency}'`);
  const accountId = await query(port, `select account_id from public.client_instagram_onboarding_sessions
    where idempotency_key = '${IDS.idempotency}'`);
  const adminAdvance = JSON.parse(await query(port, `select public.advance_instagram_account_onboarding_v1(
    '${sessionId}', '${IDS.client}', 'admin', '${IDS.admin}', 'admin_dashboard',
    'save_analysis', '{"username":"atomic_test_account"}'::jsonb
  )::text`));
  assert.equal(adminAdvance.ok, true);

  const rolledBackProtection = JSON.parse(await query(port, `select public.save_client_instagram_onboarding_protection_lists(
    '${sessionId}', '${IDS.client}', '${IDS.actor}', 'save',
    array['safe_user']::text[], array['bad name']::text[], 0, 0,
    gen_random_uuid()::text, gen_random_uuid()::text,
    encode(digest('unfollow-rollback', 'sha256'), 'hex'), encode(digest('blacklist-rollback', 'sha256'), 'hex')
  )::text`));
  assert.equal(rolledBackProtection.ok, false);
  assert.equal(rolledBackProtection.rolled_back, true);
  assert.equal(await count(port, "public.account_protection_list_entries", `account_id = '${accountId}'`), 0);
  assert.equal(await count(port, "public.account_protection_list_versions", `account_id = '${accountId}'`), 0);
  assert.equal(await count(port, "public.account_protection_list_events", `account_id = '${accountId}'`), 0);
  assert.equal(await query(port, `select current_step from public.client_instagram_onboarding_sessions where id = '${sessionId}'`), "protection_lists");

  const savedProtection = JSON.parse(await query(port, `select public.save_client_instagram_onboarding_protection_lists(
    '${sessionId}', '${IDS.client}', '${IDS.actor}', 'save',
    array['safe_user']::text[], array['blocked_user']::text[], 0, 0,
    gen_random_uuid()::text, gen_random_uuid()::text,
    encode(digest('unfollow-save', 'sha256'), 'hex'), encode(digest('blacklist-save', 'sha256'), 'hex')
  )::text`));
  assert.equal(savedProtection.ok, true);
  assert.equal(await count(port, "public.account_protection_list_entries", `account_id = '${accountId}' and active`), 2);
  assert.equal(await count(port, "public.account_protection_list_events", `account_id = '${accountId}'`), 2);
  assert.equal(await query(port, `select current_step from public.client_instagram_onboarding_sessions where id = '${sessionId}'`), "targeting");
  await query(port, `select public.advance_client_instagram_onboarding('${sessionId}', '${IDS.client}', '${IDS.actor}', 'save_targeting', '{"niche":"agency"}'::jsonb)`);

  const zero = JSON.parse(await query(port, `select public.advance_client_instagram_onboarding('${sessionId}', '${IDS.client}', '${IDS.actor}', 'complete', '{}'::jsonb)::text`));
  t.diagnostic("zero-target completion rejected");
  assert.equal(zero.reason, "target_minimum_not_met");
  assert.equal(zero.eligible_count, 0);

  await query(port, `insert into public.ig_targets(account_id, status, quality_status, verification_status)
    select '${accountId}', 'valid', 'eligible', 'found' from generate_series(1, 14)`);
  await query(port, `insert into public.ig_targets(account_id, status, quality_status, verification_status, archived_at)
    values ('${accountId}', 'valid', 'eligible', 'found', now()),
           ('${accountId}', 'pending', 'eligible', 'found', null),
           ('${accountId}', 'valid', 'rejected_irrelevant', 'found', null),
           ('${accountId}', 'valid', 'eligible', 'pending', null)`);
  const fourteen = JSON.parse(await query(port, `select public.advance_client_instagram_onboarding('${sessionId}', '${IDS.client}', '${IDS.actor}', 'complete', '{}'::jsonb)::text`));
  t.diagnostic("fourteen-target completion rejected");
  assert.equal(fourteen.reason, "target_minimum_not_met");
  assert.equal(fourteen.eligible_count, 14);

  await query(port, `insert into public.ig_targets(account_id, status, quality_status, verification_status)
    values ('${accountId}', 'active', 'eligible', 'found')`);
  const completeSql = `select public.advance_client_instagram_onboarding('${sessionId}', '${IDS.client}', '${IDS.actor}', 'complete', '{}'::jsonb)::text`;
  const completions = (await Promise.all([concurrentQuery(port, completeSql), concurrentQuery(port, completeSql)])).map(JSON.parse);
  t.diagnostic("concurrent completion completed");
  assert.equal(completions.every((result) => result.ok === true), true);
  assert.equal(await count(port, "public.commercial_checkout_audit_events", "event_type = 'client_instagram_onboarding_completed'"), 1);
  assert.equal(await query(port, `select onboarding_status from public.client_instagram_accounts where account_id = '${accountId}'`), "configured");

  const eventsBeforeSkip = await count(port, "public.account_protection_list_events", `account_id = '${accountId}'`);
  const skipSessionId = await query(port, `insert into public.client_instagram_onboarding_sessions(
    client_id, entitlement_id, account_id, created_by, idempotency_key, requested_username,
    package_code, status, current_step, public_analysis, expires_at
  ) values (
    '${IDS.client}', '${IDS.entitlement}', '${accountId}', '${IDS.actor}', gen_random_uuid(),
    'atomic_test_account', 'pro', 'active', 'protection_lists', '{"username":"atomic_test_account"}',
    now() + interval '7 days'
  ) returning id`);
  const skippedProtection = JSON.parse(await query(port, `select public.save_client_instagram_onboarding_protection_lists(
    '${skipSessionId}', '${IDS.client}', '${IDS.actor}', 'skip',
    array[]::text[], array[]::text[], 0, 0,
    gen_random_uuid()::text, gen_random_uuid()::text,
    encode(digest('skip-u', 'sha256'), 'hex'), encode(digest('skip-b', 'sha256'), 'hex')
  )::text`));
  assert.equal(skippedProtection.ok, true);
  assert.equal(await count(port, "public.account_protection_list_events", `account_id = '${accountId}'`), eventsBeforeSkip);
  assert.equal(await query(port, `select (protection_lists_skipped_at is not null)::text from public.client_instagram_onboarding_sessions where id = '${skipSessionId}'`), "true");
  await query(port, `update public.client_instagram_onboarding_sessions set status = 'abandoned' where id = '${skipSessionId}'`);

  await query(port, `insert into public.client_instagram_onboarding_sessions(
    client_id, entitlement_id, account_id, created_by, idempotency_key, requested_username,
    package_code, status, current_step, public_analysis, targeting_criteria, expires_at
  ) values (
    '${IDS.client}', '${IDS.entitlement}', '${accountId}', '${IDS.actor}', gen_random_uuid(),
    'atomic_test_account', 'pro', 'active', 'targets', '{"username":"atomic_test_account"}', '{"niche":"agency"}',
    now() - interval '1 minute'
  )`);
  assert.equal(await query(port, `select public.expire_client_instagram_onboarding_sessions('${IDS.client}', '${IDS.actor}')`), "1");
  const expiredId = await query(port, "select id from public.client_instagram_onboarding_sessions where status = 'expired' order by created_at desc limit 1");
  const restartSql = `select public.restart_client_instagram_onboarding('${expiredId}', '${IDS.client}', '${IDS.actor}', '${IDS.restartKey}')::text`;
  const restarts = (await Promise.all([concurrentQuery(port, restartSql), concurrentQuery(port, restartSql)])).map(JSON.parse);
  t.diagnostic("concurrent restart completed");
  assert.equal(restarts.every((result) => result.ok === true), true);
  assert.equal(await count(
    port,
    "public.client_instagram_onboarding_sessions",
    `status = 'active' and idempotency_key = '${IDS.restartKey}'`,
  ), 1);
  assert.equal(await count(port, "public.commercial_checkout_audit_events", "event_type = 'client_instagram_onboarding_restarted'"), 1);

  const migration = await readFile(migrationPath, "utf8");
  assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete).*authenticated/i);
  const runtimeMigration = await readFile(protectionRuntimePath, "utf8");
  assert.match(runtimeMigration, /save_analysis'[\s\S]*current_step = 'protection_lists'/);
  assert.match(runtimeMigration, /save_protection_lists/);
  assert.match(runtimeMigration, /get_account_protection_lists_for_run/);
  const atomicProtectionMigration = await readFile(atomicProtectionPath, "utf8");
  assert.match(atomicProtectionMigration, /save_client_instagram_onboarding_protection_lists/);
  assert.match(atomicProtectionMigration, /protection_lists_skipped_at/);
  for (const fn of [
    "authorize_instagram_account_onboarding_actor_v1",
    "begin_instagram_account_onboarding_v1",
    "advance_instagram_account_onboarding_v1",
    "save_instagram_account_onboarding_protection_lists_v1",
    "restart_instagram_account_onboarding_v1",
    "expire_instagram_account_onboarding_sessions_v1",
  ]) {
    assert.equal(await query(port, `select has_function_privilege('anon', (select oid from pg_proc where proname = '${fn}' limit 1), 'EXECUTE')::text`), "false");
    assert.equal(await query(port, `select has_function_privilege('authenticated', (select oid from pg_proc where proname = '${fn}' limit 1), 'EXECUTE')::text`), "false");
    assert.equal(await query(port, `select has_function_privilege('service_role', (select oid from pg_proc where proname = '${fn}' limit 1), 'EXECUTE')::text`), "true");
  }

  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", canonicalRollbackPath.pathname]);
  assert.equal(await count(port, "pg_proc", "proname = 'begin_instagram_account_onboarding_v1'"), 0);
  assert.equal(await count(port, "pg_proc", "proname = 'begin_client_instagram_onboarding'"), 1);
  assert.equal(await count(port, "information_schema.columns", "table_schema = 'public' and table_name = 'client_instagram_onboarding_sessions' and column_name = 'actor_type'"), 0);
});
