import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSocialProfileBaselineInventory,
  runSocialProfileBaseline,
  socialProfileBaselineBatchId,
  socialProfileBaselineLogRecord,
  validateSocialProfileBaselineRequest,
} from "./social-profile-baseline.ts";
import { socialProfileSnapshotIdempotencyKey } from "./social-profile-snapshot-contract.ts";
import {
  socialProfileSnapshotBaselineEnabled,
  socialProfileSnapshotsEnabled,
} from "./social-profile-snapshot-rollout.ts";
import { processClaimedSocialProfileSnapshotJobs } from "./social-profile-snapshot-service.ts";

const NOW = new Date("2026-07-22T12:00:00.000Z");
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";

function rawAccount(overrides = {}) {
  return { id: ACCOUNT_ID, username: "future_account", status: "active", admin_lifecycle_status: "active", ...overrides };
}

function rawSnapshot(overrides = {}) {
  return {
    account_id: ACCOUNT_ID,
    followers_count: 10,
    following_count: null,
    posts_count: null,
    observed_at: "2026-07-20T00:00:00.000Z",
    snapshot_local_date: "2026-07-20",
    source_provider: "legacy_follower_snapshot",
    source_trigger: "legacy_import",
    ...overrides,
  };
}

function inventory(overrides = {}) {
  return buildSocialProfileBaselineInventory({
    accounts: [rawAccount()],
    assignments: [],
    devices: [],
    snapshots: [],
    now: NOW,
    ...overrides,
  });
}

function executeRequest(overrides = {}) {
  return {
    mode: "execute",
    maxAccounts: 10,
    expectedAccountCount: 1,
    maxProviderCalls: 1,
    idempotencyKey: "operator-batch-20260722",
    confirmation: "RUN_BASELINE",
    ...overrides,
  };
}

function processing(providerCalls = 1) {
  return {
    claimed: providerCalls,
    processed: providerCalls,
    providerCalls,
    succeeded: providerCalls,
    failedRetryable: 0,
    failedTerminal: 0,
    budgetExhausted: false,
    results: [],
  };
}

function dependencies(inv = inventory(), overrides = {}) {
  const calls = { load: 0, find: 0, create: 0, discard: 0, process: 0 };
  const value = {
    loadInventory: async () => { calls.load += 1; return inv; },
    findExistingBatch: async () => { calls.find += 1; return false; },
    createJobs: async (accounts) => { calls.create += 1; return accounts.length; },
    discardJobs: async () => { calls.discard += 1; return 0; },
    processBatch: async (_batchId, maxCalls) => { calls.process += 1; return processing(maxCalls); },
    ...overrides,
  };
  return { value, calls };
}

test("baseline flag is disabled when absent", () => assert.equal(socialProfileSnapshotBaselineEnabled(undefined), false));
test("baseline flag is disabled when false", () => assert.equal(socialProfileSnapshotBaselineEnabled("false"), false));
test("recurring true does not enable baseline", () => {
  assert.equal(socialProfileSnapshotsEnabled("true"), true);
  assert.equal(socialProfileSnapshotBaselineEnabled(undefined), false);
});
test("baseline true does not enable recurring", () => {
  assert.equal(socialProfileSnapshotBaselineEnabled("true"), true);
  assert.equal(socialProfileSnapshotsEnabled(undefined), false);
});

test("dry run performs no job write and no provider call", async () => {
  const mock = dependencies();
  const result = await runSocialProfileBaseline({ mode: "dry_run", maxAccounts: 10 }, mock.value, NOW);
  assert.equal(result.status, "dry_run");
  assert.equal(result.providerCalls, 0);
  assert.equal(JSON.stringify(result).includes("future_account"), false);
  assert.equal(result.accounts[0].account_ref.length, 12);
  assert.deepEqual(mock.calls, { load: 1, find: 0, create: 0, discard: 0, process: 0 });
});

