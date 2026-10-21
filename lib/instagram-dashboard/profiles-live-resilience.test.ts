import assert from "node:assert/strict";
import test from "node:test";
import {
  PROFILES_LIVE_GLOBAL_READ_MS, PROFILES_LIVE_POLICY, buildProfilesFreshness, constrainProfilesLiveQuery,
  observeProfilesLiveRead, profilesLiveFieldFamilySummary, settleProfilesLiveRead, wantsProfilesLiveFreshness, withProfilesLiveResilience,
} from "./profiles-live-resilience.ts";

const request = () => new Request("https://example.test/profiles/live", { headers: { "X-Profiles-Live-Contract": "freshness-v1" } });

test("1 complete fresh response families are fresh", () => assert.equal(buildProfilesFreshness([{ accountId: "a" }], new Date().toISOString(), ["a"], null).a.runtime?.data_state, "FRESH"));
test("2 runtime dependency failure is partial and unknown", () => assert.equal(buildProfilesFreshness([{ accountId: "a" }], new Date().toISOString(), [], "READ_DEADLINE").a.counters?.data_state, "UNKNOWN"));
test("3 freshness negotiation is explicit", () => assert.equal(wantsProfilesLiveFreshness(request()), true));
test("4 old V2 without header remains legacy", () => assert.equal(wantsProfilesLiveFreshness(new Request("https://example.test")), false));
test("5 successful read returns an explicit envelope", async () => assert.equal((await settleProfilesLiveRead(20, async () => 1)).state, "SUCCESS"));
test("6 provider deadline returns DEADLINE without retry", async () => {
  let calls = 0;
  const result = await withProfilesLiveResilience(request(), () => settleProfilesLiveRead(5, async signal => {
    calls += 1; await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); return 1;
  }));
  assert.equal(result.state, "DEADLINE"); assert.equal(calls, 1);
});
test("7 HTTP failure is classified", async () => {
  const error = Object.assign(new Error("rate limited"), { status: 429 });
  const result = await settleProfilesLiveRead(20, async () => { throw error; });
  assert.deepEqual(result, { state: "HTTP_ERROR", reason: "PROVIDER_HTTP_ERROR" });
});
test("8 malformed payload failure is classified", async () => {
  const result = await settleProfilesLiveRead(20, async () => { throw new Error("invalid json payload"); });
  assert.deepEqual(result, { state: "INVALID_PAYLOAD", reason: "INVALID_PAYLOAD" });
});
test("9 Supabase query control disables retry and receives request-local signal", async () => {
  let retry: boolean | null = null; let signal: AbortSignal | null = null;
  const query = { retry(value: boolean) { retry = value; return this; }, abortSignal(value: AbortSignal) { signal = value; return this; } };
  await withProfilesLiveResilience(request(), () => settleProfilesLiveRead(20, async () => constrainProfilesLiveQuery(query)));
  assert.equal(retry, false); assert.ok(signal);
});
test("10 concurrent request abort is isolated", async () => {
  const aborter = new AbortController();
  const first = withProfilesLiveResilience(new Request("https://example.test", { signal: aborter.signal }), () => settleProfilesLiveRead(100, async signal => new Promise(resolve => signal.addEventListener("abort", () => resolve("a"), { once: true }))));
  const second = withProfilesLiveResilience(request(), () => settleProfilesLiveRead(100, async () => "b"));
  aborter.abort();
  assert.equal((await first).state, "DEADLINE");
  const secondResult = await second;
  assert.equal(secondResult.state, "SUCCESS");
  if (secondResult.state === "SUCCESS") assert.equal(secondResult.value, "b");
});
test("11 global read deadline remains 4000ms", () => assert.equal(PROFILES_LIVE_GLOBAL_READ_MS, 4000));
test("12 unread account runtime families remain UNKNOWN", () => {
  const freshness = buildProfilesFreshness([{ accountId: "read" }, { accountId: "unread" }], new Date().toISOString(), ["read"], null);
  assert.equal(freshness.read.runtime?.data_state, "FRESH");
  assert.equal(freshness.unread.runtime?.data_state, "UNKNOWN");
});
test("13 global deadline stops awaiting a provider that ignores abort", async () => {
  const started = performance.now();
  await assert.rejects(
    withProfilesLiveResilience(request(), () => new Promise(resolve => setTimeout(resolve, 4_600))),
    { name: "ProfilesLiveDeadlineError" },
  );
  assert.ok(performance.now() - started < 4_350);
});
test("14 success, error and deadline execute one provider attempt each", async () => {
  for (const outcome of ["success", "error", "deadline"] as const) {
    let calls = 0;
    const result = await withProfilesLiveResilience(request(), () => settleProfilesLiveRead(5, async signal => {
      calls += 1;
      if (outcome === "error") throw Object.assign(new Error("provider"), { status: 520 });
      if (outcome === "deadline") await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      return "ok";
    }));
    assert.equal(calls, 1, outcome);
    assert.equal(result.state, outcome === "success" ? "SUCCESS" : outcome === "error" ? "HTTP_ERROR" : "DEADLINE");
  }
});
test("15 canonical policy and fence identity are explicit and revision-bound", () => {
  assert.equal(PROFILES_LIVE_POLICY.policy_id, "profiles_live_freshness_policy_v1_locked");
  const freshness = buildProfilesFreshness([{ accountId: "a", assignmentId: "assignment-a", deviceId: "device-a", appInstanceId: "app-a" }], "2026-09-10T00:00:00.000Z", ["a"], null);
  assert.deepEqual(freshness.a.device?.fence, {
    account_id: "a", access_scope: "instagram_dashboard_admin", tenant_or_scope_id: "instagram_dashboard_admin", family: "device",
    assignment_id: "assignment-a", device_id: "device-a", app_instance_id: "app-a", run_id: null, business_day: null,
    revision: "2026-09-10T00:00:00.000Z",
  });
});

