import assert from "node:assert/strict";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

// Opt-in SQL only. This harness cannot connect to a network/shared database.
const socket = process.env.BMB_DINUM_TEST_SOCKET;
const psql = "/opt/homebrew/opt/postgresql@17/bin/psql";
const migrations = new URL("../migrations/", import.meta.url);
const matches = readdirSync(migrations).filter(f => f.endsWith("_commercial_france_dinum_transport_ledger_v1.sql"));
assert.equal(matches.length, 1);
const migration = readFileSync(new URL(matches[0], migrations), "utf8");
const old = readFileSync(new URL("20261007204919_commercial_france_canary_controls_v1.sql", migrations), "utf8");
const gate = readFileSync(new URL("20261018232910_commercial_france_latency_stop_finalization_v1.sql", migrations), "utf8");
const section = (start, end) => old.slice(old.indexOf(start), old.indexOf(end));
const baseReserve = section("create or replace function public.reserve_commercial_france_provider_call_v1(", "create or replace function public.finish_commercial_france_provider_call_v1(");
const baseFinish = section("create or replace function public.finish_commercial_france_provider_call_v1(", "create or replace function public.evaluate_commercial_france_run_gate_v1(");
const providerTable = section("create table public.commercial_france_provider_calls (", "create table public.commercial_france_identity_claims (");
const id = "00000000-0000-4000-8000-000000000801";
const historyId = "00000000-0000-4000-8000-000000000800";
const concurrentId = "00000000-0000-4000-8000-000000000802";
const claims = `set local request.jwt.claims='{"role":"service_role"}';`;
const args = ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", socket || "/invalid", "-p", "55489", "-U", "admin", "-d", "postgres"];
const env = { ...process.env, PGPASSFILE: `${socket}/unused-password-file`, PGSSLMODE: "disable" };
delete env.PGHOSTADDR; delete env.PGSERVICE;
function safeLocal() {
  assert.match(socket || "", /^\/private\/tmp\/bmb-dinum-ledger-pg-[A-Za-z0-9]+$/);
  assert.equal(realpathSync(socket), socket);
  assert.equal(readFileSync(`${socket}/data/PG_VERSION`, "utf8").trim(), "17");
}
function sql(query) {
  safeLocal();
  const r = spawnSync(psql, [...args, "-c", query], { encoding: "utf8", env });
  if (r.status !== 0) throw new Error(r.stderr || "Local SQL failed");
  return r.stdout.trim();
}
function asyncSql(query) {
  safeLocal();
  return new Promise((resolve, reject) => {
    const child = spawn(psql, [...args, "-c", query], { env });
    let out = "", error = "";
    child.stdout.on("data", b => { out += b; }); child.stderr.on("data", b => { error += b; });
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(out.trim()) : reject(new Error(error || "Local concurrent SQL failed")));
  });
}
const fixture = (runId = id, state = "running", country = "FR") => `
insert into public.commercial_discovery_runs(id,country_code,status) values('${runId}','${country}','running');
insert into public.commercial_france_run_controls(run_id,state,budget_limits_safe,thresholds_safe) values('${runId}','${state}',
'{"sirene":2,"searchapi_discovery":60,"searchapi_resolver":10,"public_profiles":10,"site_pages":15,"openai_scoring":4}',
'{"sample_min":10,"latency_p95_max_ms":15000,"provider_error_rate_max":0.2}');`;
const reserve = (provider = "dinum", kind = "sirene", key = "dinum:item:initial", runId = id) => `public.reserve_commercial_france_provider_call_v1('${runId}','${provider}','${kind}','${key}')`;
function check(action = "", expression = reserve()) {
  return JSON.parse(sql(`begin; ${claims} ${fixture()} ${action} select ${expression}; rollback;`));
}
const dbtest = (name, fn) => test(name, { skip: !socket }, fn);

test("successor changes only provider CHECK and reservation admission; no budget/finish/gate/runtime rewrite", () => {
  assert.doesNotMatch(migration, /create\s+table|truncate|delete\s+from|update\s+public\.commercial_discovery_|create\s+or\s+replace\s+function\s+public\.(finish_|evaluate_|create_commercial_france)/i);
  assert.match(migration, /provider IN \('searchapi','sirene','openai','dinum'\)/);
  assert.match(migration, /p_provider='dinum' and p_call_kind is distinct from 'sirene'/);
  assert.match(migration, /where run_id=p_run_id and call_kind=p_call_kind and status <> 'cancelled'/);
  assert.match(migration, /commercial_france_run_controls where run_id = p_run_id for update/);
  assert.match(migration, /v_limit <= v_used/);
});

