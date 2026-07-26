import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const INITDB = "/opt/homebrew/bin/initdb";
const PG_CTL = "/opt/homebrew/bin/pg_ctl";
const PSQL = "/opt/homebrew/bin/psql";

const ID = {
  tenant: "10000000-0000-4000-8000-000000000001",
  account: "10000000-0000-4000-8000-000000000002",
  otherA: "10000000-0000-4000-8000-000000000003",
  otherB: "10000000-0000-4000-8000-000000000004",
  entitlement: "10000000-0000-4000-8000-000000000005",
  checkout: "10000000-0000-4000-8000-000000000006",
  assignment: "10000000-0000-4000-8000-000000000007",
  instance: "10000000-0000-4000-8000-000000000008",
  device: "10000000-0000-4000-8000-000000000009",
  subscription: "10000000-0000-4000-8000-00000000000a",
  subscriptionAccount: "10000000-0000-4000-8000-00000000000b",
  incident: "10000000-0000-4000-8000-00000000000c",
};

const bootstrap = String.raw`
create extension if not exists pgcrypto;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create schema if not exists extensions;
create or replace function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

create table clients(id uuid primary key);
create table ig_accounts(
  id uuid primary key, username text not null unique, display_name text, platform text, device_name text,
  device_udid text, status text, email text, password text, two_fa_enabled boolean, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now(), archived_at timestamptz,
  trashed_at timestamptz, scheduled_trash_at timestamptz, scheduled_delete_at timestamptz, restored_at timestamptz,
  device_id uuid, clone_mode text, login_method text, internal_label text,
  username_verification_status text not null default 'pending', username_verified_at timestamptz,
  username_verification_reason text, instagram_user_id text, external_profile_id text, is_private boolean,
  is_verified boolean, followers_count integer, avatar_url text, avatar_checked_at timestamptz,
  public_profile_metadata jsonb not null default '{}'::jsonb, admin_lifecycle_status text not null default 'active'
);
create table commercial_checkout_sessions(
  id uuid primary key, idempotency_key text default 'x', flow_type text, status text, client_id uuid,
  auth_user_id uuid, purchaser_email text default 'redacted@example.invalid', plan_key text,
  billing_interval_months integer default 3, outreach_addon_key text, billable_account_count integer default 1,
  term_discount_percent numeric default 0, agency_discount_percent numeric default 0,
  applied_discount_percent numeric default 0, applied_discount_type text default 'none',
  pack_base_monthly_cents integer default 0, pack_monthly_discounted_cents integer default 0,
  pack_period_total_cents integer default 0, outreach_base_monthly_cents integer,
  outreach_monthly_discounted_cents integer, outreach_period_total_cents integer,
  total_period_cents integer default 0, catalog_snapshot jsonb default '{}', metadata jsonb default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now(), activated_at timestamptz
);
create table client_account_entitlements(
  id uuid primary key, client_id uuid not null, checkout_session_id uuid not null, plan_key text,
  commercial_package_code text, billing_interval_months integer default 3, outreach_addon_key text,
  outreach_variant text, backend_addon_code text, applied_discount_percent numeric default 0,
  applied_discount_type text default 'none', pack_monthly_discounted_cents integer default 0,
  pack_period_total_cents integer default 0, outreach_monthly_discounted_cents integer,
  outreach_period_total_cents integer, total_period_cents integer default 0,
  catalog_snapshot jsonb default '{}', status text, account_id uuid, consumed_at timestamptz,
  metadata jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now()
);
create unique index one_reserved on client_account_entitlements(client_id) where status='entitlement_reserved';
create table client_instagram_accounts(
  id uuid primary key default gen_random_uuid(), client_id uuid, account_id uuid, label text,
  onboarding_status text, provisioning_status text, login_status text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table account_assignments(
  id uuid primary key, client_id uuid, subscription_id uuid, subscription_account_id uuid,
  account_id uuid, device_id uuid, clone_id uuid, assignment_type text, slot_kind text, status text,
  starts_at timestamptz, ends_at timestamptz, assigned_at timestamptz, released_at timestamptz,
  metadata jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now(),
  assignment_source text, app_instance_id uuid, schedule_mode text
);
create table phone_app_instances(
  id uuid primary key, device_id uuid, instance_type text, instance_index integer, visible_label text,
  package_name text, launch_activity text, is_launchable boolean, status text, current_account_id uuid,
  usable_for_auto_login boolean, metadata jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now()
);
create table device_heartbeats(
  device_id uuid primary key, adb_serial text, host_machine text, status text, current_account_id uuid,
  current_assignment_id uuid, current_clone_id uuid, battery_pct integer, last_seen_at timestamptz,
  metadata jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now()
);
create table account_credentials(id uuid primary key default gen_random_uuid(), account_id uuid, provider text, status text);
create table client_subscription_accounts(id uuid primary key, subscription_id uuid, client_instagram_account_id uuid, account_id uuid, status text, created_at timestamptz default now(), updated_at timestamptz default now());
create table account_commercial_packages(id uuid primary key default gen_random_uuid(), account_id uuid, package_code text, status text, starts_at timestamptz, ends_at timestamptz, source text, metadata_safe jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now());
create table account_commercial_addons(id uuid primary key default gen_random_uuid(), account_id uuid, addon_code text, addon_variant text, source_type text, status text, starts_at timestamptz, ends_at timestamptz, source text, metadata_safe jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now());
create table ig_account_settings(account_id uuid primary key);
create table ig_account_dm_settings(account_id uuid primary key);
create table ig_account_unfollow_settings(account_id uuid primary key);
create table ig_account_follow_settings(account_id uuid primary key);
create table account_follow_source_settings(account_id uuid primary key);
create table account_warmup_settings(account_id uuid primary key);
create table ig_account_filters(account_id uuid primary key);
create table ig_dm_templates(id uuid primary key default gen_random_uuid(), account_id uuid, active boolean, updated_at timestamptz default now());
create table client_entitlements(id uuid primary key default gen_random_uuid(), account_id uuid, active boolean, updated_at timestamptz default now());
create table ig_targets(id uuid primary key default gen_random_uuid(), account_id uuid, status text, archived_at timestamptz, deleted_at timestamptz, archive_reason text, updated_at timestamptz default now(), metadata_safe jsonb default '{}');
create table ct_target_verification_jobs(id uuid primary key default gen_random_uuid(), account_id uuid, status text);
create table ct_target_audit_events(id uuid primary key default gen_random_uuid(), account_id uuid);
create table account_protection_list_entries(id uuid primary key default gen_random_uuid(), account_id uuid, list_kind text, normalized_username text, active boolean, source_surface text, created_by_auth_user_id uuid, updated_by_auth_user_id uuid, version bigint, created_at timestamptz default now(), updated_at timestamptz default now());
create table account_protection_list_versions(account_id uuid, list_kind text, version bigint, updated_at timestamptz default now(), primary key(account_id,list_kind));
create table account_protection_list_events(id uuid primary key default gen_random_uuid(), account_id uuid, list_kind text, normalized_username text, action text, source_surface text, actor_auth_user_id uuid, request_id text, idempotency_key text, previous_version bigint, new_version bigint, metadata_safe jsonb default '{}', created_at timestamptz default now());
create table client_instagram_onboarding_sessions(id uuid primary key default gen_random_uuid(), client_id uuid, entitlement_id uuid, account_id uuid, created_by uuid, idempotency_key uuid, requested_username text, package_code text, status text, current_step text, public_analysis jsonb default '{}', targeting_criteria jsonb default '{}', last_error_code text, failure_reason text, attempt_id uuid, lease_owner text, lease_expires_at timestamptz, expires_at timestamptz, last_progress_at timestamptz, abandoned_at timestamptz, completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table account_dashboard_actions(id uuid primary key default gen_random_uuid(), account_id uuid, status text, resolved_at timestamptz, updated_at timestamptz default now(), metadata_safe jsonb default '{}');
create table client_account_notifications(id uuid primary key default gen_random_uuid(), account_id uuid, status text, resolved_at timestamptz);
create table account_run_requests(id uuid primary key default gen_random_uuid(), account_id uuid, requested_run_type text, status text);
create table ig_runs(id uuid primary key default gen_random_uuid(), account_id uuid, status text);
create table auto_restart_device_locks(id uuid primary key default gen_random_uuid(), account_id uuid, device_id uuid, app_instance_id uuid, lease_expires_at timestamptz, release_reason text);
create table live_view_sessions(id uuid primary key default gen_random_uuid(), account_id uuid, status text);
create table ig_dm_jobs(id uuid primary key default gen_random_uuid(), account_id uuid, status text);
create table ig_social_profile_snapshot_jobs(id uuid primary key default gen_random_uuid(), account_id uuid, status text);
create table credential_update_requests(id uuid primary key default gen_random_uuid(), account_id uuid, status text);
create table account_verification_code_submissions(id uuid primary key default gen_random_uuid(), account_id uuid, status text);
create table incident_resume_authorizations(id uuid primary key default gen_random_uuid(), account_id uuid, status text);
create table scheduled_session_preflights(id uuid primary key default gen_random_uuid(), account_id uuid, status text);
create table ig_action_logs(id uuid primary key default gen_random_uuid(), account_id uuid);
create table account_incidents(id uuid primary key, account_id uuid, incident_type text, status text, resolved_at timestamptz, resolution_reason text, resolution_note text, updated_at timestamptz default now());
create table commercial_checkout_audit_events(id uuid primary key default gen_random_uuid(), checkout_session_id uuid, entitlement_id uuid, event_type text, actor_email text, client_id uuid, payload jsonb default '{}', created_at timestamptz default now());

create or replace function revoke_instagram_account_credentials(p_account_id uuid,p_provider text,p_reason text,p_request_id text)
returns jsonb language plpgsql as $$ declare n integer; begin
  update account_credentials set status='revoked' where account_id=p_account_id and provider=p_provider and status<>'revoked';
  get diagnostics n = row_count;
  return jsonb_build_object('ok',true,'credentials_revoked',n,'vault_cleanup_status','neutralized');
end $$;
create or replace function release_account_schedule_capacity(p_account_id uuid,p_reason text,p_source text,p_actor_id uuid)
returns jsonb language plpgsql as $$ declare n integer; begin
  if current_setting('test.fail_release',true)='1' then return jsonb_build_object('ok',false); end if;
  update account_assignments set status='released',released_at=now() where account_id=p_account_id and status in ('pending','reserved','active');
  get diagnostics n = row_count;
  update phone_app_instances set status='available',current_account_id=null where current_account_id=p_account_id;
  return jsonb_build_object('ok',true,'released_count',n,'app_instances_released_count',n);
end $$;

insert into clients values ('${ID.tenant}');
insert into ig_accounts(id,username,status,email,password,admin_lifecycle_status) values
 ('${ID.account}','rex_gen_boost_ai','inactive','safe@example.invalid','not-a-real-password','active'),
 ('${ID.otherA}','other_a','inactive',null,null,'active'),
 ('${ID.otherB}','other_b','inactive',null,null,'active');
insert into client_instagram_accounts(client_id,account_id,onboarding_status,provisioning_status,login_status) values
 ('${ID.tenant}','${ID.account}','configured','login_pending','pending'),
 ('${ID.tenant}','${ID.otherA}','ready','ready','connected'),
 ('${ID.tenant}','${ID.otherB}','ready','ready','connected');
insert into commercial_checkout_sessions(id,idempotency_key,flow_type,status,client_id,plan_key) values ('${ID.checkout}','checkout-test','additional_account','checkout_activated_test','${ID.tenant}','premium');
insert into client_account_entitlements(id,client_id,checkout_session_id,plan_key,commercial_package_code,status,account_id,consumed_at) values ('${ID.entitlement}','${ID.tenant}','${ID.checkout}','premium','premium','entitlement_consumed','${ID.account}',now());
insert into phone_app_instances(id,device_id,instance_type,instance_index,visible_label,package_name,is_launchable,status,current_account_id,usable_for_auto_login) values ('${ID.instance}','${ID.device}','clone',3,'A16-01 clone 3','com.instagram.androig',true,'occupied','${ID.account}',true);
insert into account_assignments(id,client_id,subscription_id,subscription_account_id,account_id,device_id,assignment_type,slot_kind,status,assignment_source,app_instance_id,schedule_mode) values ('${ID.assignment}','${ID.tenant}','${ID.subscription}','${ID.subscriptionAccount}','${ID.account}','${ID.device}','full_cycle','full_cycle_6h','reserved','test','${ID.instance}','scheduled');
insert into device_heartbeats(device_id,status,last_seen_at) values ('${ID.device}','online',now());
insert into account_credentials(account_id,provider,status) values ('${ID.account}','instagram','active');
insert into client_subscription_accounts values ('${ID.subscriptionAccount}','${ID.subscription}',(select id from client_instagram_accounts where account_id='${ID.account}'),'${ID.account}','active',now(),now());
insert into account_commercial_packages(account_id,package_code,status) values ('${ID.account}','premium','active');
insert into ig_account_settings values ('${ID.account}'); insert into ig_account_dm_settings values ('${ID.account}');
insert into ig_account_unfollow_settings values ('${ID.account}'); insert into ig_account_follow_settings values ('${ID.account}');
insert into account_follow_source_settings values ('${ID.account}'); insert into account_warmup_settings values ('${ID.account}');
insert into ig_account_filters values ('${ID.account}');
insert into ig_targets(account_id,status) select '${ID.account}','valid' from generate_series(1,39);
insert into ct_target_verification_jobs(account_id,status) select '${ID.account}','pending' from generate_series(1,20);
insert into ct_target_verification_jobs(account_id,status) select '${ID.account}','succeeded' from generate_series(1,9);
insert into ct_target_audit_events(account_id) values ('${ID.account}');
insert into account_protection_list_entries(account_id,list_kind,normalized_username,active,source_surface,version) values ('${ID.account}','interaction_blacklist','protected_user',true,'test',1);
insert into account_protection_list_versions values ('${ID.account}','interaction_blacklist',1,now());
insert into account_protection_list_events(account_id,list_kind,normalized_username,action,source_surface,previous_version,new_version) values ('${ID.account}','interaction_blacklist','protected_user','add','test',0,1);
insert into client_instagram_onboarding_sessions(account_id,status) values ('${ID.account}','completed');
insert into account_dashboard_actions(account_id,status) values ('${ID.account}','pending');
insert into client_account_notifications(account_id,status) values ('${ID.account}','resolved');
insert into account_run_requests(account_id,requested_run_type,status) values ('${ID.account}','manual','completed');
insert into ig_runs(account_id,status) values ('${ID.account}','completed');
insert into ig_action_logs(account_id) select '${ID.account}' from generate_series(1,9);
insert into account_incidents values ('${ID.incident}','${ID.account}','login_package_mismatch','open',null,null,null,now());
`;