for (const [name, body, status] of [
  ["missing confirmation", { mode: "execute", max_accounts: 10, expected_account_count: 1, max_provider_calls: 1, idempotency_key: "key" }, "confirmation_required"],
  ["missing idempotency key", { mode: "execute", max_accounts: 10, expected_account_count: 1, max_provider_calls: 1, confirmation: "RUN_BASELINE" }, "idempotency_key_required"],
  ["max accounts above ten", { mode: "dry_run", max_accounts: 11 }, "invalid_max_accounts"],
]) test(`request refuses ${name}`, () => {
  const parsed = validateSocialProfileBaselineRequest(body);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.status, status);
});

test("execute refuses an expected account count mismatch before writes", async () => {
  const mock = dependencies();
  const result = await runSocialProfileBaseline(executeRequest({ expectedAccountCount: 2 }), mock.value, NOW);
  assert.equal(result.status, "expected_account_count_mismatch");
  assert.equal(mock.calls.create, 0);
  assert.equal(mock.calls.process, 0);
});

test("execute refuses a provider budget below eligible count", async () => {
  const inv = inventory({ accounts: [rawAccount(), rawAccount({ id: "00000000-0000-4000-8000-000000000002", username: "second" })] });
  const mock = dependencies(inv);
  const result = await runSocialProfileBaseline(executeRequest({ expectedAccountCount: 2, maxProviderCalls: 1 }), mock.value, NOW);
  assert.equal(result.status, "provider_budget_exceeded");
  assert.equal(mock.calls.create, 0);
});

test("current modern snapshot is skipped", () => {
  const result = inventory({ snapshots: [rawSnapshot({ source_trigger: "daily_fallback", source_provider: "searchapi", observed_at: "2026-07-22T00:01:00.000Z" })] });
  assert.equal(result.accounts[0].classification, "snapshot_current");
  assert.equal(result.eligible.length, 0);
});

test("stale modern or legacy-only snapshot is eligible", () => {
  assert.equal(inventory({ snapshots: [rawSnapshot()] }).accounts[0].classification, "snapshot_stale");
  assert.equal(inventory({ snapshots: [rawSnapshot({ source_trigger: "daily_fallback", observed_at: "2026-07-20T00:00:00.000Z" })] }).eligible.length, 1);
});

test("account without snapshot is eligible", () => assert.equal(inventory().accounts[0].classification, "no_snapshot"));
test("invalid username is excluded", () => assert.equal(inventory({ accounts: [rawAccount({ username: "not valid!" })] }).eligible.length, 0));
test("inactive lifecycle is excluded", () => assert.equal(inventory({ accounts: [rawAccount({ admin_lifecycle_status: "paused" })] }).eligible.length, 0));
test("multiple active assignments require manual review", () => {
  const assignments = [
    { account_id: ACCOUNT_ID, device_id: "device-1", status: "active", created_at: "2026-07-22T01:00:00Z" },
    { account_id: ACCOUNT_ID, device_id: "device-2", status: "reserved", created_at: "2026-07-22T02:00:00Z" },
  ];
  assert.equal(inventory({ assignments }).accounts[0].classification, "ambiguous_manual_review");
});

test("same idempotency key replay makes zero calls", async () => {
  const mock = dependencies(inventory(), { findExistingBatch: async () => true });
  const result = await runSocialProfileBaseline(executeRequest(), mock.value, NOW);
  assert.equal(result.status, "idempotent_replay");
  assert.equal(result.providerCalls, 0);
  assert.equal(mock.calls.create, 0);
  assert.equal(mock.calls.process, 0);
});

test("two concurrent one-shots remain bounded to one created batch", async () => {
  let created = false;
  let providerCalls = 0;
  const mock = dependencies(inventory(), {
    findExistingBatch: async () => false,
    createJobs: async () => {
      if (created) return 0;
      created = true;
      return 1;
    },
    processBatch: async () => { providerCalls += 1; return processing(1); },
  });
  const results = await Promise.all([
    runSocialProfileBaseline(executeRequest(), mock.value, NOW),
    runSocialProfileBaseline(executeRequest(), mock.value, NOW),
  ]);
  assert.equal(providerCalls, 1);
  assert.equal(results.reduce((sum, result) => sum + result.providerCalls, 0), 1);
});