test("16 profile data cannot redefine the canonical tenant or access scope fence", () => {
  const now = new Date().toISOString();
  const profile = { accountId: "tenant-fenced" } as Record<string, unknown>;
  profile.tenantId = "payload-controlled-tenant";
  profile.tenant_or_scope_id = "payload-controlled-scope";
  const projection = buildProfilesFreshness([profile], now, ["tenant-fenced"], null);
  const fences = Object.values(projection["tenant-fenced"]);
  assert.ok(fences.every(family => family.fence.access_scope === "instagram_dashboard_admin"));
  assert.ok(fences.every(family => family.fence.tenant_or_scope_id === "instagram_dashboard_admin"));
});

test("17 helper observation records bounded structured degradation without payload values", async () => {
  const result = await observeProfilesLiveRead("runtime_projection", 20, async () => {
    throw Object.assign(new Error("provider unavailable"), { status: 503 });
  });
  assert.equal(result.envelope.state, "HTTP_ERROR");
  assert.deepEqual(Object.keys(result.observation).sort(), [
    "budget_ms", "elapsed_ms", "finished_at", "helper", "reason", "result_class", "started_at",
  ]);
  assert.equal(result.observation.helper, "runtime_projection");
  assert.equal(result.observation.budget_ms, 20);
  assert.equal(result.observation.result_class, "HTTP_ERROR");
  assert.equal(result.observation.reason, "PROVIDER_HTTP_ERROR");
  assert.ok(result.observation.elapsed_ms >= 0);
});

test("18 field-family telemetry distinguishes partial known and unknown truth", () => {
  const freshness = buildProfilesFreshness([{ accountId: "a" }], new Date().toISOString(), [], "READ_DEADLINE");
  const summary = profilesLiveFieldFamilySummary("PARTIAL", freshness, "FRESH");
  assert.ok(summary.known_field_families.includes("membership"));
  assert.ok(summary.known_field_families.includes("identity"));
  assert.ok(summary.unknown_field_families.includes("runtime"));
  assert.ok(summary.unknown_field_families.includes("security"));
});

test("19 unavailable field-family telemetry marks every family unknown", () => {
  const summary = profilesLiveFieldFamilySummary("UNAVAILABLE", {}, "UNKNOWN");
  assert.equal(summary.known_field_families.length, 0);
  assert.equal(summary.unknown_field_families.length, 17);
});
