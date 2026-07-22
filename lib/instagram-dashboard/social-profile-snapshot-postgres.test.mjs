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
const ACCOUNT = "10000000-0000-4000-8000-000000000001";
const ACCOUNT_2 = "10000000-0000-4000-8000-000000000002";
const ACCOUNT_3 = "10000000-0000-4000-8000-000000000003";
const ACCOUNT_4 = "10000000-0000-4000-8000-000000000004";
const ACCOUNT_5 = "10000000-0000-4000-8000-000000000005";
const ACCOUNT_6 = "10000000-0000-4000-8000-000000000006";
const ACCOUNT_7 = "10000000-0000-4000-8000-000000000007";
const ACCOUNT_8 = "10000000-0000-4000-8000-000000000008";

async function query(port, sql) {
  const { stdout } = await execFileAsync(PSQL, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-c", sql]);
  return stdout.trim();
}

function guardedCall({
  accountId,
  username,
  trigger = "daily_fallback",
  key,
  explicit = false,
  dryRun = false,
  now = "2026-07-22T23:00:00Z",
}) {
  return `select concat_ws(':',classification,created::text,provider_calls_new_job_max::text,existing_retry_provider_calls_max::text)
    from public.enqueue_ig_social_profile_snapshot_job_guarded(
      p_account_id => '${accountId}',
      p_username_normalized => '${username}',
      p_snapshot_local_date => '2026-07-22',
      p_account_timezone => 'Africa/Johannesburg',
      p_timezone_source => 'platform_default',
      p_source_trigger => '${trigger}',
      p_idempotency_key => '${key}',
      p_source_event_id => ${trigger === "baseline_one_shot" || trigger === "admin_manual_refresh" ? `'event-${key}'` : "null"},
      p_explicit_admin_refresh => ${explicit},
      p_dry_run => ${dryRun},
      p_now => '${now}'::timestamptz
    )`;
}

test("real PostgreSQL enforces append-only snapshots, idempotency, ACLs and atomic job claiming", { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "social-profile-pg-"));
  const dataDir = path.join(root, "data");
  const socketDir = path.join(root, "socket");
  const port = 55932 + Math.floor(Math.random() * 400);
  await execFileAsync(INITDB, ["-D", dataDir, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await execFileAsync("/bin/mkdir", ["-p", socketDir]);
  await execFileAsync(PG_CTL, ["-D", dataDir, "-l", path.join(root, "postgres.log"), "-o", `-p ${port} -k ${socketDir}`, "-w", "start"]);
  t.after(async () => {
    await execFileAsync(PG_CTL, ["-D", dataDir, "-m", "fast", "-w", "stop"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  const bootstrap = `
    create extension if not exists pgcrypto;
    create role anon; create role authenticated; create role service_role;
    alter default privileges in schema public grant all privileges on tables to service_role;
    create table public.ig_accounts(
      id uuid primary key, username text not null, status text, admin_lifecycle_status text
    );
    insert into public.ig_accounts values
      ('${ACCOUNT}', 'zero_is_valid', 'active', 'active'),
      ('${ACCOUNT_2}', 'baseline_two', 'active', 'active'),
      ('${ACCOUNT_3}', 'baseline_three', 'active', 'active'),
      ('${ACCOUNT_4}', 'other_batch', 'active', 'active'),
      ('${ACCOUNT_5}', 'terminal_identity', 'active', 'active'),
      ('${ACCOUNT_6}', 'concurrent_cron', 'active', 'active'),
      ('${ACCOUNT_7}', 'cross_trigger', 'active', 'active'),
      ('${ACCOUNT_8}', 'manual_identity', 'active', 'active');
    create table public.phone_devices(id uuid primary key, timezone text);
    create table public.account_assignments(
      id uuid primary key default gen_random_uuid(), account_id uuid, device_id uuid,
      status text, created_at timestamptz default now()
    );
    create table public.ig_account_follower_snapshots(
      id uuid primary key, account_id uuid not null, followers_count integer not null,
      captured_at timestamptz not null, source text, observation_kind text, created_at timestamptz default now()
    );
    insert into public.ig_account_follower_snapshots(id, account_id, followers_count, captured_at, source, observation_kind)
    select gen_random_uuid(), '${ACCOUNT}', series, '2026-07-01T20:00:00Z'::timestamptz + (series || ' days')::interval,
      'public_profile_lookup', 'daily'
    from generate_series(1, 14) series;
  `;
  const bootstrapPath = path.join(root, "bootstrap.sql");
  await writeFile(bootstrapPath, bootstrap);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", bootstrapPath]);
  const migration = new URL("../../supabase/migrations/20260722120000_social_profile_snapshots_v1.sql", import.meta.url);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", migration.pathname]);

  // Reproduce the production failure: inherited service_role rights survive the first migration.
  assert.equal(await query(port, "select has_table_privilege('service_role','public.ig_account_social_profile_snapshots','update')"), "t");
  assert.equal(await query(port, "select has_table_privilege('service_role','public.ig_account_social_profile_snapshots','delete')"), "t");
  assert.equal(await query(port, "select has_table_privilege('service_role','public.ig_account_social_profile_snapshots','truncate')"), "t");
  assert.equal(await query(port, "select has_table_privilege('service_role','public.ig_social_profile_snapshot_jobs','delete')"), "t");
  assert.equal(await query(port, "select has_table_privilege('service_role','public.ig_social_profile_snapshot_jobs','truncate')"), "t");

  const legacyMigration = new URL("../../supabase/migrations/20260722121000_social_profile_snapshots_legacy_followers.sql", import.meta.url);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", legacyMigration.pathname]);
  const baselineMigration = new URL("../../supabase/migrations/20260722130000_social_profile_snapshot_baseline_v1.sql", import.meta.url);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", baselineMigration.pathname]);
  const costGuardMigration = new URL("../../supabase/migrations/20260722134621_social_profile_snapshot_enqueue_cost_guard_v1.sql", import.meta.url);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", costGuardMigration.pathname]);

  for (const role of ["anon", "authenticated"]) {
    for (const table of ["ig_account_social_profile_snapshots", "ig_social_profile_snapshot_jobs"]) {
      assert.equal(
        await query(port, `select has_table_privilege('${role}','public.${table}','select,insert,update,delete,truncate')`),
        "f",
      );
    }
  }
  for (const [table, privilege, expected] of [
    ["ig_account_social_profile_snapshots", "select", "t"],
    ["ig_account_social_profile_snapshots", "insert", "t"],
    ["ig_account_social_profile_snapshots", "update", "f"],
    ["ig_account_social_profile_snapshots", "delete", "f"],
    ["ig_account_social_profile_snapshots", "truncate", "f"],
    ["ig_social_profile_snapshot_jobs", "select", "t"],
    ["ig_social_profile_snapshot_jobs", "insert", "t"],
    ["ig_social_profile_snapshot_jobs", "update", "t"],
    ["ig_social_profile_snapshot_jobs", "delete", "f"],
    ["ig_social_profile_snapshot_jobs", "truncate", "f"],
  ]) {
    assert.equal(
      await query(port, `select has_table_privilege('service_role','public.${table}','${privilege}')`),
      expected,
      `${table} service_role ${privilege}`,
    );
  }
  assert.equal(
    await query(port, "select relrowsecurity from pg_class where oid='public.ig_account_social_profile_snapshots'::regclass"),
    "t",
  );
  assert.equal(
    await query(port, "select relrowsecurity from pg_class where oid='public.ig_social_profile_snapshot_jobs'::regclass"),
    "t",
  );
  assert.equal(await query(port, "select has_function_privilege('anon','public.claim_ig_social_profile_snapshot_jobs(text,integer,integer)','execute')"), "f");
  assert.equal(await query(port, "select has_function_privilege('authenticated','public.claim_ig_social_profile_snapshot_jobs(text,integer,integer)','execute')"), "f");
  assert.equal(await query(port, "select has_function_privilege('service_role','public.claim_ig_social_profile_snapshot_jobs(text,integer,integer)','execute')"), "t");
  assert.equal(await query(port, "select has_function_privilege('anon','public.claim_ig_social_profile_baseline_jobs(text,text,integer,integer)','execute')"), "f");
  assert.equal(await query(port, "select has_function_privilege('authenticated','public.claim_ig_social_profile_baseline_jobs(text,text,integer,integer)','execute')"), "f");
  assert.equal(await query(port, "select has_function_privilege('service_role','public.claim_ig_social_profile_baseline_jobs(text,text,integer,integer)','execute')"), "t");
  const guardedSignature = "public.enqueue_ig_social_profile_snapshot_job_guarded(uuid,text,date,text,text,text,text,text,uuid,uuid,boolean,boolean,timestamptz)";
  assert.equal(await query(port, `select has_function_privilege('anon','${guardedSignature}','execute')`), "f");
  assert.equal(await query(port, `select has_function_privilege('authenticated','${guardedSignature}','execute')`), "f");
  assert.equal(await query(port, `select has_function_privilege('service_role','${guardedSignature}','execute')`), "t");
  assert.equal(
    await query(port, "select count(*) from pg_indexes where schemaname='public' and indexname='ig_social_profile_snapshot_jobs_one_active_identity_idx'"),
    "1",
  );

  assert.equal(await query(port, "select count(*) from public.ig_account_social_profile_snapshots where source_trigger='legacy_import'"), "14");
  assert.equal(await query(port, "select count(*) from public.ig_account_social_profile_snapshots where source_trigger='legacy_import' and (following_count is not null or posts_count is not null)"), "0");
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", legacyMigration.pathname]);
  assert.equal(await query(port, "select count(*) from public.ig_account_social_profile_snapshots where source_trigger='legacy_import'"), "14");

  const insertSnapshot = `insert into public.ig_account_social_profile_snapshots(
    account_id,username_normalized,followers_count,following_count,posts_count,observed_at,snapshot_local_date,
    account_timezone,timezone_source,source_provider,source_trigger,lookup_status,freshness_status,idempotency_key
  ) values ('${ACCOUNT}','zero_is_valid',0,0,0,'2026-07-22T00:30:00Z','2026-07-22',
    'Africa/Johannesburg','platform_default','searchapi','daily_fallback','found','fresh','day-1')`;
  await query(port, insertSnapshot);
  assert.equal(await query(port, "select followers_count||':'||following_count||':'||posts_count from public.ig_account_social_profile_snapshots where idempotency_key='day-1'"), "0:0:0");
  await query(port, `${insertSnapshot} on conflict do nothing`);
  assert.equal(await query(port, "select count(*) from public.ig_account_social_profile_snapshots"), "15");
  await query(port, `insert into public.ig_account_social_profile_snapshots(
    account_id,username_normalized,followers_count,following_count,posts_count,observed_at,snapshot_local_date,
    account_timezone,timezone_source,source_provider,source_trigger,lookup_status,freshness_status,idempotency_key
  ) values ('${ACCOUNT_4}','other_batch',4,5,6,'2026-07-22T00:35:00Z','2026-07-22',
    'Africa/Johannesburg','platform_default','searchapi','daily_fallback','found','fresh','day-2')`);
  assert.equal(await query(port, "select count(*) from public.ig_account_social_profile_snapshots"), "16");
  await assert.rejects(query(port, "update public.ig_account_social_profile_snapshots set followers_count=1"), /append_only/);
  await assert.rejects(query(port, "delete from public.ig_account_social_profile_snapshots"), /append_only/);
  await assert.rejects(query(port, "set role service_role; update public.ig_account_social_profile_snapshots set followers_count=1"), /permission denied/);
  await assert.rejects(query(port, "set role service_role; delete from public.ig_account_social_profile_snapshots"), /permission denied/);
  await assert.rejects(query(port, "set role service_role; truncate public.ig_account_social_profile_snapshots"), /permission denied/);
  await assert.rejects(query(port, `insert into public.ig_account_social_profile_snapshots(
    account_id,username_normalized,observed_at,snapshot_local_date,account_timezone,timezone_source,source_provider,source_trigger,lookup_status,freshness_status,idempotency_key
  ) values ('${ACCOUNT}','zero_is_valid','2026-07-23','2026-07-23','Africa/Johannesburg','platform_default','searchapi','daily_fallback','found','partial','empty')`), /has_metric/);
  await assert.rejects(query(port, `insert into public.ig_account_social_profile_snapshots(
    account_id,username_normalized,followers_count,observed_at,snapshot_local_date,account_timezone,timezone_source,source_provider,source_trigger,lookup_status,freshness_status,idempotency_key
  ) values ('${ACCOUNT}','not valid!',1,'2026-07-23','2026-07-23','Africa/Johannesburg','platform_default','searchapi','daily_fallback','found','partial','bad-user')`), /check constraint/);
  await assert.rejects(query(port, `insert into public.ig_account_social_profile_snapshots(
    account_id,username_normalized,followers_count,observed_at,snapshot_local_date,account_timezone,timezone_source,source_provider,source_trigger,lookup_status,freshness_status,idempotency_key
  ) values ('${ACCOUNT}','zero_is_valid',1,'2026-07-23','2026-07-23','Africa/Johannesburg','platform_default','searchapi','daily_fallback','provider_error','partial','bad-status')`), /check constraint/);

  await query(port, `insert into public.ig_social_profile_snapshot_jobs(
    account_id,username_normalized,snapshot_local_date,account_timezone,timezone_source,source_trigger,idempotency_key
  ) values ('${ACCOUNT}','zero_is_valid','2026-07-22','Africa/Johannesburg','platform_default','daily_fallback','job-1'),
           ('${ACCOUNT_2}','baseline_two','2026-07-23','Africa/Johannesburg','platform_default','daily_fallback','job-2')`);
  await assert.rejects(query(port, "set role service_role; delete from public.ig_social_profile_snapshot_jobs"), /permission denied/);
  await assert.rejects(query(port, "set role service_role; truncate public.ig_social_profile_snapshot_jobs"), /permission denied/);
  const concurrentClaims = await Promise.all([
    query(port, "select count(*) from public.claim_ig_social_profile_snapshot_jobs('worker-a',1,120)"),
    query(port, "select count(*) from public.claim_ig_social_profile_snapshot_jobs('worker-b',1,120)"),
  ]);
  assert.deepEqual(concurrentClaims.sort(), ["1", "1"]);
  assert.equal(await query(port, "select count(distinct lease_owner) from public.ig_social_profile_snapshot_jobs where status='processing'"), "2");
  await query(port, "update public.ig_social_profile_snapshot_jobs set status='succeeded', lease_owner=null, lease_expires_at=null where source_trigger='daily_fallback'");

  assert.match(
    await query(port, guardedCall({ accountId: ACCOUNT, username: "zero_is_valid", key: "fresh-dry", dryRun: true, now: "2026-07-22T01:00:00Z" })),
    /^skipped_fresh:false:0:0$/,
  );

  await query(port, `insert into public.ig_social_profile_snapshot_jobs(
    account_id,username_normalized,snapshot_local_date,account_timezone,timezone_source,source_trigger,idempotency_key,status,last_error_code,updated_at
  ) values ('${ACCOUNT_5}','terminal_identity','2026-07-22','Africa/Johannesburg','platform_default','baseline_one_shot','terminal-1','failed','not_found','2026-07-22T12:00:00Z'),
           ('${ACCOUNT_5}','terminal_identity','2026-07-21','Africa/Johannesburg','platform_default','baseline_one_shot','terminal-older','failed','not_found','2026-07-21T12:00:00Z')`);
  assert.match(
    await query(port, guardedCall({ accountId: ACCOUNT_5, username: "terminal_identity", key: "terminal-dry", dryRun: true })),
    /^terminal_suppressed:false:0:0$/,
  );
  assert.equal(await query(port, `select count(*) from public.ig_social_profile_snapshot_jobs where account_id='${ACCOUNT_5}' and status='failed'`), "2");
  await query(port, `update public.ig_accounts set username='renamed_identity' where id='${ACCOUNT_5}'`);
  assert.match(
    await query(port, guardedCall({ accountId: ACCOUNT_5, username: "renamed_identity", key: "renamed-dry", dryRun: true })),
    /^enqueue_allowed:false:1:0$/,
  );

  const concurrentEnqueues = await Promise.all([
    query(port, guardedCall({ accountId: ACCOUNT_6, username: "concurrent_cron", key: "cron-key" })),
    query(port, guardedCall({ accountId: ACCOUNT_6, username: "concurrent_cron", trigger: "baseline_one_shot", key: "baseline-key" })),
  ]);
  assert.deepEqual(concurrentEnqueues.sort(), ["enqueued:true:1:0", "existing_job_pending:false:0:1"]);
  assert.equal(await query(port, `select count(*) from public.ig_social_profile_snapshot_jobs where account_id='${ACCOUNT_6}' and status in ('queued','processing')`), "1");

  const crossTriggerEnqueues = await Promise.all([
    query(port, guardedCall({ accountId: ACCOUNT_7, username: "cross_trigger", key: "scheduled-key" })),
    query(port, guardedCall({ accountId: ACCOUNT_7, username: "cross_trigger", trigger: "admin_manual_refresh", key: "manual-key", explicit: true })),
  ]);
  assert.deepEqual(crossTriggerEnqueues.sort(), ["enqueued:true:1:0", "existing_job_pending:false:0:1"]);
  assert.equal(await query(port, `select count(*) from public.ig_social_profile_snapshot_jobs where account_id='${ACCOUNT_7}' and status in ('queued','processing')`), "1");

  await query(port, `insert into public.ig_social_profile_snapshot_jobs(
    account_id,username_normalized,snapshot_local_date,account_timezone,timezone_source,source_trigger,idempotency_key,status,last_error_code,updated_at
  ) values ('${ACCOUNT_8}','manual_identity','2026-07-21','Africa/Johannesburg','platform_default','baseline_one_shot','manual-terminal','failed','not_found','2026-07-21T12:00:00Z')`);
  assert.equal(
    await query(port, guardedCall({ accountId: ACCOUNT_8, username: "manual_identity", trigger: "admin_manual_refresh", key: "manual-override", explicit: true })),
    "enqueued:true:1:0",
  );
  assert.equal(
    await query(port, guardedCall({ accountId: ACCOUNT_8, username: "manual_identity", trigger: "admin_manual_refresh", key: "manual-duplicate", explicit: true })),
    "existing_job_pending:false:0:1",
  );
  await assert.rejects(query(port, `insert into public.ig_social_profile_snapshot_jobs(
    account_id,username_normalized,snapshot_local_date,account_timezone,timezone_source,source_trigger,idempotency_key
  ) values ('${ACCOUNT_8}','manual_identity','2026-07-22','Africa/Johannesburg','platform_default','daily_fallback','manual-direct-duplicate')`), /duplicate key/);
  assert.equal(await query(port, `select count(*) from public.ig_social_profile_snapshot_jobs where account_id='${ACCOUNT_8}' and status='failed'`), "1");
  assert.equal(await query(port, "select count(*) from public.ig_account_social_profile_snapshots"), "16");

  await query(port, `insert into public.ig_social_profile_snapshot_jobs(
    account_id,username_normalized,snapshot_local_date,account_timezone,timezone_source,source_trigger,source_event_id,idempotency_key
  ) values ('${ACCOUNT_2}','baseline_two','2026-07-22','Africa/Johannesburg','platform_default','baseline_one_shot','batch-a','baseline-2'),
           ('${ACCOUNT_3}','baseline_three','2026-07-22','Africa/Johannesburg','platform_default','baseline_one_shot','batch-a','baseline-3'),
           ('${ACCOUNT_4}','other_batch','2026-07-22','Africa/Johannesburg','platform_default','baseline_one_shot','batch-b','baseline-4')`);
  const baselineClaims = await Promise.all([
    query(port, "select count(*) from public.claim_ig_social_profile_baseline_jobs('batch-a','baseline-a',1,120)"),
    query(port, "select count(*) from public.claim_ig_social_profile_baseline_jobs('batch-a','baseline-b',1,120)"),
  ]);
  assert.deepEqual(baselineClaims.sort(), ["1", "1"]);
  assert.equal(await query(port, "select count(*) from public.ig_social_profile_snapshot_jobs where source_trigger='baseline_one_shot' and source_event_id='batch-a' and status='processing'"), "2");
  assert.equal(await query(port, "select count(*) from public.ig_social_profile_snapshot_jobs where source_event_id='batch-b' and status='queued'"), "1");
  assert.equal(await query(port, "select count(*) from public.ig_social_profile_snapshot_jobs where source_trigger='daily_fallback' and lease_owner like 'baseline-%'"), "0");
});