function args(overrides = {}) {
  return {
    account: ID.account,
    tenant: ID.tenant,
    entitlement: ID.entitlement,
    username: "rex_gen_boost_ai",
    checkout: ID.checkout,
    package: "premium",
    reason: "test_onboarding_rolled_back_after_package_runtime_fix",
    request: "rollback-rex-test-20260726",
    key: "rollback-rex-test-20260726-v1",
    dryRun: true,
    ...overrides,
  };
}

function callSql(a = args()) {
  return `select rollback_test_instagram_onboarding_v1('${a.account}','${a.tenant}','${a.entitlement}','${a.username}','${a.checkout}','${a.package}','${a.reason}','${a.request}','${a.key}',${a.dryRun})::text`;
}

function psqlArgs(port, sql) {
  return ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-c", `set statement_timeout='12s'; ${sql}`];
}
async function query(port, sql) {
  const { stdout } = await execFileAsync(PSQL, psqlArgs(port, sql));
  return stdout.trim();
}
async function json(port, sql) { return JSON.parse(await query(port, sql)); }
async function count(port, table, where = "true") { return Number(await query(port, `select count(*) from ${table} where ${where}`)); }

test("rollback_test_instagram_onboarding_v1 is guarded, atomic, idempotent, and history preserving", { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "rollback-onboarding-pg-"));
  const dataDir = path.join(root, "data");
  const socketDir = path.join(root, "socket");
  const log = path.join(root, "postgres.log");
  const port = 55900 + Math.floor(Math.random() * 400);
  await execFileAsync(INITDB, ["-D", dataDir, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await execFileAsync("/bin/mkdir", ["-p", socketDir]);
  await execFileAsync(PG_CTL, ["-D", dataDir, "-l", log, "-o", `-p ${port} -k ${socketDir}`, "-w", "start"]);
  t.after(async () => {
    await execFileAsync(PG_CTL, ["-D", dataDir, "-m", "fast", "-w", "stop"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  const bootstrapPath = path.join(root, "bootstrap.sql");
  const migrationPath = new URL("../../supabase/migrations/20260726030119_rollback_test_instagram_onboarding_v1.sql", import.meta.url);
  await writeFile(bootstrapPath, bootstrap);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", bootstrapPath]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", migrationPath.pathname]);

  assert.equal(await query(port, "select has_function_privilege('anon','rollback_test_instagram_onboarding_v1(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean)','execute')"), "f");
  assert.equal(await query(port, "select has_function_privilege('authenticated','rollback_test_instagram_onboarding_v1(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean)','execute')"), "f");
  assert.equal(await query(port, "select has_function_privilege('service_role','rollback_test_instagram_onboarding_v1(uuid,uuid,uuid,text,uuid,text,text,text,text,boolean)','execute')"), "t");

  const before = await query(port, `select md5(jsonb_build_object('account',(select to_jsonb(a) from ig_accounts a where id='${ID.account}'),'entitlement',(select to_jsonb(e) from client_account_entitlements e where id='${ID.entitlement}'),'targets',(select count(*) from ig_targets where account_id='${ID.account}'),'jobs',(select count(*) from ct_target_verification_jobs where account_id='${ID.account}'))::text)`);
  const preview = await json(port, callSql());
  assert.equal(preview.ok, true);
  assert.equal(preview.reason, "dry_run_pass");
  assert.equal(preview.counts.targets_active, 39);
  assert.equal(preview.counts.verification_jobs_nonhistorical, 20);
  assert.equal(preview.guards.zero_active_requests, true);
  assert.equal(await query(port, `select md5(jsonb_build_object('account',(select to_jsonb(a) from ig_accounts a where id='${ID.account}'),'entitlement',(select to_jsonb(e) from client_account_entitlements e where id='${ID.entitlement}'),'targets',(select count(*) from ig_targets where account_id='${ID.account}'),'jobs',(select count(*) from ct_target_verification_jobs where account_id='${ID.account}'))::text)`), before);

  assert.equal((await json(port, callSql(args({ account: ID.otherA })))).reason, "username_mismatch");
  assert.equal((await json(port, callSql(args({ username: "wrong_user" })))).reason, "username_mismatch");
  assert.equal((await json(port, callSql(args({ tenant: ID.otherA })))).reason, "tenant_or_active_ownership_mismatch");
  assert.equal((await json(port, callSql(args({ entitlement: ID.otherA })))).reason, "entitlement_not_found");
  assert.equal((await json(port, callSql(args({ package: "pro" })))).reason, "package_mismatch");
  assert.equal((await json(port, `begin; update commercial_checkout_sessions set status='checkout_activated_live' where id='${ID.checkout}'; ${callSql()}; rollback;`)).reason, "checkout_not_test_or_package_mismatch");
  assert.equal((await json(port, `begin; insert into account_run_requests(account_id,requested_run_type,status) values ('${ID.account}','manual','queued'); ${callSql()}; rollback;`)).reason, "active_request_guard");
  assert.equal((await json(port, `begin; insert into ig_runs(account_id,status) values ('${ID.account}','running'); ${callSql()}; rollback;`)).reason, "active_run_guard");
  assert.equal((await json(port, `begin; insert into auto_restart_device_locks(account_id,device_id,app_instance_id,lease_expires_at) values ('${ID.account}','${ID.device}','${ID.instance}',now()+interval '5 minutes'); ${callSql()}; rollback;`)).reason, "active_lock_guard");
  assert.equal((await json(port, `begin; update phone_app_instances set current_account_id='${ID.otherA}' where id='${ID.instance}'; ${callSql()}; rollback;`)).reason, "assignment_instance_occupant_mismatch");

  const rollbackFailure = await json(port, `begin; set local test.fail_release='1'; ${callSql(args({ dryRun: false, key: "rollback-failure-test-v1" }))}; rollback;`);
  assert.equal(rollbackFailure.reason, "transaction_failed");
  assert.equal(await query(port, `select status from account_credentials where account_id='${ID.account}'`), "active");
  assert.equal(await count(port, "test_instagram_onboarding_rollbacks"), 0);

  const otherBefore = await query(port, `select md5(jsonb_agg(to_jsonb(a) order by a.id)::text) from ig_accounts a where id in ('${ID.otherA}','${ID.otherB}')`);
  const result = await json(port, callSql(args({ dryRun: false })));
  assert.equal(result.ok, true);
  assert.equal(result.reason, "rolled_back");
  assert.equal(result.ready_to_restart_onboarding, true);
  assert.equal(await query(port, `select status||'|'||admin_lifecycle_status from ig_accounts where id='${ID.account}'`), "rolled_back_test_onboarding|cancelled");
  assert.equal(await query(port, `select status||'|'||coalesce(account_id::text,'null')||'|'||coalesce(consumed_at::text,'null') from client_account_entitlements where id='${ID.entitlement}'`), "entitlement_reserved|null|null");
  assert.equal(await query(port, `select status from account_assignments where id='${ID.assignment}'`), "released");
  assert.equal(await query(port, `select status||'|'||coalesce(current_account_id::text,'null') from phone_app_instances where id='${ID.instance}'`), "available|null");
  assert.equal(await query(port, `select status from account_credentials where account_id='${ID.account}'`), "revoked");
  assert.equal(await query(port, `select active::text from client_instagram_accounts where account_id='${ID.account}'`), "false");
  assert.equal(await count(port, "ig_targets", `account_id='${ID.account}' and status='archived' and archived_at is not null`), 39);
  assert.equal(await count(port, "ct_target_verification_jobs", `account_id='${ID.account}' and status='pending'`), 0);
  assert.equal(await count(port, "ct_target_verification_jobs", `account_id='${ID.account}' and status='succeeded'`), 9);
  assert.equal(await query(port, `select active::text from account_protection_list_entries where account_id='${ID.account}'`), "false");
  assert.equal(await count(port, "account_protection_list_events", `account_id='${ID.account}'`), 2);
  assert.equal(await count(port, "client_instagram_onboarding_sessions", `account_id='${ID.account}' and status='completed'`), 1);
  assert.equal(await count(port, "account_run_requests", `account_id='${ID.account}'`), 1);
  assert.equal(await count(port, "ig_runs", `account_id='${ID.account}'`), 1);
  assert.equal(await count(port, "ig_action_logs", `account_id='${ID.account}'`), 9);
  assert.equal(await count(port, "ct_target_audit_events", `account_id='${ID.account}'`), 1);
  assert.equal(await query(port, `select status||'|'||resolution_reason from account_incidents where id='${ID.incident}'`), "resolved|test_onboarding_rolled_back_after_package_runtime_fix");
  assert.equal(await query(port, `select md5(jsonb_agg(to_jsonb(a) order by a.id)::text) from ig_accounts a where id in ('${ID.otherA}','${ID.otherB}')`), otherBefore);
  assert.equal(await count(port, "test_instagram_onboarding_rollbacks"), 1);
  assert.equal(await count(port, "commercial_checkout_audit_events", "event_type='test_instagram_onboarding_rolled_back'"), 1);

  const replay = await json(port, callSql(args({ dryRun: false })));
  assert.equal(replay.reason, "already_rolled_back");
  assert.equal(await count(port, "test_instagram_onboarding_rollbacks"), 1);
  const mismatch = await json(port, callSql(args({ dryRun: false, reason: "different_safe_reason" })));
  assert.equal(mismatch.reason, "idempotency_fingerprint_mismatch");
});
