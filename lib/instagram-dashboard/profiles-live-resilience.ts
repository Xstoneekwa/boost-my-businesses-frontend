import { AsyncLocalStorage } from "node:async_hooks";

export const PROFILES_LIVE_CONTRACT = "freshness-v1";
export const PROFILES_LIVE_GLOBAL_READ_MS = 4_000;
export const PROFILES_LIVE_TARGET_RESPONSE_MS = 4_500;

export type ProfilesLiveProjectionState = "COMPLETE" | "PARTIAL" | "STALE_SAFE" | "UNAVAILABLE";
export type ProfilesLiveDataState = "FRESH" | "LAST_CONFIRMED" | "PARTIAL" | "UNKNOWN";
export type ProfilesLiveReason =
  | "READ_DEADLINE" | "PROVIDER_HTTP_ERROR" | "INVALID_PAYLOAD" | "INCOMPLETE_READ"
  | "DEPENDENCY_UNKNOWN" | "STALE_EXPIRED" | "NO_PRIOR_VALUE";
export type ProfilesLiveReadState =
  | "SUCCESS" | "DEADLINE" | "HTTP_ERROR" | "INVALID_PAYLOAD" | "INCOMPLETE" | "ABORTED" | "DEPENDENCY_UNKNOWN";

export type ProfilesLiveFamily =
  | "identity" | "membership" | "lifecycle" | "assignment" | "device" | "package"
  | "readiness" | "growth_ready" | "blockers" | "runtime" | "counters" | "revision"
  | "growth" | "incidents" | "current_run" | "scheduler" | "security";

export type ProfilesLiveFamilyFreshness = {
  data_state: ProfilesLiveDataState;
  observed_at: string | null;
  age_ms: number | null;
  source: string;
  revision: string | null;
  reason: ProfilesLiveReason | null;
  fence: ProfilesLiveFence;
};

export type ProfilesLiveFence = {
  account_id: string;
  access_scope: string;
  tenant_or_scope_id: string;
  family: ProfilesLiveFamily;
  assignment_id: string | null;
  device_id: string | null;
  app_instance_id: string | null;
  run_id: string | null;
  business_day: string | null;
  revision: string | null;
};

export type ProfilesLiveReadEnvelope<T> =
  | { state: "SUCCESS"; value: T; observedAt: string }
  | { state: Exclude<ProfilesLiveReadState, "SUCCESS">; reason: ProfilesLiveReason };

export type ProfilesLiveHelperObservation = {
  helper: string;
  started_at: string;
  finished_at: string;
  elapsed_ms: number;
  budget_ms: number;
  result_class: ProfilesLiveReadState;
  reason: ProfilesLiveReason | null;
};

export const PROFILES_LIVE_FIELD_FAMILIES: readonly ProfilesLiveFamily[] = Object.freeze([
  "identity", "membership", "lifecycle", "assignment", "device", "package",
  "readiness", "growth_ready", "blockers", "runtime", "counters", "revision",
  "growth", "incidents", "current_run", "scheduler", "security",
]);

type ResilienceContext = {
  startedAt: number;
  deadlineAt: number;
  controller: AbortController;
  cleanups: Set<() => void>;
};

const storage = new AsyncLocalStorage<ResilienceContext>();
const signalStorage = new AsyncLocalStorage<AbortSignal>();

export class ProfilesLiveDeadlineError extends Error {
  constructor() {
    super("Profiles Live global read deadline reached");
    this.name = "ProfilesLiveDeadlineError";
  }
}

export function isProfilesLiveDeadlineError(error: unknown) {
  return error instanceof ProfilesLiveDeadlineError;
}

export const PROFILES_LIVE_POLICY = Object.freeze({
  schema: "profiles_live_freshness_policy_v1",
  policy_id: "profiles_live_freshness_policy_v1_locked",
  fresh_for_ms: 20_000,
  max_stale_age_ms: Object.freeze({ identity: 300_000, device: 60_000, package: 300_000, growth: 300_000, transition: 60_000 }),
  no_stale_reuse: Object.freeze(["membership", "lifecycle", "assignment", "readiness", "growth_ready", "blockers", "runtime", "counters", "revision", "incidents", "current_run", "scheduler", "security"]),
});

export function wantsProfilesLiveFreshness(request: Request) {
  return request.headers.get("x-profiles-live-contract")?.trim().toLowerCase() === PROFILES_LIVE_CONTRACT;
}

export function profilesLiveResilienceActive() {
  return Boolean(storage.getStore());
}

