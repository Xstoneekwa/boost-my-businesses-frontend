import { registerProfilesLiveObserver } from "./profiles-live-causal-context.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createTransportTrace, observeTransport, transportBodyConsumed, transportEvents } from "./profiles-live-transport.ts";
import type { TransportTrace } from "./profiles-live-transport.ts";

// Temporary diagnostic window. No disk log, payload capture, retries, or cancellation.
export const CAUSAL_EXPIRES_AT = "2026-09-11T20:00:00.000Z";
export const CAUSAL_MAX_SPANS = 256;
export const CAUSAL_MAX_LOG_BYTES = 64 * 1024;
const HOURLY_PROCESS_BYTES = 8 * 1024 * 1024;
const instanceId = randomUUID();
let requestSequence = 0;
let emissionHour = 0;
let emissionBytes = 0;
let budgetReported = false;
type Attribute = number | string | boolean | null;
type Span = {
  id: number; parent_id: number | null; operation: string;
  start_ms: number; end_ms: number | null; duration_ms: number | null;
  result: string; rows: number | null; payload_bytes: number | null;
  parse_ms: number | null; error_class: string | null; fallback: string | null;
  attributes: Record<string, Attribute>;
};
type Trace = {
  request_id: string; correlation_id: string; started_at: string; started: number;
  spans: Span[]; metrics: Record<string, Attribute>; dropped: number;
  abort_ms: number | null; overhead_ms: number; sequence: number;
  transport: TransportTrace;
};
const storage = new AsyncLocalStorage<{ trace: Trace; parent: number | null }>();
const round = (n: number) => Math.round(n * 100) / 100;
const label = (s: string) => s.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 96);
function errorClass(error: unknown): string | null {
  if (!error) return null;
  const e = error as { code?: unknown; name?: unknown };
  return label(typeof e.code === "string" ? e.code : typeof e.name === "string" ? e.name : "dependency_error");
}
function begin(operation: string, attributes: Record<string, Attribute> = {}) {
  const context = storage.getStore();
  if (!context) return null;
  const { trace } = context;
  if (trace.spans.length >= CAUSAL_MAX_SPANS) { trace.dropped++; return null; }
  const span: Span = {
    id: trace.spans.length + 1, parent_id: context.parent, operation: label(operation),
    start_ms: round(performance.now() - trace.started), end_ms: null, duration_ms: null,
    result: "pending", rows: null, payload_bytes: null, parse_ms: null,
    error_class: null, fallback: null,
    attributes: Object.fromEntries(Object.entries(attributes).slice(0, 12).map(([k, v]) => [label(k), typeof v === "string" ? label(v) : v])),
  };
  trace.spans.push(span);
  return { trace, span };
}
function finish(item: NonNullable<ReturnType<typeof begin>>, value?: unknown, error?: unknown) {
  const at = performance.now();
  const { trace, span } = item;
  const result = value as { data?: unknown; error?: unknown } | null;
  span.end_ms = round(at - trace.started);
  span.duration_ms = round(span.end_ms - span.start_ms);
  span.error_class = errorClass(error || result?.error);
  span.result = span.error_class ? "fail" : "success";
  const rows = Array.isArray(value) ? value : result?.data;
  span.rows = Array.isArray(rows) ? rows.length : null;
  trace.overhead_ms += performance.now() - at;
}

export async function traceStep<T>(operation: string, fn: () => T | PromiseLike<T>, attributes: Record<string, Attribute> = {}): Promise<T> {
  const at = performance.now();
  const item = begin(operation, attributes);
  if (!item) return await fn();
  item.trace.overhead_ms += performance.now() - at;
  return storage.run({ trace: item.trace, parent: item.span.id }, async () => {
    try { const value = await fn(); finish(item, value); return value; }
    catch (error) { finish(item, undefined, error); throw error; }
  });
}

