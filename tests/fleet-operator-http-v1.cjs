// Real route/service -> real local PostgreSQL RPC. Only upstream login is a fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const socket = process.env.FLEET_OPERATOR_SOCKET;
const account = process.env.FLEET_OPERATOR_ACCOUNT;
assert.match(socket || '', /^\/private\/tmp\/fleet-operator-[a-zA-Z0-9_]+$/);
assert.match(account || '', /^[a-f0-9-]{36}$/);
const actor = 'fa000000-0000-4000-8000-000000000001';
const literal = value => "'" + String(value).replaceAll("'", "''") + "'";
let calls = 0;
const modules = new Map();
function load(relative) {
  if (modules.has(relative)) return modules.get(relative);
  const module = { exports: {} };
  function requireFixture(name) {
    if (name === 'server-only') return {};
    if (name === '@/lib/supabase') return { createSupabaseClient: () => ({ rpc: async (name, args) => {
      assert.match(name, /^fleet_operator_(targets|preview|apply|history)_v1$/);
      calls++;
      try {
        const output = execFileSync('/opt/homebrew/opt/postgresql@17/bin/psql',
          ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', socket, '-p', '55487', '-d', 'postgres'], {
            encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
            input: `begin; set local role service_role; select public.${name}(${literal(args.p_actor)}::uuid,${literal(JSON.stringify(args.p_input ?? args.p_scope))}::jsonb); commit;`,
          });
        return { data: JSON.parse(output.trim()), error: null };
      } catch (error) {
        const match = String(error.stderr).match(/ERROR:\s+([0-9A-Z]{5}):\s+([^\n]+)/);
        return { data: null, error: { code: match?.[1], message: match?.[2] || 'database_failure' } };
      }
    } }) };
    if (name === '@/app/api/instagram-dashboard/_utils') return {
      resolveInstagramDashboardActor: async request => request.headers.get('x-fixture-session') === 'admin'
        ? { ok: true, actor: { actorId: actor } }
        : { ok: false, response: Response.json({ ok: false }, { status: 401 }) },
      jsonOk: data => Response.json({ ok: true, data }),
      jsonError: (error, status) => Response.json({ ok: false, error }, { status }),
    };
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
    throw new Error(`Unexpected dependency: ${name}`);
  }
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(output, { module, exports: module.exports, require: requireFixture, Request, Response, Headers, URL, console }, { filename: relative });
  modules.set(relative, module.exports);
  return module.exports;
}
let passed = 0;
function check(name, condition) { assert.ok(condition, name); console.log(`PASS ${name}`); passed++; }
async function main() {
  const modes = { read: ['GET', ''], preview: ['POST', '/preview'], apply: ['POST', '/apply'], history: ['GET', '/history'] };
  const routes = Object.fromEntries(Object.entries(modes).map(([mode, [, suffix]]) => [mode, load(`app/api/instagram-dashboard/fleet${suffix}/route.ts`)]));
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      const mode = url.pathname.slice(1);
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request(url, { method: req.method, headers: req.headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
      const response = await routes[mode][req.method](request);
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  async function request(mode, input, authorized = true) {
    const method = modes[mode][0];
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${mode}${method === 'GET' ? '?input=' + encodeURIComponent(JSON.stringify(input)) : ''}`, {
      method, headers: { 'content-type': 'application/json', ...(authorized ? { 'x-fixture-session': 'admin' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(input) } : {}),
    });
    const text = await response.text(); assert.notEqual(response.status, 500, text);
    return { status: response.status, body: JSON.parse(text) };
  }
  try {
    for (const mode of Object.keys(modes)) {
      const before = calls;
      const result = await request(mode, {}, false);
      check(`unauthorized_${mode}_before_rpc`, result.status === 401 && calls === before);
    }
    const scope = { kind: 'SELECTED_ACCOUNTS', account_ids: [account] };
    let before = calls;
    let result = await request('read', scope);
    check('read_one_real_rpc', result.status === 200 && calls === before + 1 && result.body.data.targets[0].account_id === account);
    check('read_scope_counters', result.body.data.resolved_account_count === 1 && result.body.data.eligible_count === 1 && result.body.data.blocked_count === 0 && result.body.data.skipped_count === 0);
    const change = { operation: 'SET_CAP', scope, cap: 60 };
    before = calls;
    result = await request('preview', change);
    check('preview_one_real_rpc', result.status === 200 && calls === before + 1 && result.body.data.targets[0].classification === 'WILL_CHANGE');
    const input = { bulk_action_id: randomUUID(), preview_hash: result.body.data.preview_hash, change };
    before = calls;
    result = await request('apply', input);
    check('apply_one_real_rpc', result.status === 200 && calls === before + 1);
    const receipt = result.body.data.receipt;
    result = await request('apply', input);
    check('http_exact_replay', result.status === 200 && result.body.data.replayed && JSON.stringify(result.body.data.receipt) === JSON.stringify(receipt));
    result = await request('apply', { ...input, change: { ...change, cap: 55 } });
    check('http_conflicting_replay', result.status === 409);
    result = await request('apply', { ...input, bulk_action_id: randomUUID() });
    check('http_stale_preview', result.status === 409);
    before = calls;
    result = await request('history', { limit: 20 });
    check('history_one_real_rpc', result.status === 200 && calls === before + 1 && result.body.data.items.some(item => item.bulk_action_id === input.bulk_action_id));
    result = await request('preview', { ...change, actor_id: actor });
    check('http_actor_injection_rejected', result.status === 400);
    console.log(`FLEET_OPERATOR_HTTP_TESTS=${passed}/${passed} PASS`);
    console.log('DB_RPC_CALLS_PER_AUTHORIZED_OPERATION=1; PER_ACCOUNT_HTTP_FANOUT=0');
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