test("provider count postcondition rejects an impossible overrun", async () => {
  const mock = dependencies(inventory(), { processBatch: async () => processing(2) });
  await assert.rejects(runSocialProfileBaseline(executeRequest(), mock.value, NOW), /provider_budget_violation/);
});

function processorSupabase(updates) {
  return {
    from(table) {
      assert.equal(table, "ig_social_profile_snapshot_jobs");
      return {
        update(values) {
          return {
            async eq(_column, id) {
              updates.push({ ids: [id], values });
              return { error: null };
            },
            async in(_column, ids) {
              updates.push({ ids, values });
              return { error: null };
            },
          };
        },
      };
    },
  };
}

function claimedJob(index) {
  return {
    id: `job-${index}`,
    account_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    username_normalized: `account_${index}`,
    source_trigger: "baseline_one_shot",
    source_event_id: "batch-hash",
    attempts: 1,
  };
}

test("shared processor never fetches above its hard provider budget", async () => {
  const updates = [];
  let fetches = 0;
  const result = await processClaimedSocialProfileSnapshotJobs({
    jobs: [claimedJob(1), claimedJob(2), claimedJob(3)],
    maxProviderCalls: 2,
    supabase: processorSupabase(updates),
    lookup: async (username) => {
      fetches += 1;
      return { status: "found", reason: null, canonical_username: username, followers_count: 0, following_count: null, posts_count: null, checked_at: NOW.toISOString(), metadata: { provider_mode: "searchapi" } };
    },
    persist: async (input) => ({
      ok: true,
      created: true,
      row: { followers_count: 0, following_count: null, posts_count: null, observed_at: NOW.toISOString() },
    }),
    pause: async () => undefined,
  });
  assert.equal(fetches, 2);
  assert.equal(result.providerCalls, 2);
  assert.equal(result.budgetExhausted, true);
  assert.deepEqual(updates.at(-1).ids, ["job-3"]);
  assert.equal(updates.at(-1).values.last_error_code, "provider_budget_exhausted");
});

test("shared processor stops on rate limit and releases the remaining batch", async () => {
  const updates = [];
  let fetches = 0;
  const result = await processClaimedSocialProfileSnapshotJobs({
    jobs: [claimedJob(1), claimedJob(2)],
    maxProviderCalls: 2,
    supabase: processorSupabase(updates),
    lookup: async () => {
      fetches += 1;
      return { status: "rate_limited", reason: "rate_limited", canonical_username: null, followers_count: null, following_count: null, posts_count: null, checked_at: NOW.toISOString(), metadata: { provider_mode: "searchapi" } };
    },
    persist: async () => ({ ok: false, reason: "rate_limited" }),
    pause: async () => undefined,
  });
  assert.equal(fetches, 1);
  assert.equal(result.failedRetryable, 1);
  assert.equal(result.budgetExhausted, false);
  assert.deepEqual(updates.at(-1).ids, ["job-2"]);
  assert.equal(updates.at(-1).values.last_error_code, "batch_paused_after_rate_limit");
});

test("baseline job idempotency is stable per account and local date", () => {
  const first = socialProfileSnapshotIdempotencyKey({ accountId: ACCOUNT_ID, trigger: "baseline_one_shot", observedAt: "2026-07-22T01:00:00Z", timezone: "Africa/Johannesburg", sourceEventId: "batch-a" });
  const sameDay = socialProfileSnapshotIdempotencyKey({ accountId: ACCOUNT_ID, trigger: "baseline_one_shot", observedAt: "2026-07-22T18:00:00Z", timezone: "Africa/Johannesburg", sourceEventId: "batch-b" });
  const nextDay = socialProfileSnapshotIdempotencyKey({ accountId: ACCOUNT_ID, trigger: "baseline_one_shot", observedAt: "2026-07-23T18:00:00Z", timezone: "Africa/Johannesburg", sourceEventId: "batch-b" });
  assert.equal(first, sameDay);
  assert.notEqual(first, nextDay);
});

test("zero eligible accounts completes without creating jobs", async () => {
  const mock = dependencies(inventory({ accounts: [rawAccount({ status: "paused", admin_lifecycle_status: "paused" })] }));
  const result = await runSocialProfileBaseline(executeRequest({ expectedAccountCount: 0 }), mock.value, NOW);
  assert.equal(result.status, "baseline_completed");
  assert.equal(mock.calls.create, 0);
});