export async function withProfilesLiveResilience<T>(request: Request, work: () => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const startedAt = performance.now();
  const context: ResilienceContext = { startedAt, deadlineAt: startedAt + PROFILES_LIVE_GLOBAL_READ_MS, controller, cleanups: new Set() };
  const abortFromClient = () => controller.abort("client_abort");
  if (request.signal.aborted) abortFromClient();
  else request.signal.addEventListener("abort", abortFromClient, { once: true });
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  try {
    const pending = storage.run(context, work);
    // Observe the losing branch as well: a provider that ignores AbortSignal
    // must never extend the response path or create an unhandled rejection.
    pending.catch(() => undefined);
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        controller.abort("global_deadline");
        reject(new ProfilesLiveDeadlineError());
      }, PROFILES_LIVE_GLOBAL_READ_MS);
    });
    return await Promise.race([pending, deadline]);
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    request.signal.removeEventListener("abort", abortFromClient);
    for (const cleanup of context.cleanups) cleanup();
    context.cleanups.clear();
  }
}

function failureState(error: unknown): { state: Exclude<ProfilesLiveReadState, "SUCCESS">; reason: ProfilesLiveReason } {
  const status = Number((error as { status?: unknown })?.status);
  const name = String((error as { name?: unknown })?.name ?? "");
  const message = String((error as { message?: unknown })?.message ?? "");
  if (name === "AbortError" || /abort/i.test(name)) return { state: "ABORTED", reason: "READ_DEADLINE" };
  if (Number.isFinite(status) && status >= 400) return { state: "HTTP_ERROR", reason: "PROVIDER_HTTP_ERROR" };
  if (/invalid|malformed|json/i.test(message)) return { state: "INVALID_PAYLOAD", reason: "INVALID_PAYLOAD" };
  return { state: "DEPENDENCY_UNKNOWN", reason: "DEPENDENCY_UNKNOWN" };
}

export async function settleProfilesLiveRead<T>(budgetMs: number, work: (signal: AbortSignal) => Promise<T>): Promise<ProfilesLiveReadEnvelope<T>> {
  const context = storage.getStore();
  if (!context) {
    try { return { state: "SUCCESS", value: await work(new AbortController().signal), observedAt: new Date().toISOString() }; }
    catch (error) { return failureState(error); }
  }
  const remaining = Math.max(0, context.deadlineAt - performance.now());
  if (!remaining || context.controller.signal.aborted) return { state: "DEADLINE", reason: "READ_DEADLINE" };
  const controller = new AbortController();
  const abort = () => controller.abort(context.controller.signal.reason);
  context.controller.signal.addEventListener("abort", abort, { once: true });
  const timeoutMs = Math.max(1, Math.min(budgetMs, remaining));
  let timeout: ReturnType<typeof setTimeout> | null = setTimeout(() => controller.abort("family_deadline"), timeoutMs);
  const cleanup = () => {
    if (timeout) clearTimeout(timeout);
    timeout = null;
    context.controller.signal.removeEventListener("abort", abort);
    context.cleanups.delete(cleanup);
  };
  context.cleanups.add(cleanup);
  try {
    const pending = Promise.resolve().then(() => signalStorage.run(controller.signal, () => work(controller.signal)));
    const aborted = new Promise<symbol>((resolve) => {
      const marker = Symbol("profiles_live_deadline");
      const onAbort = () => resolve(marker);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      context.cleanups.add(() => controller.signal.removeEventListener("abort", onAbort));
    });
    const value = await Promise.race([pending, aborted]);
    if (controller.signal.aborted) return { state: "DEADLINE", reason: "READ_DEADLINE" };
    return { state: "SUCCESS", value: value as T, observedAt: new Date().toISOString() };
  } catch (error) {
    if (controller.signal.aborted) return { state: "DEADLINE", reason: "READ_DEADLINE" };
    return failureState(error);
  } finally { cleanup(); }
}

export async function observeProfilesLiveRead<T>(helper: string, budgetMs: number, work: (signal: AbortSignal) => Promise<T>) {
  const startedAt = performance.now();
  const started_at = new Date().toISOString();
  const envelope = await settleProfilesLiveRead(budgetMs, work);
  const observation: ProfilesLiveHelperObservation = {
    helper,
    started_at,
    finished_at: new Date().toISOString(),
    elapsed_ms: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
    budget_ms: budgetMs,
    result_class: envelope.state,
    reason: envelope.state === "SUCCESS" ? null : envelope.reason,
  };
  return { envelope, observation };
}

