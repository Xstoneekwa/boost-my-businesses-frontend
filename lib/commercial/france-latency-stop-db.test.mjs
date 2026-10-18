import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

// Real PL/pgSQL tests, restricted to an explicitly supplied task-local Unix
// socket. No shared DB URL, application credentials or provider is used.
const socket = process.env.BMB_FRANCE_TEST_SOCKET;
const psql = process.env.BMB_FRANCE_TEST_PSQL || "/opt/homebrew/opt/postgresql@17/bin/psql";
const migration = readFileSync(new URL("../../supabase/migrations/20261018232910_commercial_france_latency_stop_finalization_v1.sql", import.meta.url), "utf8");
const runId = "00000000-0000-4000-8000-000000000001";
function raw(query) {
  assert.match(socket || "", /^\/private\/tmp\/bmb-france-latency-pg-[A-Za-z0-9]+$/);
  const result = spawnSync(psql, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", socket, "-p", "55487", "-U", "admin", "-d", "postgres", "-c", query], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "Local SQL failed");
  return result.stdout.trim();
}
const setup = `
create schema auth;
create role anon; create role authenticated; create role service_role;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb$$;
create table public.commercial_discovery_runs (
 id uuid primary key,country_code text,status text check(status in('queued','running','completed','completed_with_errors','failed','cancelled','partial')),
 provider_diagnostic_safe jsonb not null default '{}',completed_at timestamptz,cancel_requested_at timestamptz,cancelled_at timestamptz,
 worker_locked_at timestamptz,worker_locked_by text,error_summary_safe jsonb not null default '{}'
);
create table public.commercial_france_run_controls (
 run_id uuid primary key references public.commercial_discovery_runs(id),state text check(state in('armed','running','hold','stopped','completed','cancelled')),
 stop_code text,stop_reason text,metrics_safe jsonb not null default '{}',budget_limits_safe jsonb not null,thresholds_safe jsonb not null
);
create table public.commercial_discovery_items (
 id uuid primary key default gen_random_uuid(),run_id uuid references public.commercial_discovery_runs(id),
 status text check(status in('pending','processing','retry_scheduled','completed','rejected','duplicate','possible_duplicate','excluded_client','failed','cancelled','not_selected','created','hard_rejected')),
 selected_for_processing boolean not null default true,business_id uuid,enrichment_snapshot_safe jsonb not null default '{}',
 completed_at timestamptz,next_attempt_at timestamptz,locked_at timestamptz,locked_by text,error_code text,error_detail_safe jsonb not null default '{}'
);
create table public.commercial_france_provider_calls (
 id uuid primary key default gen_random_uuid(),run_id uuid references public.commercial_discovery_runs(id),
 call_kind text check(call_kind in('discovery','resolver','profile','site_page','sirene','scoring')),
 status text check(status in('reserved','succeeded','failed','skipped','cancelled')),duration_ms integer
);
create table public.commercial_discovery_audit_events (
 id uuid primary key default gen_random_uuid(),run_id uuid,event_type text check(event_type in('precheck_completed','precheck_rejected','item_retry_scheduled','run_cancelled')),
 reason_code text,metadata_safe jsonb not null default '{}'
);`;
const fixture = `
insert into public.commercial_discovery_runs(id,country_code,status) values('${runId}','FR','running');
insert into public.commercial_france_run_controls(run_id,state,budget_limits_safe,thresholds_safe) values('${runId}','running',
 '{"searchapi_discovery":60,"searchapi_resolver":10,"site_pages":15,"public_profiles":10,"sirene":2,"openai_scoring":4}',
 '{"sample_min":10,"high_rate_min":0.1,"medium_rate_max":0.5,"duplicate_rate_max":0.3,"provider_error_rate_max":0.2,"latency_p95_max_ms":15000}');
insert into public.commercial_discovery_items(run_id,status) select '${runId}','pending' from generate_series(1,10);`;
const call = (kind, duration, count = 1, status = "succeeded") => `insert into public.commercial_france_provider_calls(run_id,call_kind,status,duration_ms) select '${runId}','${kind}','${status}',${duration} from generate_series(1,${count});`;
const evaluate = `do $$begin perform public.evaluate_commercial_france_run_gate_v1('${runId}'); end$$;`;
const snapshot = `jsonb_build_object(
 'run',(select to_jsonb(r) from public.commercial_discovery_runs r where id='${runId}'),
 'control',(select to_jsonb(c) from public.commercial_france_run_controls c where run_id='${runId}'),
 'items',(select jsonb_agg(to_jsonb(i) order by id) from public.commercial_discovery_items i where run_id='${runId}'),
 'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from public.commercial_discovery_audit_events a where run_id='${runId}'))`;
function check(sql, expression = snapshot) {
  return JSON.parse(raw(`begin; set local request.jwt.claims='{"role":"service_role"}'; ${fixture} ${sql} select ${expression}; rollback;`));
}
const dbtest = (name, fn) => test(name, { skip: !socket }, fn);
if (socket) raw(`
  drop function if exists public.evaluate_commercial_france_run_gate_v1(uuid);
  drop table if exists public.commercial_discovery_audit_events,public.commercial_france_provider_calls,
    public.commercial_discovery_items,public.commercial_france_run_controls,public.commercial_discovery_runs cascade;
  drop schema if exists auth cascade;
  do $$begin
    if exists(select 1 from pg_roles where rolname='anon') then drop role anon; end if;
    if exists(select 1 from pg_roles where rolname='authenticated') then drop role authenticated; end if;
    if exists(select 1 from pg_roles where rolname='service_role') then drop role service_role; end if;
  end$$;
` + setup + migration);

dbtest("batch discovery is visible but does not pollute the unchanged 15s unit gate", () => {
  const s = check(call("discovery", 65801) + call("profile", 4000, 5) + call("site_page", 9708, 5) + evaluate);
  assert.equal(s.control.state, "running");
  assert.equal(s.control.metrics_safe.latency_classes.discovery.p95_ms, 65801);
  assert.equal(s.control.metrics_safe.latency_classes.discovery.unit_gate_applies, false);
  assert.equal(s.control.metrics_safe.latency_p95_ms, 9708);
  assert.equal(s.control.thresholds_safe.latency_p95_max_ms, 15000);
});
dbtest("each operation class keeps its own P95; fast pages cannot hide a slow profile", () => {
  const s = check(call("profile", 16001) + call("site_page", 10, 15) + evaluate);
  assert.equal(s.control.state, "stopped");
  assert.equal(s.control.stop_code, "latency_p95_exceeded");
  assert.equal(s.control.metrics_safe.latency_p95_ms, 16001);
});
for (const kind of ["profile", "site_page", "resolver", "sirene", "scoring"]) {
  dbtest(`a genuinely slow ${kind} operation still stops the run`, () => {
    const s = check(call(kind, 15001) + evaluate);
    assert.equal(s.control.stop_code, "latency_p95_exceeded");
    assert.equal(s.run.status, "cancelled");
  });
}
dbtest("exactly 15s remains accepted; reserved/cancelled operations are not timed executions", () => {
  const s = check(call("profile", 15000) + call("site_page", 999999, 1, "cancelled") + call("sirene", 999999, 1, "reserved") + evaluate);
  assert.equal(s.control.state, "running");
  assert.equal(s.control.metrics_safe.latency_p95_ms, 15000);
});
dbtest("STOP terminalizes pending/retry items with the breaker reason, no automatic retry", () => {
  const s = check(`update public.commercial_discovery_items set status='retry_scheduled',next_attempt_at=now()+interval '1 hour';` + call("profile", 16000) + evaluate);
  assert.equal(s.run.status, "cancelled");
  assert.ok(s.run.completed_at && s.run.cancelled_at);
  assert.equal(s.audit.length, 1);
  assert.equal(s.audit[0].event_type, "run_cancelled");
  assert.equal(s.audit[0].reason_code, "latency_p95_exceeded");
  assert.equal(s.audit[0].metadata_safe.source, "france_circuit_breaker");
  for (const item of s.items) {
    assert.equal(item.status, "cancelled");
    assert.equal(item.error_detail_safe.reason, "circuit_breaker_stopped");
    assert.equal(item.error_detail_safe.stop_code, "latency_p95_exceeded");
    assert.equal(item.next_attempt_at, null);
    assert.ok(item.completed_at);
  }
});
dbtest("finalizer replay leaves every row, timestamp and audit unchanged", () => {
  const s = check(call("profile", 16000) + evaluate + `create temporary table first_pass as select ${snapshot} as data;
    create temporary table first_rows as select 'items' as kind,ctid::text as tuple,id::text as id from public.commercial_discovery_items
    union all select 'run',ctid::text,id::text from public.commercial_discovery_runs
    union all select 'control',ctid::text,run_id::text from public.commercial_france_run_controls;
    ${evaluate}`, `jsonb_build_object('same_data',(select data from first_pass)=${snapshot},'same_rows',not exists(
      (select * from first_rows) except (select 'items',ctid::text,id::text from public.commercial_discovery_items
       union all select 'run',ctid::text,id::text from public.commercial_discovery_runs
       union all select 'control',ctid::text,run_id::text from public.commercial_france_run_controls)))`);
  assert.deepEqual(s, { same_data: true, same_rows: true });
});
dbtest("in-flight work is not overwritten; its settled batch can finish the same sticky STOP", () => {
  const first = `update public.commercial_discovery_items set status='processing',locked_at=now() where id=(select id from public.commercial_discovery_items limit 1);`;
  let s = check(first + call("profile", 16000) + evaluate);
  assert.equal(s.control.state, "stopped");
  assert.equal(s.run.status, "running");
  assert.equal(s.items.filter(i => i.status === "processing").length, 1);
  assert.equal(s.items.filter(i => i.status === "cancelled").length, 9);
  s = check(first + call("profile", 16000) + evaluate + `update public.commercial_discovery_items set status='rejected',locked_at=null where status='processing';` + evaluate);
  assert.equal(s.run.status, "cancelled");
  assert.ok(s.run.completed_at);
  assert.equal(s.control.stop_code, "latency_p95_exceeded");
  assert.equal(s.items.filter(i => i.status === "rejected").length, 1);
});
dbtest("HOLD stays distinct from STOP and does not cancel its pending candidates", () => {
  const s = check(`update public.commercial_france_run_controls set state='hold',stop_code='high_rate_below_gate';` + call("profile", 16000) + evaluate);
  assert.equal(s.control.state, "hold");
  assert.equal(s.control.stop_code, "high_rate_below_gate");
  assert.equal(s.run.status, "running");
  assert.ok(s.items.every(i => i.status === "pending"));
  assert.equal(s.audit.length, 0);
});
for (const status of ["completed", "completed_with_errors"]) {
  dbtest(`${status} run and acquired results are preserved even if a gate stops`, () => {
    const s = check(`update public.commercial_discovery_runs set status='${status}',completed_at='2000-01-01Z';
      update public.commercial_discovery_items set status='rejected',completed_at='2000-01-01Z';` + call("profile", 16000) + evaluate);
    assert.equal(s.run.status, status);
    assert.equal(Date.parse(s.run.completed_at), Date.parse("2000-01-01T00:00:00Z"));
    assert.ok(s.items.every(i => i.status === "rejected"));
    assert.equal(s.audit.length, 0);
  });
}
dbtest("partial SERP timeouts remain distinct from successful logical batch operations", () => {
  const s = check(`update public.commercial_discovery_runs set provider_diagnostic_safe=jsonb_build_object('queryDiagnostics',
    (select jsonb_agg(jsonb_build_object('category',case when n<=9 then 'OK' else 'TIMEOUT' end)) from generate_series(1,14)n));` + call("discovery", 65801) + call("profile", 4000, 5) + evaluate);
  const m = s.control.metrics_safe;
  assert.equal(m.serp_attempts, 14); assert.equal(m.serp_successes, 9);
  assert.equal(m.serp_timeouts, 5); assert.equal(m.serp_error_attempts, 5);
  assert.equal(m.serp_timeout_rate, 0.3571);
  assert.equal(m.provider_failed, 0); assert.equal(m.provider_finished, 6);
  assert.equal(s.control.state, "running");
});
dbtest("actual logical provider failures retain the existing 20% circuit breaker", () => {
  const s = check(call("profile", 1000, 8) + call("profile", 1000, 2, "failed") + evaluate);
  assert.equal(s.control.stop_code, "provider_error_rate");
  assert.equal(s.control.metrics_safe.provider_error_rate, 0.2);
});
dbtest("missing SERP diagnostics report no observations, not a fabricated zero timeout rate", () => {
  const s = check(evaluate);
  assert.equal(s.control.metrics_safe.serp_attempts, 0);
  assert.equal(s.control.metrics_safe.serp_timeout_rate, null);
});
dbtest("profile budget remains exactly ten and an actual excess is still a STOP", () => {
  const s = check(call("profile", 1000, 11) + evaluate);
  assert.equal(s.control.budget_limits_safe.public_profiles, 10);
  assert.equal(s.control.stop_code, "budget_exceeded");
});
dbtest("migration reapplication changes definitions only, never existing historical rows", () => {
  const s = check(`create temporary table historical as select ${snapshot} as data; ${migration}`, `jsonb_build_object('unchanged',(select data from historical)=${snapshot})`);
  assert.equal(s.unchanged, true);
});
dbtest("ZA without a France control is untouched by applying the migration", () => {
  const s = check(`insert into public.commercial_discovery_runs(id,country_code,status) values('00000000-0000-4000-8000-000000000002','ZA','running');
    create temporary table za_before as select to_jsonb(r) as data from public.commercial_discovery_runs r where country_code='ZA'; ${migration} ${evaluate}`, `jsonb_build_object('unchanged',(select data from za_before)=(select to_jsonb(r) from public.commercial_discovery_runs r where country_code='ZA'))`);
  assert.equal(s.unchanged, true);
});
dbtest("anon/authenticated cannot execute the privileged gate", () => {
  const result = JSON.parse(raw(`select jsonb_build_object('anon',has_function_privilege('anon','public.evaluate_commercial_france_run_gate_v1(uuid)','execute'),
    'authenticated',has_function_privilege('authenticated','public.evaluate_commercial_france_run_gate_v1(uuid)','execute'),
    'service',has_function_privilege('service_role','public.evaluate_commercial_france_run_gate_v1(uuid)','execute'));`));
  assert.deepEqual(result, { anon: false, authenticated: false, service: true });
});