test("missing following and posts remain null", () => {
  const last = inventory({ snapshots: [rawSnapshot()] }).accounts[0].lastSnapshot;
  assert.equal(last.followings, null);
  assert.equal(last.posts, null);
});

test("zero is preserved as a valid absolute metric", () => {
  const last = inventory({ snapshots: [rawSnapshot({ followers_count: 0 })] }).accounts[0].lastSnapshot;
  assert.equal(last.followers, 0);
});

test("batch hash is deterministic and does not expose the operator key", () => {
  const key = "sensitive-operator-key";
  const batchId = socialProfileBaselineBatchId(key);
  assert.equal(batchId.length, 64);
  assert.equal(batchId.includes(key), false);
});

test("logs are redacted to batch prefix and aggregate counts", () => {
  const record = socialProfileBaselineLogRecord("complete", { batchId: "a".repeat(64), eligibleCount: 6, jobsCreated: 6, providerCalls: 6, status: "ok" });
  assert.deepEqual(Object.keys(record), ["component", "event", "batch_id_prefix", "eligible_count", "jobs_created", "provider_calls", "status"]);
  assert.equal(record.batch_id_prefix, "a".repeat(12));
  assert.equal(JSON.stringify(record).includes("username"), false);
});

test("future active accounts are discovered from the supplied inventory", () => {
  const result = inventory({ accounts: [rawAccount(), rawAccount({ id: "00000000-0000-4000-8000-000000000099", username: "new_later" })] });
  assert.equal(result.eligible.length, 2);
});

test("route authenticates before flag or database access and normal clients have no bypass", () => {
  const route = readFileSync(new URL("../../app/api/instagram-dashboard/internal/social-profile-snapshots/baseline/route.ts", import.meta.url), "utf8");
  const auth = readFileSync(new URL("../../app/api/instagram-dashboard/_utils.ts", import.meta.url), "utf8");
  assert.match(route, /requireInstagramAdmin\(\)/);
  assert.ok(route.indexOf("requireInstagramAdmin()") < route.indexOf("SOCIAL_PROFILE_SNAPSHOTS_BASELINE_ENABLED"));
  assert.doesNotMatch(route, /requireRelayOrAdmin|verifyCompassRelayKey/);
  assert.match(auth, /if \(process\.env\.NODE_ENV === "production"\) \{\s*return false;/);
  assert.match(auth, /return jsonError\("Authentication required\.", 401\)/);
});

test("one-shot source cannot claim historical or recurring jobs", () => {
  const migration = readFileSync(new URL("../../supabase/migrations/20260722130000_social_profile_snapshot_baseline_v1.sql", import.meta.url), "utf8");
  assert.match(migration, /j\.source_trigger = 'baseline_one_shot'/);
  assert.match(migration, /j\.source_event_id = p_source_event_id/);
  assert.match(migration, /limit greatest\(1, least\(coalesce\(p_limit, 10\), 10\)\)/);
});

function oneShotSources() {
  const module = readFileSync(new URL("./social-profile-baseline.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../app/api/instagram-dashboard/internal/social-profile-snapshots/baseline/route.ts", import.meta.url), "utf8");
  return { module, route, sources: `${module}\n${route}` };
}

test("implementation has no AI enrichment, Target AI, or provider-specific dependency", () => {
  const { sources } = oneShotSources();
  assert.doesNotMatch(sources, /OpenAI|SerpAPI|Target AI|target-ai|responses\.create/i);
});

test("implementation never updates an existing social profile snapshot", () => {
  const { sources } = oneShotSources();
  assert.doesNotMatch(sources, /from\("ig_account_social_profile_snapshots"\)\.update/);
});

test("implementation has no account hardcode and cannot activate recurring collection", () => {
  const { route, sources } = oneShotSources();
  assert.doesNotMatch(sources, /j_automatise_pour_toi|mythyl_fitness|i_m_your_traker/);
  assert.doesNotMatch(route, /SOCIAL_PROFILE_SNAPSHOTS_ENABLED/);
});