export function profilesLiveFieldFamilySummary(
  projectionState: ProfilesLiveProjectionState,
  profiles: Record<string, Partial<Record<ProfilesLiveFamily, ProfilesLiveFamilyFreshness>>>,
  membershipState: ProfilesLiveDataState,
) {
  if (projectionState === "UNAVAILABLE") {
    return { known_field_families: [] as ProfilesLiveFamily[], unknown_field_families: [...PROFILES_LIVE_FIELD_FAMILIES] };
  }
  const known: ProfilesLiveFamily[] = [];
  const unknown: ProfilesLiveFamily[] = [];
  if (membershipState === "UNKNOWN") unknown.push("membership");
  else known.push("membership");
  const familyRows = Object.values(profiles);
  for (const family of PROFILES_LIVE_FIELD_FAMILIES) {
    if (family === "membership") continue;
    const states = familyRows.map(row => row[family]?.data_state).filter(Boolean);
    if (states.some(state => state === "UNKNOWN")) unknown.push(family);
    else if (states.length > 0) known.push(family);
  }
  return { known_field_families: known, unknown_field_families: unknown };
}

type QueryControls = {
  retry(enabled: boolean): QueryControls;
  abortSignal(signal: AbortSignal): QueryControls;
};

export function constrainProfilesLiveQuery<T>(query: T): T {
  const signal = signalStorage.getStore();
  if (!signal) return query;
  if (signal.aborted) throw new DOMException("Profiles Live read deadline reached", "AbortError");
  const controlled = query as unknown as QueryControls;
  return controlled.retry(false).abortSignal(signal) as unknown as T;
}

export function freshFamily(observedAt: string, source: string, revision: string | null, fence: ProfilesLiveFence): ProfilesLiveFamilyFreshness {
  return { data_state: "FRESH", observed_at: observedAt, age_ms: 0, source, revision, reason: null, fence: { ...fence, revision } };
}

export function unknownFamily(source: string, reason: ProfilesLiveReason, fence: ProfilesLiveFence): ProfilesLiveFamilyFreshness {
  return { data_state: "UNKNOWN", observed_at: null, age_ms: null, source, revision: null, reason, fence: { ...fence, revision: null } };
}

type FreshnessProfile = Record<string, unknown>;
function stringField(profile: FreshnessProfile, ...keys: string[]) {
  for (const key of keys) if (typeof profile[key] === "string" && String(profile[key]).trim()) return String(profile[key]).trim();
  return null;
}

function profileFence(profile: FreshnessProfile, accountId: string, family: ProfilesLiveFamily): ProfilesLiveFence {
  return {
    account_id: accountId,
    access_scope: "instagram_dashboard_admin",
    tenant_or_scope_id: "instagram_dashboard_admin",
    family,
    assignment_id: stringField(profile, "assignmentId", "assignment_id"),
    device_id: stringField(profile, "deviceId", "device_id"),
    app_instance_id: stringField(profile, "appInstanceId", "app_instance_id"),
    run_id: stringField(profile, "activeRunId", "active_run_id", "runId", "run_id"),
    business_day: stringField(profile, "businessDate", "business_date")
      ?? (profile.counterProjection && typeof profile.counterProjection === "object"
        ? stringField(profile.counterProjection as FreshnessProfile, "businessDate", "business_date") : null),
    revision: null,
  };
}

export function buildProfilesFreshness(profilesInput: FreshnessProfile[], observedAt: string, runtimeObservedAccountIds: Iterable<string>, runtimeReason: ProfilesLiveReason | null) {
  const profiles: Record<string, Partial<Record<ProfilesLiveFamily, ProfilesLiveFamilyFreshness>>> = {};
  const runtimeObserved = new Set(runtimeObservedAccountIds);
  for (const profile of profilesInput) {
    const accountId = stringField(profile, "accountId", "account_id", "id");
    if (!accountId) continue;
    const family = (name: ProfilesLiveFamily, source: string, runtimeRead = false) => {
      const fence = profileFence(profile, accountId, name);
      return runtimeRead && (!runtimeObserved.has(accountId) || runtimeReason)
        ? unknownFamily(source, runtimeReason ?? "INCOMPLETE_READ", fence)
        : freshFamily(observedAt, source, observedAt, fence);
    };
    profiles[accountId] = {
      identity: family("identity", "profiles_live_shared_core"),
      lifecycle: family("lifecycle", "profiles_live_shared_core"),
      assignment: family("assignment", "profiles_live_shared_core"),
      device: family("device", "profiles_live_shared_core"),
      package: family("package", "profiles_live_shared_core"),
      readiness: family("readiness", "profiles_live_dependencies", true),
      growth_ready: family("growth_ready", "profiles_live_dependencies", true),
      blockers: family("blockers", "profiles_live_runtime", true),
      runtime: family("runtime", "profiles_live_runtime", true),
      counters: family("counters", "profiles_live_runtime", true),
      revision: family("revision", "profiles_live_runtime", true),
      growth: family("growth", "profiles_live_runtime", true),
      incidents: family("incidents", "profiles_live_runtime", true),
      current_run: family("current_run", "profiles_live_runtime", true),
      scheduler: family("scheduler", "profiles_live_runtime", true),
      security: family("security", "profiles_live_runtime", true),
    };
  }
  return profiles;
}
