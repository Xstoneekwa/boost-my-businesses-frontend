// Diagnostic: a real Release caller must not be confused with proven convergence.
// The initial Hold and upstream authenticated session are explicit local fixtures.
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
const literal = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const sql = (query) => execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',
  ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '55483', '-d', 'postgres'],
  { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const id = (n) => `f2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), tenant = id(2), account = id(3);
sql(`create table public.tenant_users(user_id uuid not null,tenant_id uuid,role text not null);
create table public.ig_action_logs(account_id uuid,run_id uuid,target_username text,action_type text,
 status text,message text,payload jsonb,created_at timestamptz default now());
insert into public.tenant_users values('${actor}','${tenant}','superadmin');
insert into public.ig_accounts(id) values('${account}');
insert into public.client_instagram_accounts(account_id,client_id) values('${account}','${tenant}');
insert into public.fleet_account_policy_v1(account_id,client_id,revision,hold_state)
 values('${account}','${tenant}',1,'REQUESTED');`);
sql(fs.readFileSync(path.join(root, 'supabase/migrations/20260907193846_fleet_policy_mutation_caller_v1.sql'), 'utf8'));
let calls = 0;
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const requireSource = (name) => {
    if (name === 'server-only') return {};
    if (name === '@/lib/supabase') return { createSupabaseClient: () => ({ rpc: async (name, args) => {
      assert.equal(name, 'fleet_mutate_policy_v1'); calls++;
      return { data: JSON.parse(sql(`begin; set local role service_role;
        select public.fleet_mutate_policy_v1(${literal(JSON.stringify(args.p_input))}::jsonb); commit;`)), error: null };
    } }) };
    if (name === '../../_utils') return {
      resolveInstagramDashboardActor: async (request) => {
        const result = await load('lib/instagram-dashboard/instagram-dashboard-actor-auth.ts').resolveInstagramDashboardActorAuth(request, {
          readRelayKey: () => null, verifyRelayKey: () => false, readBotAppOperatorId: () => null,
          getAdminContext: async () => ({ userId: actor, role: 'superadmin' }),
          readAdminUserId: (context) => context.userId, canAccessAdmin: (context) => context.role === 'superadmin',
        });
        assert.equal(result.ok, true); return result;
      },
      readJsonBody: (request) => request.json(),
      jsonOk: (data) => Response.json({ ok: true, data }),
      jsonError: (error, status) => Response.json({ ok: false, error }, { status }),
    };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    throw new Error(`Unexpected dependency ${name}`);
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: module.exports, module, require: requireSource, Request, Response, Headers, URL }, { filename: file });
  cache.set(file, module.exports); return module.exports;
}
async function main() {
  const route = load('app/api/instagram-dashboard/fleet/policy/route.ts');
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const response = await route.POST(new Request('http://127.0.0.1/fleet/policy', {
        method: 'POST', headers: req.headers, body: Buffer.concat(chunks),
      }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        account_id: account, tenant_id: tenant, request_id: id(4), action: 'release', expected_revision: 1,
      }) });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.data.current_policy.hold_state, 'RELEASING');
    assert.equal(body.data.current_policy.revision, 2);
    const observed = JSON.parse(sql(`select jsonb_build_object(
      'owners',(select count(*) from public.fleet_runtime_owners_v1 where account_id='${account}'),
      'requests',(select count(*) from public.account_run_requests where account_id='${account}'),
      'runs',(select count(*) from public.ig_runs where account_id='${account}'),
      'converged',public.fleet_current_revision_converged_v1('${account}',2,'RELEASE'),
      'admission_reason',public.fleet_admission_reason_v1('${account}'));`));
    assert.deepEqual(observed, { owners: 0, requests: 0, runs: 0, converged: false, admission_reason: 'fleet_hold_releasing' });
    let rejection = '';
    try {
      sql(`begin; set local role service_role; set local request.jwt.claim.role='service_role';
        select public.fleet_ack_runtime_revision_v1(${literal(JSON.stringify({ account_id: account,
          request_id: id(5), attempt_id: id(6), consumer_instance_id: 'fixture-idle-consumer',
          consumer_boot_id: 'fixture-idle-boot', revision: 2 }))}::jsonb); commit;`);
    } catch (error) { rejection = String(error.stderr || '').match(/ERROR:\s+([^\n]+)/)?.[1] || ''; }
    assert.ok(rejection, 'An invented owner must not acknowledge the release');
    console.log(JSON.stringify({ DIAGNOSTIC_EXECUTED: 'YES', REAL_POLICY_RPC_CALLS: calls,
      RELEASE_POLICY_WRITE: 'PASS', ...observed, UNREGISTERED_ACK_REJECTED: rejection,
      RELEASE_IDLE_CONVERGENCE: 'NOT_PROVEN', FIRST_BROKEN_BOUNDARY: 'RELEASE_CONVERGENCE_WITHOUT_REGISTERED_EXECUTION_OWNER',
      GUARDS_CHANGED: 'NO', PRODUCTION_CHANGED: 'NO', DEPLOY: 'NO' }));
  } finally { await new Promise((resolve) => server.close(resolve)); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