let historicalHash;
if (socket) {
  sql(`-- Only the guarded disposable Unix-socket cluster may reach this reset.
drop schema if exists auth cascade; drop schema public cascade; create schema public;
create schema auth;
do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb$$;
create table public.commercial_discovery_runs(id uuid primary key,country_code text,status text,provider_diagnostic_safe jsonb default '{}',
completed_at timestamptz,cancel_requested_at timestamptz,cancelled_at timestamptz,worker_locked_at timestamptz,worker_locked_by text,error_summary_safe jsonb default '{}');
create table public.commercial_france_run_controls(run_id uuid primary key references public.commercial_discovery_runs(id),state text,
stop_code text,stop_reason text,metrics_safe jsonb default '{}',budget_limits_safe jsonb,thresholds_safe jsonb);
${providerTable}
create table public.commercial_discovery_items(id uuid default gen_random_uuid(),run_id uuid,status text,selected_for_processing boolean default true,business_id uuid,enrichment_snapshot_safe jsonb default '{}',
completed_at timestamptz,next_attempt_at timestamptz,locked_at timestamptz,locked_by text,error_code text,error_detail_safe jsonb default '{}');
create table public.commercial_discovery_audit_events(id uuid default gen_random_uuid(),run_id uuid,event_type text,reason_code text,metadata_safe jsonb);
${baseReserve} ${baseFinish} ${gate}
revoke all on function public.reserve_commercial_france_provider_call_v1(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.reserve_commercial_france_provider_call_v1(uuid,text,text,text) to service_role;
${fixture(historyId, "completed")}
insert into public.commercial_france_provider_calls(run_id,provider,call_kind,call_key,status) values('${historyId}','sirene','sirene','historical-direct-sirene','succeeded');`);
  historicalHash = sql(`select md5(to_jsonb(t)::text) from public.commercial_france_provider_calls t where run_id='${historyId}'`);
  sql(migration);
}

