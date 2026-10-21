import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const INITDB = "/opt/homebrew/bin/initdb";
const PG_CTL = "/opt/homebrew/bin/pg_ctl";
const PSQL = "/opt/homebrew/bin/psql";
const MIGRATION = new URL(
  "../../supabase/migrations/20260901193835_incident_dashboard_action_lineage_repair_v1.sql",
  import.meta.url,
);

function psqlArgs(socketDir, port) {
  return ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", socketDir, "-p", String(port), "-d", "postgres"];
}

async function query(socketDir, port, sql) {
  const { stdout } = await execFileAsync(PSQL, [...psqlArgs(socketDir, port), "-c", sql]);
  return stdout.trim();
}

test("incident/action lineage repair is exact, idempotent and preserves standalone behavior", { timeout: 90_000 }, async (t) => {
  const root = await mkdtemp("/private/tmp/incident-action-lineage-pg17-");
  const dataDir = path.join(root, "data");
  const socketDir = path.join(root, "socket");
  const logPath = path.join(root, "postgres.log");
  const bootstrapPath = path.join(root, "bootstrap.sql");
  const port = 56200 + Math.floor(Math.random() * 200);
  const accountResolved = "10000000-0000-4000-8000-000000000001";
  const accountActive = "10000000-0000-4000-8000-000000000002";
  const accountArchived = "10000000-0000-4000-8000-000000000003";
  const accountAmbiguous = "10000000-0000-4000-8000-000000000004";
  const accountStandalone = "10000000-0000-4000-8000-000000000005";
  const resolvedIncident = "20000000-0000-4000-8000-000000000001";
  const activeIncident = "20000000-0000-4000-8000-000000000002";
  const archivedIncident = "20000000-0000-4000-8000-000000000003";
  const ambiguousIncidentA = "20000000-0000-4000-8000-000000000004";
  const ambiguousIncidentB = "20000000-0000-4000-8000-000000000005";
  const runResolved = "30000000-0000-4000-8000-000000000001";
  const runActive = "30000000-0000-4000-8000-000000000002";
  const runArchived = "30000000-0000-4000-8000-000000000003";
  const runAmbiguous = "30000000-0000-4000-8000-000000000004";
  const actionResolved = "40000000-0000-4000-8000-000000000001";
  const actionActive = "40000000-0000-4000-8000-000000000002";
  const actionArchived = "40000000-0000-4000-8000-000000000003";
  const actionAmbiguous = "40000000-0000-4000-8000-000000000004";
  const actionStandalone = "40000000-0000-4000-8000-000000000005";

  const bootstrap = `
    create extension if not exists pgcrypto;
    do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
    do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
    create schema auth;
    create function auth.role() returns text language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;

    create table public.account_incidents (
      id uuid primary key,
      account_id uuid not null,
      run_id uuid,
      incident_type text not null,
      status text not null,
      created_at timestamptz not null,
      resolved_at timestamptz,
      archived_at timestamptz
    );
    create table public.account_dashboard_actions (
      id uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      account_id uuid not null,
      client_id uuid,
      incident_id uuid,
      action_type text not null,
      status text not null,
      severity text not null default 'warning',
      audience text not null default 'admin',
      requires_client_action boolean not null default false,
      blocking_campaign boolean not null default true,
      title text not null,
      safe_client_message text,
      assistant_message text,
      admin_message text,
      action_label text,
      action_deep_link text,
      dedupe_key text not null,
      metadata jsonb not null default '{}'::jsonb,
      metadata_safe jsonb not null default '{}'::jsonb,
      resolved_at timestamptz
    );
    create unique index account_dashboard_actions_active_dedupe
      on public.account_dashboard_actions(dedupe_key)
      where status in ('pending','acknowledged','pending_verification');

    create function public.upsert_account_dashboard_action(
      p_account_id uuid, p_action_type text, p_title text, p_dedupe_key text,
      p_client_id uuid default null, p_incident_id uuid default null,
      p_status text default 'pending', p_severity text default 'warning',
      p_audience text default 'client', p_requires_client_action boolean default true,
      p_blocking_campaign boolean default false, p_safe_client_message text default null,
      p_assistant_message text default null, p_admin_message text default null,
      p_action_label text default null, p_action_deep_link text default null,
      p_metadata jsonb default '{}'::jsonb
    ) returns public.account_dashboard_actions language plpgsql as $$
    declare v_row public.account_dashboard_actions;
    begin
      select * into v_row from public.account_dashboard_actions
      where dedupe_key=p_dedupe_key and status in ('pending','acknowledged','pending_verification')
      for update;
      if found then
        update public.account_dashboard_actions set
          incident_id=coalesce(p_incident_id, incident_id), status=p_status,
          metadata=metadata || coalesce(p_metadata,'{}'::jsonb), updated_at=now()
        where id=v_row.id returning * into v_row;
        return v_row;
      end if;
      insert into public.account_dashboard_actions(
        account_id,client_id,incident_id,action_type,status,severity,audience,
        requires_client_action,blocking_campaign,title,safe_client_message,
        assistant_message,admin_message,action_label,action_deep_link,dedupe_key,metadata
      ) values (
        p_account_id,p_client_id,p_incident_id,p_action_type,p_status,p_severity,p_audience,
        p_requires_client_action,p_blocking_campaign,p_title,p_safe_client_message,
        p_assistant_message,p_admin_message,p_action_label,p_action_deep_link,p_dedupe_key,p_metadata
      ) returning * into v_row;
      return v_row;
    end $$;

    create function public.upsert_login_challenge_dashboard_action(
      p_account_id uuid, p_action_type text, p_title text, p_dedupe_key text,
      p_client_id uuid default null, p_status text default 'pending',
      p_severity text default 'warning', p_audience text default 'client',
      p_requires_client_action boolean default true, p_blocking_campaign boolean default true,
      p_safe_client_message text default null, p_assistant_message text default null,
      p_admin_message text default null, p_action_label text default null,
      p_action_deep_link text default null, p_metadata jsonb default '{}'::jsonb
    ) returns public.account_dashboard_actions language sql as $$
      select public.upsert_account_dashboard_action(
        p_account_id,p_action_type,p_title,p_dedupe_key,p_client_id,null,p_status,
        p_severity,p_audience,p_requires_client_action,p_blocking_campaign,
        p_safe_client_message,p_assistant_message,p_admin_message,p_action_label,
        p_action_deep_link,p_metadata
      )
    $$;

    insert into public.account_incidents values
      ('${resolvedIncident}','${accountResolved}','${runResolved}','instagram_ads_data_consent_popup_requires_operator','resolved','2026-09-01T04:01:49.385Z','2026-09-01T05:00:00Z',null),
      ('${activeIncident}','${accountActive}','${runActive}','instagram_ads_data_consent_popup_requires_operator','open','2026-09-01T06:00:00Z',null,null),
      ('${archivedIncident}','${accountArchived}','${runArchived}','instagram_ads_data_consent_popup_requires_operator','archived','2026-09-01T07:00:00Z','2026-09-01T07:30:00Z','2026-09-01T07:30:00Z'),
      ('${ambiguousIncidentA}','${accountAmbiguous}','${runAmbiguous}','instagram_ads_data_consent_popup_requires_operator','resolved','2026-09-01T08:00:00Z','2026-09-01T08:30:00Z',null),
      ('${ambiguousIncidentB}','${accountAmbiguous}','${runAmbiguous}','instagram_ads_data_consent_popup_requires_operator','resolved','2026-09-01T08:00:00.100Z','2026-09-01T08:30:00Z',null);

    insert into public.account_dashboard_actions(id,created_at,updated_at,account_id,action_type,status,title,dedupe_key,metadata) values
      ('${actionResolved}','2026-09-01T04:01:49.685Z','2026-09-01T04:01:49.685Z','${accountResolved}','review_login_challenge','pending','resolved pair','account:${accountResolved}:dashboard_action:review_login_challenge:instagram_ads_data_consent_popup',jsonb_build_object('run_id','${runResolved}','screen_type','instagram_ads_data_consent_popup')),
      ('${actionActive}','2026-09-01T06:00:00.300Z','2026-09-01T06:00:00.300Z','${accountActive}','review_login_challenge','pending','active pair','account:${accountActive}:dashboard_action:review_login_challenge:instagram_ads_data_consent_popup',jsonb_build_object('run_id','${runActive}','screen_type','instagram_ads_data_consent_popup')),
      ('${actionArchived}','2026-09-01T07:00:00.300Z','2026-09-01T07:00:00.300Z','${accountArchived}','review_login_challenge','pending','archived pair','account:${accountArchived}:dashboard_action:review_login_challenge:instagram_ads_data_consent_popup',jsonb_build_object('run_id','${runArchived}','screen_type','instagram_ads_data_consent_popup')),
      ('${actionAmbiguous}','2026-09-01T08:00:00.300Z','2026-09-01T08:00:00.300Z','${accountAmbiguous}','review_login_challenge','pending','ambiguous pair','account:${accountAmbiguous}:dashboard_action:review_login_challenge:instagram_ads_data_consent_popup',jsonb_build_object('run_id','${runAmbiguous}','screen_type','instagram_ads_data_consent_popup')),
      ('${actionStandalone}','2026-09-01T09:00:00Z','2026-09-01T09:00:00Z','${accountStandalone}','review_login_challenge','pending','standalone','account:${accountStandalone}:dashboard_action:review_login_challenge:standalone','{}'::jsonb);
  `;

  await execFileAsync(INITDB, ["-D", dataDir, "--no-locale", "--encoding=UTF8", "--auth=trust"]);
  await execFileAsync("/bin/mkdir", ["-p", socketDir]);
  await execFileAsync(PG_CTL, ["-D", dataDir, "-l", logPath, "-o", `-p ${port} -k ${socketDir} -c listen_addresses=''`, "-w", "start"]);
  t.after(async () => {
    await execFileAsync(PG_CTL, ["-D", dataDir, "-m", "fast", "-w", "stop"]).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(bootstrapPath, bootstrap);
  await execFileAsync(PSQL, [...psqlArgs(socketDir, port), "-f", bootstrapPath]);
  await execFileAsync(PSQL, [...psqlArgs(socketDir, port), "-f", MIGRATION.pathname]);
  await execFileAsync(PSQL, [...psqlArgs(socketDir, port), "-f", MIGRATION.pathname]);

  assert.equal(await query(socketDir, port, `select incident_id from public.account_dashboard_actions where id='${actionResolved}'`), resolvedIncident);
  assert.equal(await query(socketDir, port, `select status||':'||blocking_campaign from public.account_dashboard_actions where id='${actionResolved}'`), "resolved:false");
  assert.equal(await query(socketDir, port, `select incident_id from public.account_dashboard_actions where id='${actionActive}'`), activeIncident);
  assert.equal(await query(socketDir, port, `select status||':'||blocking_campaign from public.account_dashboard_actions where id='${actionActive}'`), "pending:true");
  assert.equal(await query(socketDir, port, `select incident_id from public.account_dashboard_actions where id='${actionArchived}'`), archivedIncident);
  assert.equal(await query(socketDir, port, `select status||':'||blocking_campaign from public.account_dashboard_actions where id='${actionArchived}'`), "resolved:false");
  assert.equal(await query(socketDir, port, `select incident_id from public.account_dashboard_actions where id='${actionAmbiguous}'`), "");
  assert.equal(await query(socketDir, port, `select incident_id from public.account_dashboard_actions where id='${actionStandalone}'`), "");

  const effectiveBlockerCount = (accountId) => query(socketDir, port, `
    select count(*) from public.account_dashboard_actions action
    where action.account_id='${accountId}' and action.blocking_campaign
      and action.status in ('pending','acknowledged','pending_verification','code_submitted')
      and (action.incident_id is null or exists (
        select 1 from public.account_incidents incident
        where incident.id=action.incident_id and incident.account_id=action.account_id
          and incident.status in ('open','acknowledged')
          and incident.resolved_at is null and incident.archived_at is null
      ))`);
  assert.equal(await effectiveBlockerCount(accountResolved), "0");
  assert.equal(await effectiveBlockerCount(accountArchived), "0");
  assert.equal(await effectiveBlockerCount(accountActive), "1");
  assert.equal(await effectiveBlockerCount(accountStandalone), "1");

  const futureDedupe = `account:${accountResolved}:dashboard_action:review_login_challenge:future`;
  const futureIncident = "20000000-0000-4000-8000-000000000006";
  const first = await query(socketDir, port, `
    set request.jwt.claim.role='service_role';
    select (public.upsert_login_challenge_dashboard_action(
      p_account_id=>'${accountResolved}', p_action_type=>'review_login_challenge',
      p_title=>'future linked', p_dedupe_key=>'${futureDedupe}',
      p_incident_id=>'${futureIncident}', p_metadata=>'{}'::jsonb
    )).incident_id`);
  assert.equal(first, futureIncident);
  const replay = await query(socketDir, port, `
    set request.jwt.claim.role='service_role';
    select (public.upsert_login_challenge_dashboard_action(
      p_account_id=>'${accountResolved}', p_action_type=>'review_login_challenge',
      p_title=>'future linked', p_dedupe_key=>'${futureDedupe}',
      p_metadata=>'{}'::jsonb
    )).incident_id`);
  assert.equal(replay, futureIncident);
  assert.equal(await query(socketDir, port, `select count(*) from public.account_dashboard_actions where dedupe_key='${futureDedupe}'`), "1");
  assert.equal(await query(socketDir, port, "select has_function_privilege('anon','public.upsert_login_challenge_dashboard_action(uuid,text,text,text,uuid,text,text,text,boolean,boolean,text,text,text,text,text,jsonb,uuid)','execute')"), "f");
  assert.equal(await query(socketDir, port, "select has_function_privilege('service_role','public.upsert_login_challenge_dashboard_action(uuid,text,text,text,uuid,text,text,text,boolean,boolean,text,text,text,text,text,jsonb,uuid)','execute')"), "t");
  assert.equal(await query(socketDir, port, "select proconfig::text from pg_proc where oid='public.upsert_login_challenge_dashboard_action(uuid,text,text,text,uuid,text,text,text,boolean,boolean,text,text,text,text,text,jsonb,uuid)'::regprocedure"), "{\"search_path=\\\"\\\"\"}");
});