export function traceMetric(name: string, value: Attribute) {
  const trace = storage.getStore()?.trace;
  if (trace && Object.keys(trace.metrics).length < 64) trace.metrics[label(name)] = typeof value === "string" ? label(value) : value;
}
export function traceFallback(reason: string) {
  const ctx = storage.getStore();
  const span = ctx?.trace.spans.find(s => s.id === ctx.parent);
  if (span) span.fallback = label(reason);
}

// Observe the existing fetch and the SDK's existing text/json consumption; never
// clone/re-read a response or retain its content. SQL/JSON.parse time is unknown.
export const causalFetch: typeof fetch = async (input, init) => {
  if (!storage.getStore()) return fetch(input, init);
  const item = begin("http.dependency");
  if (!item) return fetch(input, init);
  const started = performance.now();
  try {
    const response = await observeTransport(item.trace.transport, item.span.id, item.span.parent_id, input, init, () => fetch(input, init));
    item.span.attributes.headers_ms = round(performance.now() - started);
    item.span.attributes.http_status = response.status;
    finish(item);
    item.span.result = response.ok ? "success" : "fail";
    item.span.error_class = response.ok ? null : `http_${response.status}`;
    try {
    const originalText = response.text.bind(response);
    response.text = async () => {
      const at = performance.now();
      try {
        const body = await originalText();
        transportBodyConsumed(item.trace.transport, item.span.id);
        item.span.attributes.body_read_ms = round(performance.now() - at);
        const measured = performance.now();
        item.span.payload_bytes = Buffer.byteLength(body, "utf8");
        item.trace.overhead_ms += performance.now() - measured;
        finish(item);
        item.span.result = response.ok ? "success" : "fail";
        item.span.error_class = response.ok ? null : `http_${response.status}`;
        return body;
      } catch (error) { finish(item, undefined, error); throw error; }
    };
    const originalJson = response.json.bind(response);
    response.json = async () => {
      const at = performance.now();
      try {
        const value = await originalJson();
        transportBodyConsumed(item.trace.transport, item.span.id);
        item.span.attributes.body_read_and_parse_ms = round(performance.now() - at);
        finish(item, value);
        item.span.result = response.ok ? "success" : "fail";
        item.span.error_class = response.ok ? null : `http_${response.status}`;
        return value;
      } catch (error) { finish(item, undefined, error); throw error; }
    };
    } catch { item.span.attributes.body_instrumentation = "unavailable"; }
    return response;
  } catch (error) { finish(item, undefined, error); throw error; }
};