dbtest("DINUM transport accepted without aliasing to canonical identity provider", () => {
  const r = check(); assert.equal(r.reserved, true); assert.equal(r.limit, 2); assert.equal(r.used, 1);
});
dbtest("unknown transport rejected before any insertion", () => {
  const r = check("", reserve("unknown")); assert.equal(r.reserved, false); assert.equal(r.reason, "provider_call_kind_invalid");
});
dbtest("DINUM wrong unit rejected by both RPC and table CHECK", () => {
  assert.equal(check("", reserve("dinum", "profile")).reason, "provider_call_kind_invalid");
  assert.equal(check(`do $$begin
    begin insert into public.commercial_france_provider_calls(run_id,provider,call_kind,call_key) values('${id}','dinum','profile','invalid');
    raise exception 'bad_pair_was_accepted'; exception when check_violation then null; end;
  end$$;`, `to_jsonb((select count(*)=0 from public.commercial_france_provider_calls where run_id='${id}'))`), true);
});
for (const [provider, kind] of [["searchapi", "profile"], ["sirene", "sirene"], ["openai", "scoring"]]) {
  dbtest(`legacy ${provider}/${kind} preserved`, () => assert.equal(check("", reserve(provider, kind)).reserved, true));
}
dbtest("DINUM and direct Sirene share exactly two existing units, third reservation denied", () => {
  const r = check(`do $$begin perform ${reserve()}; perform ${reserve("sirene", "sirene", "direct:verification")}; end$$;`,
    `jsonb_build_object('reservation',${reserve("dinum", "sirene", "dinum:item:verification")},'rows',(select count(*) from public.commercial_france_provider_calls where run_id='${id}'))`);
  assert.equal(r.reservation.reserved, false); assert.equal(r.reservation.reason, "budget_exceeded");
  assert.equal(r.reservation.used, 2); assert.equal(r.reservation.limit, 2); assert.equal(r.rows, 2);
});
dbtest("same DINUM operation replays without additional reservation", () => {
  const r = check(`do $$begin perform ${reserve()}; end$$;`);
  assert.equal(r.reserved, false); assert.equal(r.reason, "idempotent_replay");
});
dbtest("different legitimate DINUM key may use remaining capacity", () => {
  const r = check(`do $$begin perform ${reserve()}; end$$;`, reserve("dinum", "sirene", "dinum:second:initial"));
  assert.equal(r.reserved, true); assert.equal(r.used, 2);
});
dbtest("zero/missing budget never grants implicit DINUM units", () => {
  assert.equal(check(`update public.commercial_france_run_controls set budget_limits_safe='{}' where run_id='${id}';`).reason, "budget_exceeded");
});
for (const state of ["hold", "stopped", "completed", "cancelled"]) {
  dbtest(`${state} continues blocking reservation`, () => {
    assert.equal(check(`update public.commercial_france_run_controls set state='${state}' where run_id='${id}';`).reason, "run_not_running");
  });
}
dbtest("ZA remains ineligible for France reservation", () => {
  assert.equal(check(`update public.commercial_discovery_runs set country_code='ZA' where id='${id}';`).reason, "france_control_missing");
});
dbtest("service-only invoker security preserved", () => {
  const r = JSON.parse(sql(`select jsonb_build_object('anon',has_function_privilege('anon','public.reserve_commercial_france_provider_call_v1(uuid,text,text,text)','execute'),
  'authenticated',has_function_privilege('authenticated','public.reserve_commercial_france_provider_call_v1(uuid,text,text,text)','execute'),
  'service',has_function_privilege('service_role','public.reserve_commercial_france_provider_call_v1(uuid,text,text,text)','execute'),
  'definer',(select prosecdef from pg_proc where oid='public.reserve_commercial_france_provider_call_v1(uuid,text,text,text)'::regprocedure));`));
  assert.deepEqual(r, { anon: false, authenticated: false, service: true, definer: false });
});
for (const status of ["succeeded", "failed", "skipped", "cancelled"]) {
  dbtest(`unchanged generic finish handles DINUM ${status}`, () => {
    const r = check(`do $$declare r jsonb; begin r := ${reserve()}; perform public.finish_commercial_france_provider_call_v1((r->>'call_id')::uuid,'${status}',5,0,'sql_fixture'); end$$;`,
      `(select jsonb_build_object('provider',provider,'status',status,'finished',finished_at is not null) from public.commercial_france_provider_calls where run_id='${id}')`);
    assert.deepEqual(r, { provider: "dinum", status, finished: true });
  });
}
dbtest("unchanged latency/circuit breaker treats DINUM as existing unit and STOP finalizes", () => {
  const r = check(`do $$declare r jsonb; begin r := ${reserve()}; perform public.finish_commercial_france_provider_call_v1((r->>'call_id')::uuid,'succeeded',15001,0); end$$;`, `public.evaluate_commercial_france_run_gate_v1('${id}')`);
  assert.equal(r.state, "stopped"); assert.equal(r.stop_code, "latency_p95_exceeded");
});
dbtest("historical transport row remains exactly unchanged", () => {
  assert.equal(sql(`select md5(to_jsonb(t)::text) from public.commercial_france_provider_calls t where run_id='${historyId}'`), historicalHash);
});
dbtest("concurrent distinct reservations cannot exceed shared capacity", async () => {
  // Committed fixtures exist only inside this disposable local database.
  sql(fixture(concurrentId));
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => asyncSql(`begin; ${claims} select ${reserve(i % 2 ? "sirene" : "dinum", "sirene", `concurrent:${i}`, concurrentId)}; commit;`)));
  const values = results.map(JSON.parse);
  assert.equal(values.filter(v => v.reserved).length, 2);
  assert.equal(values.filter(v => v.reason === "budget_exceeded").length, 6);
  assert.equal(sql(`select count(*) from public.commercial_france_provider_calls where run_id='${concurrentId}'`), "2");
});
dbtest("concurrent replay of one key consumes only one unit", async () => {
  const replayId = "00000000-0000-4000-8000-000000000803";
  sql(fixture(replayId));
  const results = await Promise.all(Array.from({ length: 6 }, () => asyncSql(`begin; ${claims} select ${reserve("dinum", "sirene", "dinum:same:initial", replayId)}; commit;`)));
  const values = results.map(JSON.parse);
  assert.equal(values.filter(v => v.reserved).length, 1);
  assert.equal(values.filter(v => v.reason === "idempotent_replay").length, 5);
});
