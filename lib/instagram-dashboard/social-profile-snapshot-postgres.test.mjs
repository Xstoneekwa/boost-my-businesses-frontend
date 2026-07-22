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

async function query(port, sql) {
  const { stdout } = await execFileAsync(PSQL, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-c", sql]);
  return stdout.trim();
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
    create table public.ig_accounts(id uuid primary key, username text not null);
    insert into public.ig_accounts values ('${ACCOUNT}', 'zero_is_valid');
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
  const legacyMigration = new URL("../../supabase/migrations/20260722121000_social_profile_snapshots_legacy_followers.sql", import.meta.url);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", legacyMigration.pathname]);
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
  await assert.rejects(query(port, "update public.ig_account_social_profile_snapshots set followers_count=1"), /append_only/);
  await assert.rejects(query(port, "delete from public.ig_account_social_profile_snapshots"), /append_only/);
  await assert.rejects(query(port, `insert into public.ig_account_social_profile_snapshots(
    account_id,username_normalized,observed_at,snapshot_local_date,account_timezone,timezone_source,source_provider,source_trigger,lookup_status,freshness_status,idempotency_key
  ) values ('${ACCOUNT}','zero_is_valid','2026-07-23','2026-07-23','Africa/Johannesburg','platform_default','searchapi','daily_fallback','found','partial','empty')`), /has_metric/);
  await assert.rejects(query(port, `insert into public.ig_account_social_profile_snapshots(
    account_id,username_normalized,followers_count,observed_at,snapshot_local_date,account_timezone,timezone_source,source_provider,source_trigger,lookup_status,freshness_status,idempotency_key
  ) values ('${ACCOUNT}','not valid!',1,'2026-07-23','2026-07-23','Africa/Johannesburg','platform_default','searchapi','daily_fallback','found','partial','bad-user')`), /check constraint/);
  await assert.rejects(query(port, `insert into public.ig_account_social_profile_snapshots(
    account_id,username_normalized,followers_count,observed_at,snapshot_local_date,account_timezone,timezone_source,source_provider,source_trigger,lookup_status,freshness_status,idempotency_key
  ) values ('${ACCOUNT}','zero_is_valid',1,'2026-07-23','2026-07-23','Africa/Johannesburg','platform_default','searchapi','daily_fallback','provider_error','partial','bad-status')`), /check constraint/);

  assert.equal(await query(port, "select has_table_privilege('anon','public.ig_account_social_profile_snapshots','select')"), "f");
  assert.equal(await query(port, "select has_table_privilege('authenticated','public.ig_account_social_profile_snapshots','insert')"), "f");
  assert.equal(await query(port, "select has_table_privilege('service_role','public.ig_account_social_profile_snapshots','insert')"), "t");
  assert.equal(await query(port, "select has_function_privilege('anon','public.claim_ig_social_profile_snapshot_jobs(text,integer,integer)','execute')"), "f");
  assert.equal(await query(port, "select has_function_privilege('service_role','public.claim_ig_social_profile_snapshot_jobs(text,integer,integer)','execute')"), "t");

  await query(port, `insert into public.ig_social_profile_snapshot_jobs(
    account_id,username_normalized,snapshot_local_date,account_timezone,timezone_source,source_trigger,idempotency_key
  ) values ('${ACCOUNT}','zero_is_valid','2026-07-22','Africa/Johannesburg','platform_default','daily_fallback','job-1'),
           ('${ACCOUNT}','zero_is_valid','2026-07-23','Africa/Johannesburg','platform_default','daily_fallback','job-2')`);
  assert.equal(await query(port, "select count(*) from public.claim_ig_social_profile_snapshot_jobs('worker-a',1,120)"), "1");
  assert.equal(await query(port, "select count(*) from public.claim_ig_social_profile_snapshot_jobs('worker-b',2,120)"), "1");
  assert.equal(await query(port, "select count(distinct lease_owner) from public.ig_social_profile_snapshot_jobs where status='processing'"), "2");
});