function emit(trace: Trace, status: number | null) {
  const now = performance.now();
  const shared = trace.spans.find(s => s.operation === "shared");
  const runtime = trace.spans.find(s => s.operation === "runtime.requested");
  const a = shared?.end_ms, b = runtime?.end_ms;
  const initialCritical = a == null || b == null ? "UNPROVED" : Math.abs(a - b) <= 100 ? "BOTH_NEAR_EQUAL" : a > b ? "SHARED" : "RUNTIME";
  const tail = trace.spans.filter(s => ["runtime.missing", "runtime.package_fallback"].includes(s.operation));
  const critical = tail.length ? "RUNTIME" : initialCritical;
  const common = {
    event: "profiles_live_causal_v2", request_id: trace.request_id, correlation_id: trace.correlation_id,
    started_at: trace.started_at, instance_id: instanceId, process_request_sequence: trace.sequence,
    cold_start: "UNPROVED", region: process.env.VERCEL_REGION || null,
  };
  // Small numbered chunks avoid platform per-line truncation. Identity is on every event.
  const chunks: Span[][] = [[]];
  let size = 0;
  for (const span of trace.spans) {
    const bytes = Buffer.byteLength(JSON.stringify(span));
    if (size + bytes > 5500) { chunks.push([]); size = 0; }
    chunks[chunks.length - 1].push(span); size += bytes;
  }
  const summary = {
    ...common, kind: "summary", chunk_count: chunks.length, span_count: trace.spans.length,
    dropped_spans: trace.dropped, complete: trace.dropped === 0 && trace.spans.every(s => s.end_ms !== null),
    backend_ms: round(now - trace.started), duration_boundary: "before_causal_log_emission", response_status: status, critical_path: critical,
    initial_parallel_critical_path: initialCritical, post_join_runtime_ms: round(tail.reduce((sum, span) => sum + (span.duration_ms || 0), 0)),
    client_abort_observed: trace.abort_ms !== null, client_abort_ms: trace.abort_ms,
    server_continued_after_abort_ms: trace.abort_ms === null ? null : round(now - trace.started - trace.abort_ms),
    metrics: trace.metrics, bookkeeping_partial_ms: round(trace.overhead_ms),
    serialization_bookkeeping_partial_ms: round(performance.now() - now),
  };
  let lines = [JSON.stringify(summary), ...chunks.map((spans, i) => JSON.stringify({ ...common, kind: "spans", chunk: i, chunk_count: chunks.length, spans }))];
  let bytes = lines.reduce((n, s) => n + Buffer.byteLength(s), 0);
  const hour = Math.floor(Date.now() / 3600000);
  if (hour !== emissionHour) { emissionHour = hour; emissionBytes = 0; budgetReported = false; }
  if (bytes > CAUSAL_MAX_LOG_BYTES) {
    lines = [JSON.stringify({ ...summary, chunk_count: 0, complete: false, dropped_spans: trace.spans.length + trace.dropped, drop_reason: "request_byte_cap" })];
    bytes = Buffer.byteLength(lines[0]);
  }
  const transportLines = transportEvents(trace.transport, common).map(e => JSON.stringify(e));
  const transportBytes = transportLines.reduce((n, s) => n + Buffer.byteLength(s), 0);
  if (emissionBytes + bytes + transportBytes > HOURLY_PROCESS_BYTES) {
    if (!budgetReported) {
      budgetReported = true;
      console.info("PROFILES_LIVE_CAUSAL_V2", JSON.stringify({ ...common, kind: "budget_exhausted", complete: false, drop_reason: "hourly_process_cap", resume_after: new Date((hour + 1) * 3600000).toISOString() }));
    }
    return;
  }
  emissionBytes += bytes + transportBytes;
  for (const line of lines) console.info("PROFILES_LIVE_CAUSAL_V2", line);
  for (const line of transportLines) console.info("PROFILES_LIVE_TRANSPORT_V3", line);
}

export async function withProfilesLiveTrace<T extends Response>(
  request: Request, requestId: string, correlationId: string, fn: () => Promise<T>,
): Promise<T> {
  if (Date.now() > Date.parse(CAUSAL_EXPIRES_AT) || process.env.PROFILES_LIVE_CAUSAL_DISABLED === "1") return fn();
  const started = performance.now();
  const trace: Trace = {
    request_id: label(requestId), correlation_id: label(correlationId || requestId),
    started_at: new Date().toISOString(), started, spans: [], metrics: {},
    transport: createTransportTrace(started),
    dropped: 0, abort_ms: null, overhead_ms: 0, sequence: ++requestSequence,
  };
  const onAbort = () => { trace.abort_ms ??= round(performance.now() - trace.started); };
  request.signal.addEventListener("abort", onAbort, { once: true });
  if (request.signal.aborted) onAbort();
  return storage.run({ trace, parent: null }, async () => {
    let status: number | null = null;
    try { const response = await fn(); status = response.status; return response; }
    finally {
      request.signal.removeEventListener("abort", onAbort);
      // Diagnostics must never change response/error semantics, including sink failure.
      try { emit(trace, status); } catch { /* preserve caller behavior */ }
    }
  });
}

registerProfilesLiveObserver({ step: traceStep, metric: traceMetric, fallback: traceFallback, fetch: causalFetch });
