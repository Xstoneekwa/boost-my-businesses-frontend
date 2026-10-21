// Local HTTP -> real shared service -> real PostgreSQL RPC. No production URLs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const ts = require('/Users/admin/Projects/boost-ai-frontend/node_modules/typescript');
const root = path.resolve(__dirname, '..');
const socket = process.env.FLEET_TEST_PG_ROOT;
assert.match(socket || '', /^\/private\/tmp\/fleet-successor-rpc\.[A-Za-z0-9]+$/);
const pg = '/opt/homebrew/opt/postgresql@17/bin/psql';
const sql = (query) => execFileSync(pg, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket,
  '-p', '55483', '-d', 'postgres'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
let rpcCalls = 0;
function rpc(name, input, role = 'service_role') {
  assert.match(name, /^fleet_[a-z_0-9]+$/);
  assert.ok(['service_role', 'anon', 'authenticated'].includes(role));
  rpcCalls++;
  return JSON.parse(sql(`begin; set local role ${role}; set local request.jwt.claim.role='${role}';
    select public.${name}(${literal(JSON.stringify(input))}::jsonb); commit;`));
}
const id = (n) => `f1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), account = id(3);
sql(`create table public.tenant_users(user_id uuid not null,tenant_id uuid,role text not null);
create table public.ig_action_logs(account_id uuid,run_id uuid,target_username text,action_type text,
 status text,message text,payload jsonb,created_at timestamptz default now());
insert into public.tenant_users values('${actor}','${tenant}','superadmin');
insert into public.ig_accounts(id) values('${account}');
insert into public.client_instagram_accounts(account_id,client_id) values('${account}','${tenant}');`);
sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260907193846_fleet_policy_mutation_caller_v1.sql'), 'utf8'));

const modules = new Map();
function load(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const module = { exports: {} };
  const requireSource = (name) => {
    if (name === 'server-only') return {};
    if (name === '@/lib/supabase') return { createSupabaseClient: () => ({ rpc: async (name, args) => {
      try { return { data: rpc(name, args.p_input), error: null }; }
      catch (error) {
        const message = String(error.stderr || '').match(/ERROR:\s+([^\n]+)/)?.[1] || 'database_failure';
        return { data: null, error: { message } };
      }
    } }) };
    if (name === '../../_utils') return {
      // Upstream identity verification is a session fixture; canonical actor
      // resolution and live DB role/binding authorization are not replaced.
      resolveInstagramDashboardActor: async (request) => {
        const auth = load('lib/instagram-dashboard/instagram-dashboard-actor-auth.ts');
        const result = await auth.resolveInstagramDashboardActorAuth(request, {
          readRelayKey: () => null, verifyRelayKey: () => false, readBotAppOperatorId: () => null,
          getAdminContext: async () => request.headers.get('x-fixture-session') === 'admin' ? { userId: actor, role: 'superadmin' } : null,
          readAdminUserId: (context) => context?.userId,
          canAccessAdmin: (context) => context?.role === 'superadmin',
        });
        return result.ok ? result : { ok: false, response: Response.json({ ok: false }, { status: 401 }) };
      },
      readJsonBody: async (request) => { try { return await request.json(); } catch { return null; } },
      jsonOk: (data) => Response.json({ ok: true, data }),
      jsonError: (error, status) => Response.json({ ok: false, error }, { status }),
    };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    throw new Error(`Unmocked dependency: ${name}`);
  };
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(output, { exports: module.exports, module, require: requireSource,
    Response, Request, Headers, URL, console, process }, { filename: relative });
  modules.set(relative, module.exports);
  return module.exports;
}
let passed = 0;
const check = (name, condition) => { assert.ok(condition, name); passed++; console.log(`PASS ${name}`); };
const rejects = (name, fn, expected) => {
  assert.throws(fn, (error) => String(error.stderr || error).includes(expected), name);
  passed++; console.log(`PASS ${name}`);
};

async function main() {
  const route = load('app/api/instagram-dashboard/fleet/policy/route.ts');
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await route.POST(new Request('http://127.0.0.1/fleet/policy', {
        method: 'POST', headers: req.headers, body: Buffer.concat(chunks),
      }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const post = async (body, authorized = true) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { 'x-fixture-session': 'admin' } : {}) },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      assert.notEqual(response.status, 500, text);
      return { status: response.status, body: JSON.parse(text) };
    };
    const input = { account_id: account, tenant_id: tenant, request_id: id(10), action: 'set_cap', expected_revision: null, cap: 60 };
    let result = await post(input, false);
    check('unauthenticated_http_no_rpc', result.status === 401 && rpcCalls === 0);
    result = await post({ ...input, actor_id: actor });
    check('client_actor_injection_rejected', result.status === 400 && rpcCalls === 0);
    result = await post(input);
    check('http_service_rpc_cap_create', result.status === 200 && result.body.data.current_policy.revision === 1
      && result.body.data.current_policy.policy_payload.emergency_cap === 60);
    const original = result.body.data.receipt;
    result = await post(input);
    check('exact_replay_same_receipt', result.status === 200 && result.body.data.replayed
      && JSON.stringify(result.body.data.receipt) === JSON.stringify(original));
    result = await post({ ...input, cap: 55 });
    check('conflicting_replay_rejected', result.status === 409 && result.body.error === 'fleet_policy_replay_conflict');
    for (const role of ['anon', 'authenticated']) rejects(`${role}_receipt_not_disclosed`,
      () => rpc('fleet_mutate_policy_v1', { ...input, actor_id: actor }, role), 'permission denied');
    rejects('service_unknown_actor_before_replay', () => rpc('fleet_mutate_policy_v1', { ...input, actor_id: id(999) }), 'fleet_policy_actor_forbidden');
    result = await post({ ...input, request_id: id(11), expected_revision: 0 });
    check('optimistic_revision_rejected', result.status === 409);
    result = await post({ ...input, request_id: id(12), tenant_id: id(999), expected_revision: 1 });
    check('wrong_tenant_rejected', result.status === 403);
    result = await post({ ...input, request_id: id(13), cap: 55, expected_revision: 1 });
    check('cap_revision_two', result.status === 200 && result.body.data.current_policy.revision === 2
      && result.body.data.current_policy.policy_payload.emergency_cap === 55);
    const remove = { account_id: account, tenant_id: tenant, request_id: id(14), action: 'remove_cap', expected_revision: 2 };
    result = await post(remove);
    check('remove_only_overlay', result.status === 200 && result.body.data.current_policy.revision === 3
      && !('emergency_cap' in result.body.data.current_policy.policy_payload));
    result = await post({ ...remove, request_id: id(15), expected_revision: 3 });
    check('remove_noop_no_revision', result.status === 200 && !result.body.data.receipt.changed && result.body.data.current_policy.revision === 3);
    result = await post(input);
    check('replay_separates_receipt_from_current', result.status === 200 && result.body.data.receipt.after.revision === 1
      && result.body.data.current_policy.revision === 3);
    sql(`create function public.fixture_fail_fleet_audit() returns trigger language plpgsql as $$ begin
      raise exception 'fixture_audit_failure'; end $$;
      create trigger fixture_fail_fleet_audit before insert on public.ig_action_logs
        for each row execute function public.fixture_fail_fleet_audit();`);
    result = await post({ ...input, request_id: id(16), expected_revision: 3 });
    check('audit_failure_rolls_back_policy', result.status === 503
      && sql(`select revision from public.fleet_account_policy_v1 where account_id='${account}'`) === '3');
    sql('drop trigger fixture_fail_fleet_audit on public.ig_action_logs; drop function public.fixture_fail_fleet_audit();');
    check('atomic_audit_exact_count', sql("select count(*) from public.ig_action_logs where action_type='fleet_policy_mutation_v1'") === '4');
    console.log(JSON.stringify({ POLICY_CALLER_TESTS: `${passed}/${passed} PASS`, REAL_SQL_RPC_CALLS: rpcCalls,
      AUTH_SESSION_SOURCE: 'EXPLICIT_TEST_SESSION', POLICY_MUTATION_SOURCE: 'HTTP_SERVICE_REAL_SQL_RPC',
      EMERGENCY_CAP_E2E: 'NOT_ASSERTED', PRODUCTION_CHANGED: 'NO' }));
  } finally { await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
