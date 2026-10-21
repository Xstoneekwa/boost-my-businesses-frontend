import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";
import { isIP } from "node:net";
import type { Socket } from "node:net";

// Passive diagnostics only: no dispatcher replacement, socket tuning or reads.
export const TRANSPORT_EXPIRES_AT = "2026-09-11T20:00:00.000Z";
export const TRANSPORT_MAX_CALLS = 96;
export const TRANSPORT_MAX_ATTEMPTS = 4;
export const TRANSPORT_MAX_BYTES = 64 * 1024;
type Fields = Record<string, number | string | boolean | null>;
type Connection = {
  id: number; sends: number; born: number | null; ready: number | null;
  lookup: number | null; tcpStart: number | null; tcpEnd: number | null; secure: number | null;
  attempts: number; failed: number; timeout: number; setupStart: number | null;
};
type Attempt = Fields & { id: number; created: number; send: number | null; headers: number | null; ended: number | null };
type Call = {
  span: number; parent: number | null; origin: string; endpoint: string; method: string;
  created: number; finished: number | null; body_consumed: number | null; sdk_retry: number | null;
  attempts: Attempt[]; attempt_count: number; dropped: number; response: Fields;
};
export type TransportTrace = { started: number; calls: Call[]; dropped: number; overhead_ms: number };
type Context = { trace: TransportTrace; call: Call };
type RequestState = { context: Context | null; attempt: Attempt | null; origin: string; preheader: boolean; active: boolean };
type ConnectionStart = { at: number; origin: string; ambiguous: boolean };
type DiagnosticEvent = {
  request: { origin: string }; socket: Socket & { encrypted?: boolean };
  connectParams: { protocol: string; host: string }; connector: () => void;
  response: { statusCode: number }; error: unknown;
};
const context = new AsyncLocalStorage<Context>();
const requests = new WeakMap<object, RequestState>();
const sockets = new WeakMap<object, Connection>();
const starts = new WeakMap<object, ConnectionStart[]>();
const active = { SUPABASE: 0, BACKEND: 0 };
const preheaders = { SUPABASE: 0, BACKEND: 0 };
let socketSequence = 0;
let subscribed = false;
const now = () => performance.now();
const round = (v: number) => Math.round(v * 100) / 100;
const enabled = () => Date.now() <= Date.parse(TRANSPORT_EXPIRES_AT) && process.env.PROFILES_LIVE_CAUSAL_DISABLED !== "1";
function originClass(origin: unknown): "SUPABASE" | "BACKEND" | null {
  if (typeof origin !== "string") return null;
  try {
    const u = new URL(origin);
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && u.origin === new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin) return "SUPABASE";
    if (["www.boostmybusinesses.com", "boostmybusinesses.com", process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).includes(u.hostname)) return "BACKEND";
  } catch { /* unclassified inputs are not logged */ }
  return null;
}
function endpoint(origin: string, path: unknown): string {
  if (typeof path !== "string") return "UNAVAILABLE";
  const pathname = path.split("?")[0];
  if (origin === "SUPABASE") {
    const tables = new Set(["account_package_summary", "account_run_requests", "account_session_resume_plans", "account_session_transitions",
      "ig_account_settings", "ig_action_logs", "ig_interacted_users", "ig_interaction_events", "ig_runs", "account_assignments", "account_credentials",
      "account_dashboard_actions", "account_incidents", "client_instagram_accounts", "ig_account_dm_settings", "ig_account_unfollow_settings",
      "ig_accounts", "ig_targets", "phone_app_instances", "phone_devices", "ig_account_social_profile_snapshots"]);
    const resource = pathname.slice("/rest/v1/".length);
    if (pathname === "/rest/v1/rpc/read_last_complete_growth_snapshots_v1") return "POSTGREST_RPC:read_last_complete_growth_snapshots_v1";
    if (pathname.startsWith("/rest/v1/rpc/")) return "POSTGREST_RPC_OTHER";
    if (pathname.startsWith("/rest/v1/")) return tables.has(resource) ? "POSTGREST_TABLE:" + resource : "POSTGREST_TABLE_OTHER";
    if (pathname === "/functions/v1/admin-dashboard") return "SUPABASE_EDGE_ADMIN_DASHBOARD";
    return "SUPABASE_OTHER";
  }
  return pathname === "/api/instagram-dashboard/manage-overview" ? "BACKEND_MANAGE_OVERVIEW" : "BACKEND_HTTP";
}
function connection(socket: object): Connection {
  let c = sockets.get(socket);
  if (!c) {
    c = { id: ++socketSequence, sends: 0, born: null, ready: null, lookup: null, tcpStart: null, tcpEnd: null,
      secure: null, attempts: 0, failed: 0, timeout: 0, setupStart: null };
    sockets.set(socket, c);
  }
  return c;
}
function safe(fn: () => void) {
  try { fn(); } catch { /* Diagnostic failure must not escape into Undici. */ }
}
function subscribe(name: string, fn: (event: DiagnosticEvent) => void) {
  channel(name).subscribe((event) => {
    if (!enabled()) return;
    const at = now();
    safe(() => fn(event as DiagnosticEvent));
    const trace = context.getStore()?.trace;
    if (trace) trace.overhead_ms += now() - at;
  });
}
function endRequest(state: RequestState, headersOnly = false) {
  const key = state.origin as keyof typeof active;
  if (state.preheader) { preheaders[key] = Math.max(0, preheaders[key] - 1); state.preheader = false; }
  if (!headersOnly && state.active) { active[key] = Math.max(0, active[key] - 1); state.active = false; }
}
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && /^(UND_ERR_|E[A-Z]|ERR_)[A-Z0-9_]{1,64}$/.test(code) ? code : "TRANSPORT_ERROR";
}
function retryCount(headers: HeadersInit | undefined): number | null {
  let value: unknown;
  if (headers instanceof Headers) value = headers.get("x-retry-count");
  else if (Array.isArray(headers)) value = headers.find(h => h[0].toLowerCase() === "x-retry-count")?.[1];
  else if (headers) value = (headers as Record<string,string>)["x-retry-count"] ?? (headers as Record<string,string>)["X-Retry-Count"];
  return value == null ? 0 : /^\d$/.test(String(value)) ? Number(value) : null;
}
export function safeTransportHeaders(get: (key: string) => string | null): Fields {
  const result: Fields = {};
  for (const key of ["sb-request-id", "x-request-id"]) {
    const value = get(key);
    if (value && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) result[key] = value;
  }
  const ray = get("cf-ray");
  if (ray && /^[a-f0-9]{16,32}-[A-Z0-9]{3}$/.test(ray)) result["cf-ray"] = ray;
  const vercel = get("x-vercel-id");
  if (vercel && /^[a-z]{3}\d?::(?:[a-z]{3}\d?::)?[a-z0-9]{4,12}-\d{10,16}-[a-z0-9]{6,24}$/.test(vercel)) result["x-vercel-id"] = vercel;
  for (const key of ["x-kong-upstream-latency", "x-kong-proxy-latency", "x-envoy-upstream-service-time"]) {
    const value = get(key);
    if (value && /^\d{1,6}(?:\.\d{1,3})?$/.test(value)) result[key] = Number(value);
  }
  // Only numeric durations of a fixed allowlist. Never retain desc or raw headers.
  const timing = get("server-timing");
  if (timing && timing.length <= 2048) {
    for (const part of timing.split(",").slice(0, 16)) {
      const match = part.match(/^\s*(cfL4|cfEdge|cfOrigin|db|postgres|postgrest|kong|proxy|upstream|total)\s*;\s*dur=(\d{1,6}(?:\.\d{1,3})?)(?:;|$)/);
      if (match) result["server_timing." + match[1]] = Number(match[2]);
    }
  }
  return result;
}
function install() {
  if (subscribed) return;
  subscribed = true;
  subscribe("net.client.socket", ({ socket }: { socket: Socket }) => {
    // No socket data/error listener; never changes flowing mode or error handling.
    if (!context.getStore() || !socket || typeof socket.once !== "function") return;
    const c = connection(socket); c.born = now();
    socket.once("lookup", () => safe(() => { c.lookup = now(); }));
    socket.on("connectionAttempt", () => safe(() => { c.tcpStart ??= now(); c.attempts = Math.min(c.attempts + 1, 999); }));
    socket.on("connectionAttemptFailed", () => safe(() => { c.failed = Math.min(c.failed + 1, 999); }));
    socket.on("connectionAttemptTimeout", () => safe(() => { c.timeout = Math.min(c.timeout + 1, 999); }));
    socket.once("connect", () => safe(() => { c.tcpEnd = now(); }));
    socket.once("secureConnect", () => safe(() => { c.secure = now(); }));
  });
  subscribe("undici:client:beforeConnect", ({ connectParams, connector }) => {
    const origin = originClass(connectParams?.protocol + "//" + connectParams?.host);
    if (!origin || typeof connector !== "function") return;
    const pending = starts.get(connector) || [];
    const at = now();
    const recent = pending.filter(p => at - p.at < 300_000);
    if (recent.length) recent.forEach(p => { p.ambiguous = true; });
    if (recent.length < 32) recent.push({ at, origin, ambiguous: recent.length > 0 });
    starts.set(connector, recent);
  });
  subscribe("undici:client:connected", ({ socket, connectParams, connector }) => {
    const origin = originClass(connectParams?.protocol + "//" + connectParams?.host);
    if (!origin || !socket) return;
    const c = connection(socket); c.ready = now();
    const pending = typeof connector === "function" ? starts.get(connector) : undefined;
    // beforeConnect is not request-bound. Only a single unambiguous connector
    // attempt may bind a start to the connected socket; never match by FIFO.
    if (pending?.length === 1 && !pending[0].ambiguous && pending[0].origin === origin) c.setupStart = pending[0].at;
    if (pending?.length) pending.pop();
  });
  subscribe("undici:client:connectError", ({ connector }) => {
    const pending = typeof connector === "function" ? starts.get(connector) : undefined;
    if (pending?.length) { pending.forEach(p => { p.ambiguous = true; }); pending.pop(); }
    // No request identity in this event: do not fabricate per-request retries.
  });
  subscribe("undici:request:create", ({ request }) => {
    if (!request || typeof request !== "object") return;
    const origin = originClass(String(request.origin));
    if (!origin) return;
    const ctx = context.getStore() || null;
    let attempt: Attempt | null = null;
    if (ctx) {
      ctx.call.attempt_count++;
      if (ctx.call.attempts.length < TRANSPORT_MAX_ATTEMPTS) {
        attempt = { id: ctx.call.attempt_count, created: round(now()-ctx.trace.started), send: null, headers: null, ended: null,
          active_at_create: active[origin], preheaders_at_create: preheaders[origin] };
        ctx.call.attempts.push(attempt);
      } else ctx.call.dropped++;
    }
    active[origin]++; preheaders[origin]++;
    requests.set(request, { context: ctx, attempt, origin, active: true, preheader: true });
  });
  subscribe("undici:client:sendHeaders", ({ request, socket }) => {
    const state = requests.get(request);
    if (!state || !socket) return;
    const c = connection(socket);
    const priorSends = c.sends++;
    const a = state.attempt, ctx = state.context;
    if (!a || !ctx) return;
    const at = now();
    Object.assign(a, {
      send: round(at-ctx.trace.started), socket: c.id,
      reuse: priorSends > 0 ? "REUSED_CONNECTION" : c.ready !== null ? "NEW_CONNECTION" : "UNKNOWN",
      socket_sends_before: priorSends,
      connection_age_ms: c.ready === null ? null : round(at-c.ready),
      connection_ready: c.ready === null ? null : round(c.ready-ctx.trace.started),
      connection_start: c.setupStart === null ? null : round(c.setupStart-ctx.trace.started),
      setup_ms: c.setupStart === null || c.ready === null ? null : round(c.ready-c.setupStart),
      dns_end: c.lookup === null ? null : round(c.lookup-ctx.trace.started),
      tcp_start: c.tcpStart === null ? null : round(c.tcpStart-ctx.trace.started),
      tcp_end: c.tcpEnd === null ? null : round(c.tcpEnd-ctx.trace.started),
      secure: c.secure === null ? null : round(c.secure-ctx.trace.started),
      tcp_attempts: c.attempts, tcp_failed: c.failed, tcp_timeouts: c.timeout,
      active_at_send: active[state.origin as keyof typeof active],
      preheaders_at_send: preheaders[state.origin as keyof typeof preheaders],
      remote_ip: typeof socket.remoteAddress === "string" && isIP(socket.remoteAddress) ? socket.remoteAddress : null,
      remote_port: typeof socket.remotePort === "number" ? socket.remotePort : null,
      encrypted: typeof socket.encrypted === "boolean" ? socket.encrypted : false,
    });
  });
  subscribe("undici:request:bodySent", ({ request }) => {
    const s = requests.get(request);
    if (s?.attempt && s.context) s.attempt.body_sent = round(now()-s.context.trace.started);
  });
  subscribe("undici:request:headers", ({ request, response }) => {
    const s = requests.get(request);
    if (!s) return;
    endRequest(s, true);
    if (s.attempt && s.context) {
      s.attempt.headers = round(now()-s.context.trace.started);
      s.attempt.status = typeof response?.statusCode === "number" ? response.statusCode : null;
    }
  });
  subscribe("undici:request:trailers", ({ request }) => {
    const s = requests.get(request);
    if (!s) return;
    endRequest(s);
    if (s.attempt && s.context) s.attempt.ended = round(now()-s.context.trace.started);
    requests.delete(request);
  });
  subscribe("undici:request:error", ({ request, error }) => {
    const s = requests.get(request);
    if (!s) return;
    endRequest(s);
    if (s.attempt && s.context) {
      s.attempt.ended = round(now()-s.context.trace.started); s.attempt.error = errorCode(error);
    }
    requests.delete(request);
  });
}
export function createTransportTrace(started: number): TransportTrace {
  return { started, calls: [], dropped: 0, overhead_ms: 0 };
}
export async function observeTransport(
  trace: TransportTrace, span: number, parent: number | null,
  input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1], fn: () => ReturnType<typeof fetch>,
): Promise<Response> {
  let call: Call | null = null;
  const at = now();
  safe(() => {
    if (!enabled()) return;
    install();
    const url = typeof input === "string" ? new URL(input) : input instanceof URL ? input : new URL(input.url);
    const origin = originClass(url.origin);
    if (!origin) return;
    if (trace.calls.length >= TRANSPORT_MAX_CALLS) { trace.dropped++; return; }
    const method = init?.method || (input instanceof Request ? input.method : "GET");
    call = { span, parent, origin, endpoint: endpoint(origin, url.pathname), method: /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/i.test(method) ? method.toUpperCase() : "OTHER",
      created: round(now()-trace.started), finished: null, body_consumed: null, sdk_retry: retryCount(init?.headers),
      attempts: [], attempt_count: 0, dropped: 0, response: {} };
    trace.calls.push(call);
  });
  trace.overhead_ms += now()-at;
  if (!call) return fn();
  const observed: Call = call;
  return context.run({ trace, call: observed }, async () => {
    try {
      const response = await fn();
      const at = now();
      safe(() => {
        observed.finished = round(at-trace.started);
        observed.response = { status: response.status, ...safeTransportHeaders(key => response.headers.get(key)) };
      });
      trace.overhead_ms += now()-at;
      return response;
    } catch (error) {
      safe(() => { observed.finished = round(now()-trace.started); observed.response.error = errorCode((error as {cause?:unknown})?.cause || error); });
      throw error;
    }
  });
}
export function transportBodyConsumed(trace: TransportTrace, span: number) {
  safe(() => {
    const call = trace.calls.find(c => c.span === span);
    if (call) call.body_consumed = round(now()-trace.started);
  });
}
export function transportEvents(trace: TransportTrace, common: Record<string, unknown>) {
  const chunks: Call[][] = [[]]; let size = 0;
  for (const call of trace.calls) {
    const bytes = Buffer.byteLength(JSON.stringify(call));
    if (size + bytes > 5200) { chunks.push([]); size = 0; }
    chunks[chunks.length-1].push(call); size += bytes;
  }
  const dropped = trace.dropped + trace.calls.reduce((n,c) => n+c.dropped,0);
  const summary = { ...common, event: "profiles_live_transport_v3", kind: "summary", chunk_count: chunks.length,
    call_count: trace.calls.length, dropped, complete: dropped === 0 && trace.calls.every(c => c.finished !== null && c.attempt_count > 0 && c.attempts.every(a => a.ended !== null)),
    observer: "passive_diagnostics_channel", node: process.versions?.node || "UNAVAILABLE", undici: process.versions?.undici || "UNAVAILABLE",
    deployment_id: /^dpl_[A-Za-z0-9]+$/.test(process.env.VERCEL_DEPLOYMENT_ID || "") ? process.env.VERCEL_DEPLOYMENT_ID : "UNAVAILABLE",
    unavailable: ["dns_start", "dns_ms", "socket_assigned_at", "tls_start", "tls_ms", "first_byte_at", "ttfb_ms", "sql_execution_ms", "pool_limit", "pool_wait_ms"],
    timing_basis: "relative_ms_to_causal_request_start; send=before_socket_write; headers=parsed_headers; null=UNAVAILABLE",
    concurrency_basis: "observed_allowlisted_origin_requests_in_this_module_process; not_pool_occupancy",
    overhead_partial_ms: round(trace.overhead_ms) };
  const events: Record<string, unknown>[] = [summary, ...chunks.map((calls,i) => ({...common,event:"profiles_live_transport_v3",kind:"calls",chunk:i,chunk_count:chunks.length,calls}))];
  if (events.reduce((n,e) => n+Buffer.byteLength(JSON.stringify(e)),0) > TRANSPORT_MAX_BYTES) return [{...summary,complete:false,chunk_count:0,dropped:trace.calls.length,drop_reason:"transport_byte_cap"}];
  return events;
}
