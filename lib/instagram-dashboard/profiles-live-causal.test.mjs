import test from 'node:test';
import assert from 'node:assert/strict';
import { withProfilesLiveTrace, traceStep, traceMetric, traceFallback, causalFetch, CAUSAL_MAX_SPANS, CAUSAL_MAX_LOG_BYTES } from './profiles-live-causal.ts';

const actualDateNow = Date.now;
test.before(() => { Date.now = () => Date.parse('2026-09-10T12:00:00Z'); });
test.after(() => { Date.now = actualDateNow; });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function capture(fn) {
  const original = console.info;
  const logs = [];
  console.info = (tag, line) => { if (tag === 'PROFILES_LIVE_CAUSAL_V2') logs.push(JSON.parse(line)); };
  try { const value = await fn(); return { value, logs }; } finally { console.info = original; }
}
const request = () => new Request('https://example.test/profiles/live');

test('parallel contexts, nested identity, rows, failure and fallback remain isolated', async () => {
  const { logs } = await capture(() => Promise.all(['request-a', 'request-b'].map((id, i) => withProfilesLiveTrace(request(), id, `corr-${id}`, async () => {
    const shared = traceStep('shared', async () => {
      await traceStep('shared.read', async () => { await wait(3 + i); return { data: [{ secret: 'not-logged' }], error: null }; });
      return traceStep('shared.failed_read', () => { traceFallback('existing_fallback'); return { data: [], error: { code: '42P01', message: 'secret-failure' } }; });
    });
    const runtime = traceStep('runtime.requested', async () => { await wait(2); return []; });
    await shared; await runtime;
    traceMetric('profile_count', 1);
    return new Response('same body');
  }))));
  for (const id of ['request-a', 'request-b']) {
    const events = logs.filter(e => e.request_id === id);
    assert.ok(events.length >= 2);
    assert.ok(events.every(e => e.correlation_id === `corr-${id}`));
    const spans = events.flatMap(e => e.spans || []);
    const shared = spans.find(s => s.operation === 'shared');
    const child = spans.find(s => s.operation === 'shared.read');
    const failure = spans.find(s => s.operation === 'shared.failed_read');
    assert.equal(child.parent_id, shared.id);
    assert.equal(child.rows, 1);
    assert.equal(failure.result, 'fail');
    assert.equal(failure.error_class, '42P01');
    assert.equal(failure.fallback, 'existing_fallback');
    assert.ok(spans.find(s => s.operation === 'runtime.requested').start_ms < shared.end_ms);
  }
  assert.doesNotMatch(JSON.stringify(logs), /not-logged|secret-failure/);
});

test('observation records abort without cancellation; errors and Response identities unchanged', async () => {
  const controller = new AbortController();
  const req = new Request('https://example.test', { signal: controller.signal });
  const response = new Response('ok');
  const { value, logs } = await capture(() => withProfilesLiveTrace(req, 'abort', 'abort-corr', async () => {
    controller.abort(); await wait(4); return response;
  }));
  assert.equal(value, response);
  const summary = logs.find(e => e.kind === 'summary');
  assert.equal(summary.client_abort_observed, true);
  assert.ok(summary.server_continued_after_abort_ms >= 3);
  const error = new Error('original');
  await capture(() => assert.rejects(withProfilesLiveTrace(request(), 'error', '', () => traceStep('fail', () => { throw error; })), e => e === error));
});

test('HTTP wrapper never rereads, records body bytes and preserves nonextensible responses', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return new Response('{"ok":true}'); };
    const { value, logs } = await capture(() => withProfilesLiveTrace(request(), 'http', 'http', async () => {
      const res = await causalFetch('https://example.test');
      assert.equal(await res.text(), '{"ok":true}');
      await assert.rejects(res.text());
      return new Response('unchanged');
    }));
    assert.equal(await value.text(), 'unchanged'); assert.equal(calls, 1);
    const span = logs.flatMap(e => e.spans || []).find(s => s.operation === 'http.dependency');
    assert.equal(span.payload_bytes, 11); assert.equal(span.parse_ms, null);
    const sealed = Object.preventExtensions(new Response('sealed'));
    globalThis.fetch = async () => sealed;
    await capture(() => withProfilesLiveTrace(request(), 'sealed', '', async () => {
      assert.equal(await causalFetch('https://example.test'), sealed);
      assert.equal(await sealed.text(), 'sealed'); return new Response('ok');
    }));
  } finally { globalThis.fetch = originalFetch; }
});

test('post-join runtime work is attributed separately from initial parallel join', async () => {
  const { logs } = await capture(() => withProfilesLiveTrace(request(), 'tail', '', async () => {
    await Promise.all([traceStep('shared', () => []), traceStep('runtime.requested', () => [])]);
    await traceStep('runtime.missing', async () => { await wait(5); return []; });
    return new Response('ok');
  }));
  const summary = logs.find(e => e.kind === 'summary');
  assert.equal(summary.critical_path, 'RUNTIME');
  assert.ok(summary.post_join_runtime_ms >= 4);
});

test('trace volume capped, missing spans explicit, and log sink failure preserves response', async () => {
  const { logs } = await capture(() => withProfilesLiveTrace(request(), 'bounded', '', async () => {
    for (let i = 0; i < CAUSAL_MAX_SPANS + 10; i++) await traceStep('small', () => []);
    return new Response('ok');
  }));
  assert.ok(logs.reduce((n, e) => n + Buffer.byteLength(JSON.stringify(e)), 0) <= CAUSAL_MAX_LOG_BYTES);
  assert.equal(logs.find(e => e.kind === 'summary').complete, false);
  const original = console.info;
  console.info = () => { throw new Error('sink failure'); };
  try { assert.equal(await (await withProfilesLiveTrace(request(), 'sink', '', async () => new Response('ok'))).text(), 'ok'); }
  finally { console.info = original; }
});

test('disabled observation emits nothing and preserves result', async () => {
  const prior = process.env.PROFILES_LIVE_CAUSAL_DISABLED;
  process.env.PROFILES_LIVE_CAUSAL_DISABLED = '1';
  try {
    const { value, logs } = await capture(() => withProfilesLiveTrace(request(), 'off', '', async () => traceStep('unused', () => new Response('off'))));
    assert.equal(await value.text(), 'off'); assert.equal(logs.length, 0);
  } finally { if (prior === undefined) delete process.env.PROFILES_LIVE_CAUSAL_DISABLED; else process.env.PROFILES_LIVE_CAUSAL_DISABLED = prior; }
});

test('expired causal observation preserves response without emitting', async () => {
 const saved=Date.now; Date.now=()=>Date.parse('2026-09-12T00:00:00Z');
 try { const response=new Response('unchanged'); const {value,logs}=await capture(()=>withProfilesLiveTrace(request(),'expired','',()=>response));
 assert.equal(value,response); assert.deepEqual(logs,[]); } finally {Date.now=saved;}
});
