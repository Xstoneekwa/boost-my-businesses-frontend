import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const INITDB = "/opt/homebrew/bin/initdb";
const PG_CTL = "/opt/homebrew/bin/pg_ctl";
const PSQL = "/opt/homebrew/bin/psql";
const A = "10000000-0000-4000-8000-000000000001";
const B = "10000000-0000-4000-8000-000000000002";
const C = "10000000-0000-4000-8000-000000000003";

function psqlArgs(port, sql) {
  return ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-c", sql];
}

async function query(port, sql) {
  const { stdout } = await execFileAsync(PSQL, psqlArgs(port, sql));
  return stdout.trim();
}

test("account protection migration satisfies the DB contract and rolls back", { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "account-protection-pg-"));
  const dataDir = path.join(root, "data");
  const socketDir = path.join(root, "socket");
  const logPath = path.join(root, "postgres.log");
  const bootstrapPath = path.join(root, "bootstrap.sql");
  const port = 55900 + Math.floor(Math.random() * 300);
  const migrationPath = new URL("../../supabase/migrations/20260726041500_account_protection_lists_v1.sql", import.meta.url);
  const indexMigrationPath = new URL("../../supabase/migrations/20260726044000_account_protection_lists_v1_fk_indexes.sql", import.meta.url);
  const rollbackPath = new URL("../../supabase/rollback/20260726041500_account_protection_lists_v1.down.sql", import.meta.url);
  const bootstrap = `
    create extension if not exists pgcrypto;
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
    create schema auth;
    create table auth.users (id uuid primary key);
    create table public.ig_accounts (
      id uuid primary key default gen_random_uuid(),
      username text not null unique,
      status text default 'active',
      admin_lifecycle_status text not null default 'active',
      archived_at timestamptz,
      trashed_at timestamptz
    );
    insert into public.ig_accounts(id,username) values
      ('${A}','apl_test_a'),('${B}','apl_test_b'),('${C}','apl_test_c');
    grant select, update on public.ig_accounts to service_role;
  `;
  await execFileAsync(INITDB, ["-D", dataDir, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await execFileAsync("/bin/mkdir", ["-p", socketDir]);
  await execFileAsync(PG_CTL, ["-D", dataDir, "-l", logPath, "-o", `-p ${port} -k ${socketDir}`, "-w", "start"]);
  t.after(async () => {
    await execFileAsync(PG_CTL, ["-D", dataDir, "-m", "fast", "-w", "stop"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(bootstrapPath, bootstrap);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", bootstrapPath]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", migrationPath.pathname]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", migrationPath.pathname]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", indexMigrationPath.pathname]);
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", indexMigrationPath.pathname]);

  assert.equal(await query(port, "select count(*) from information_schema.tables where table_schema='public' and table_name in ('account_protection_list_entries','account_protection_list_events','account_protection_list_versions')"), "3");
  assert.equal(await query(port, "select count(*) from pg_constraint where conrelid='public.account_protection_list_entries'::regclass and contype in ('p','f','u','c')"), "9");
  assert.equal(await query(port, "select relrowsecurity from pg_class where oid='public.account_protection_list_entries'::regclass"), "t");
  assert.equal(await query(port, "select relrowsecurity from pg_class where oid='public.account_protection_list_events'::regclass"), "t");
  assert.equal(await query(port, "select has_table_privilege('anon','public.account_protection_list_entries','select')"), "f");
  assert.equal(await query(port, "select has_table_privilege('authenticated','public.account_protection_list_entries','insert,update,delete')"), "f");
  assert.equal(await query(port, "select has_table_privilege('service_role','public.account_protection_list_entries','select,insert,update,delete')"), "t");
  assert.equal(await query(port, "select has_table_privilege('service_role','public.account_protection_list_events','update,delete,truncate')"), "f");
  assert.equal(await query(port, "select count(*) from pg_indexes where schemaname='public' and indexname like 'account_protection_list_%_idx'"), "8");

  const call = (id, key, expected, items) => `set local role service_role; select public.mutate_account_protection_list(
    '${id}','interaction_blacklist','replace',array[${items.map((item) => `'${item}'`).join(",")} ]::text[],array[]::text[],array[]::text[],
    'api_test',null,'request-${key}','${key}',${expected},repeat('${key[0]}',64))::text`;
  const first = JSON.parse(await query(port, `begin; ${call(A, "a-key", 0, ["alpha"])}; commit;`));
  assert.equal(first.version, 1);
  assert.deepEqual(first.items, ["alpha"]);
  const replay = JSON.parse(await query(port, `begin; ${call(A, "a-key", 0, ["alpha"])}; commit;`));
  assert.equal(replay.replayed, true);
  assert.equal(await query(port, `select count(*) from public.account_protection_list_events where account_id='${A}'`), "1");
  const conflict = JSON.parse(await query(port, `begin; ${call(A, "b-key", 0, ["beta"])}; commit;`));
  assert.equal(conflict.error, "version_conflict");

  await query(port, `begin; ${call(B, "b-list", 0, ["beta"])}; ${call(C, "c-list", 0, ["gamma"])}; commit;`);
  assert.equal(await query(port, "select count(distinct account_id) from public.account_protection_list_entries where active"), "3");
  assert.equal(await query(port, `select string_agg(normalized_username,',' order by normalized_username) from public.account_protection_list_entries where account_id='${B}' and active`), "beta");

  for (const invalidSql of [
    `insert into public.account_protection_list_entries(account_id,list_kind,normalized_username,source_surface) values ('${A}','other','valid','test')`,
    `insert into public.account_protection_list_entries(account_id,list_kind,normalized_username,source_surface) values ('${A}','unfollow_whitelist','UPPER','test')`,
    `insert into public.account_protection_list_entries(account_id,list_kind,normalized_username,source_surface) values ('${A}','unfollow_whitelist','bad name','test')`,
    `insert into public.account_protection_list_entries(account_id,list_kind,normalized_username,source_surface) values ('${A}','unfollow_whitelist','https://instagram.com/u','test')`,
  ]) {
    await assert.rejects(query(port, invalidSql));
  }
  await query(port, `insert into public.account_protection_list_entries(account_id,list_kind,normalized_username,source_surface) values ('${A}','unfollow_whitelist','unique_name','test')`);
  await assert.rejects(query(port, `insert into public.account_protection_list_entries(account_id,list_kind,normalized_username,source_surface) values ('${A}','unfollow_whitelist','unique_name','test')`));

  await query(port, `delete from public.ig_accounts where id='${C}'`);
  assert.equal(await query(port, `select count(*) from public.account_protection_list_entries where account_id='${C}'`), "0");
  assert.equal(await query(port, `select count(*) from public.account_protection_list_events where account_id='${C}'`), "0");
  assert.equal(await query(port, `select count(*) from public.account_protection_list_versions where account_id='${C}'`), "0");

  await query(port, "delete from public.ig_accounts");
  await execFileAsync(PSQL, ["-X", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", String(port), "-d", "postgres", "-f", rollbackPath.pathname]);
  assert.equal(await query(port, "select count(*) from information_schema.tables where table_schema='public' and table_name like 'account_protection_list_%'"), "0");

  const migration = await readFile(migrationPath, "utf8");
  assert.doesNotMatch(migration, /ig_account_filters|ig_interacted_users|rex_gen_boost_ai/i);
});
