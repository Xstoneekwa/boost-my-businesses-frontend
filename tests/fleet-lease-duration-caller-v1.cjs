// Real configuration parser, producer expressions and enqueue RPC wrapper.
// RPC transport is captured locally; no network or production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');
const ts = require('/Users/admin/Projects/boost-ai-frontend/node_modules/typescript/lib/typescript.js');
const root = path.resolve(__dirname, '..');
const relative = 'lib/instagram-dashboard/auto-restart-tick.ts';
const current = ts.createSourceFile(relative, fs.readFileSync(path.join(root, relative), 'utf8'), ts.ScriptTarget.Latest, true);
const previous = ts.createSourceFile(relative, cp.execFileSync('git', ['show', 'HEAD:' + relative], {cwd: root, encoding: 'utf8'}), ts.ScriptTarget.Latest, true);
function functions(source, names) {
  const found = source.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text));
  assert.equal(found.length, names.length);
  return found.map(n => n.getText(source).replace(/^export /, '')).join('\n');
}
function evaluate(code, api) {
  const context = {AUTO_RESTART_TICK_SOURCE: 'auto_restart_tick'};
  const output = ts.transpileModule(code + '\nglobalThis.api = {' + api.join(',') + '};', {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS},
    reportDiagnostics: true,
  });
  assert.equal((output.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(output.outputText, context);
  return context.api;
}
const parser = functions(current, ['readAutoRestartTickEnv']);
assert.equal(parser, functions(previous, ['readAutoRestartTickEnv']), 'canonical configuration parser changed');
const before = evaluate(parser, ['readAutoRestartTickEnv']);
const after = evaluate(functions(current, ['readAutoRestartTickEnv', 'enqueueAutoRestartRequest', 'readString']), ['readAutoRestartTickEnv', 'enqueueAutoRestartRequest']);
const producers = [];
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(current) === 'device_lock_lease_seconds') producers.push(node.initializer.getText(current));
  ts.forEachChild(node, visit);
}
visit(current);
assert.deepEqual(producers.sort(), ['env.deviceLockLeaseSeconds', 'input.leaseSeconds']);
(async () => {
  const cases = [];
  for (const raw of [undefined, '600', '1200', '60', '3600', '45', '5000', 'invalid']) {
    const env = raw === undefined ? {} : {INSTAGRAM_AUTO_RESTART_DEVICE_LOCK_SECONDS: raw};
    const historical = before.readAutoRestartTickEnv(env).deviceLockLeaseSeconds;
    const configuration = after.readAutoRestartTickEnv(env);
    assert.equal(configuration.deviceLockLeaseSeconds, historical);
    for (const producer of producers) {
      const transported = vm.runInNewContext(producer, {env: configuration, input: {leaseSeconds: configuration.deviceLockLeaseSeconds}});
      const calls = [];
      await after.enqueueAutoRestartRequest({rpc: async (name, args) => {
        calls.push({name, args});
        return {data: {id: '00000000-0000-0000-0000-000000000001', status: 'queued'}, error: null};
      }}, {accountId: '20000000-0000-0000-0000-000000000001', workerId: 'fixture-dispatcher',
        idempotencyKey: 'fixture-duration', runType: 'account_session',
        metadata: {worker_id: 'fixture-dispatcher', device_lock_lease_seconds: transported}});
      assert.equal(calls.length, 1);
      assert.equal(calls[0].name, 'create_account_run_request');
      assert.equal(calls[0].args.p_metadata_safe.device_lock_lease_seconds, historical);
      cases.push({raw: raw ?? 'DEFAULT', producer, historical, transported});
    }
  }
  process.stdout.write(JSON.stringify({source: 'readAutoRestartTickEnv().deviceLockLeaseSeconds', cases}));
})().catch(error => {console.error(error); process.exitCode = 1;});
