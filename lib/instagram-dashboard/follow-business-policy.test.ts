import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveAccountFollowBusinessPolicy, type AccountFollowBusinessPolicyInput } from "./follow-business-policy.ts";
import { buildAccountFollowLimitProjection } from "./follow-limit-projection.ts";
import { classifyFollowLimitReconciliation } from "./follow-limit-reconciliation.ts";

const asOf = "2026-07-22T12:00:00.000Z";

function input(overrides: Partial<AccountFollowBusinessPolicyInput> = {}): AccountFollowBusinessPolicyInput {
  return {
    packageCode: "growth",
    packageDayCap: 80,
    packageSessionCap: 80,
    override: null,
    warmup: { enabled: false, packageStartedAt: null },
    asOf,
    ...overrides,
  };
}

test("1 Growth without override resolves 80/80", () => {
  const result = resolveAccountFollowBusinessPolicy(input());
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [80, 80]);
});

test("2 Pro without override resolves 120/120", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ packageCode: "pro", packageDayCap: 120, packageSessionCap: 120 }));
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [120, 120]);
});

test("3 Premium without override resolves 120/120", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ packageCode: "premium", packageDayCap: 120, packageSessionCap: 120 }));
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [120, 120]);
});

test("4 internal_test resolves 20/20", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ packageCode: "internal_test", packageDayCap: 20, packageSessionCap: 20 }));
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [20, 20]);
});

test("5 outreach without Follow fails closed", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ packageCode: "outreach_standalone", packageDayCap: null, packageSessionCap: null }));
  assert.equal(result.business_day_cap, null);
  assert.equal(result.limiting_reason, "package_has_no_follow_cap");
});

test("6 Growth lower override limits both dimensions", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ override: { followDayCapOverride: 40, followSessionCapOverride: 40, source: "admin" } }));
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [40, 40]);
});

test("7 Growth override above package stays stored but bounded", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ override: { followDayCapOverride: 100, followSessionCapOverride: 100, source: "admin" } }));
  assert.deepEqual([result.account_day_override, result.business_day_cap], [100, 80]);
  assert.equal(result.limiting_reason, "override_above_package_bounded");
});

test("8 Pro lower override limits independently", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ packageCode: "pro", packageDayCap: 120, packageSessionCap: 120, override: { followDayCapOverride: 100, followSessionCapOverride: 60, source: "support" } }));
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [100, 60]);
});

test("9 absent package fails closed", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ packageCode: null, packageDayCap: null, packageSessionCap: null }));
  assert.equal(result.limiting_reason, "effective_package_missing");
});

for (const [number, day, cap] of [[10, 1, 10], [11, 2, 20], [12, 3, 40]] as const) {
  test(`${number} warmup Day ${day} resolves ${cap}/${cap}`, () => {
    const startDay = 23 - day;
    const result = resolveAccountFollowBusinessPolicy(input({ warmup: { enabled: true, packageStartedAt: `2026-07-${String(startDay).padStart(2, "0")}T23:00:00.000Z` } }));
    assert.equal(result.warmup_day, day);
    assert.deepEqual([result.business_day_cap, result.business_session_cap], [cap, cap]);
  });
}

test("13 Day 4+ Growth uses dynamic 80/80", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ warmup: { enabled: true, packageStartedAt: "2026-07-19T00:00:00.000Z", day4PlusFollowCap: null } }));
  assert.deepEqual([result.warmup_day_cap, result.warmup_session_cap], [80, 80]);
});

for (const [number, code] of [[14, "pro"], [15, "premium"]] as const) {
  test(`${number} Day 4+ ${code} uses dynamic 120/120`, () => {
    const result = resolveAccountFollowBusinessPolicy(input({ packageCode: code, packageDayCap: 120, packageSessionCap: 120, warmup: { enabled: true, packageStartedAt: "2026-07-19T00:00:00.000Z", day4PlusFollowCap: null } }));
    assert.deepEqual([result.warmup_day_cap, result.warmup_session_cap], [120, 120]);
  });
}

test("16 Growth to Pro without override expands dynamically", () => {
  const before = resolveAccountFollowBusinessPolicy(input());
  const after = resolveAccountFollowBusinessPolicy(input({ packageCode: "pro", packageDayCap: 120, packageSessionCap: 120 }));
  assert.deepEqual([before.business_day_cap, after.business_day_cap], [80, 120]);
});

test("17 Pro to Growth without override contracts dynamically", () => {
  const result = resolveAccountFollowBusinessPolicy(input());
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [80, 80]);
});

test("18 upgrade preserves a lower override", () => {
  const override = { followDayCapOverride: 40, followSessionCapOverride: 40, source: "admin" as const };
  const result = resolveAccountFollowBusinessPolicy(input({ packageCode: "pro", packageDayCap: 120, packageSessionCap: 120, override }));
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [40, 40]);
});

test("19 downgrade preserves and bounds a higher override", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ override: { followDayCapOverride: 100, followSessionCapOverride: 100, source: "admin" } }));
  assert.equal(result.account_override_above_package, true);
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [80, 80]);
});

test("20 reset is represented by absence of an override", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ override: null }));
  assert.equal(result.account_override_present, false);
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [80, 80]);
});

test("21 provisioning creates no override row", () => {
  const source = readFileSync(new URL("../instagram-client/create-account.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\(["']ig_account_follow_limit_overrides["']\)\.insert/);
  assert.match(source, /must not create ig_account_follow_limit_overrides/);
});

test("22 warmup never becomes an account override", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ warmup: { enabled: true, packageStartedAt: "2026-07-22T00:00:00Z" } }));
  assert.equal(result.account_override_present, false);
  assert.equal(result.limiting_source, "warmup");
});

test("23 projection marks legacy values read-only", () => {
  const policy = resolveAccountFollowBusinessPolicy(input());
  const projection = buildAccountFollowLimitProjection(policy, { maxActionsPerDay: 120, followLimit: 20, maxFollowPerRun: 10 });
  assert.equal(projection.legacy.read_only, true);
  assert.equal(projection.account_override.status, "None — using package defaults");
});

test("24 admin save and reset use the canonical audit log", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260722012822_follow_limit_provenance_v1.sql", import.meta.url), "utf8");
  assert.match(sql, /insert into public\.ig_action_logs/);
  assert.match(sql, /create_override/);
  assert.match(sql, /update_override/);
  assert.match(sql, /reset_to_package_defaults/);
});

test("25 client roles receive no direct table or RPC access", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260722012822_follow_limit_provenance_v1.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on table[\s\S]*from public, anon, authenticated/i);
  assert.equal((sql.match(/revoke all on function/g) ?? []).length, 2);
});

test("26 RLS is enabled and only service_role is granted", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260722012822_follow_limit_provenance_v1.sql", import.meta.url), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /grant select on table[\s\S]*to service_role/i);
  assert.match(sql, /revoke insert, update, delete[\s\S]*from service_role/i);
});

test("27 dry-run recognizes an exact admin match", () => {
  const row = classifyFollowLimitReconciliation({ account: "i_m_your_traker", packageCode: "pro", packageDayCap: 120, packageSessionCap: 120, legacyDayCap: 120, legacySessionCap: 20, legacyRunCap: 10, exactAdminAuditMatch: true, onboardingDefaultsMatch: true, confirmedTestValue: false });
  assert.equal(row.classification, "explicit_override_confirmed");
});

test("28 dry-run recognizes onboarding legacy", () => {
  const row = classifyFollowLimitReconciliation({ account: "j_automatise_pour_toi", packageCode: "growth", packageDayCap: 80, packageSessionCap: 80, legacyDayCap: 120, legacySessionCap: 20, legacyRunCap: 10, exactAdminAuditMatch: false, onboardingDefaultsMatch: true, confirmedTestValue: false });
  assert.equal(row.classification, "package_seeded_legacy");
});

test("29 dry-run fails ambiguous evidence to manual review", () => {
  const row = classifyFollowLimitReconciliation({ account: "unknown", packageCode: "growth", packageDayCap: 80, packageSessionCap: 80, legacyDayCap: 55, legacySessionCap: 13, legacyRunCap: 10, exactAdminAuditMatch: false, onboardingDefaultsMatch: false, confirmedTestValue: false });
  assert.equal(row.classification, "ambiguous_manual_review");
});

test("30 override RPC cannot change execution switches", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260722012822_follow_limit_provenance_v1.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /update\s+public\.ig_account_settings/i);
  assert.doesNotMatch(sql, /follow_enabled|dry_run_enabled|send_enabled/i);
});

test("31 day-only override leaves session at package", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ override: { followDayCapOverride: 30, followSessionCapOverride: null, source: "admin" } }));
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [30, 80]);
});

test("32 session-only override leaves day at package", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ override: { followDayCapOverride: null, followSessionCapOverride: 30, source: "admin" } }));
  assert.deepEqual([result.business_day_cap, result.business_session_cap], [80, 30]);
});

test("33 feature flag defaults off", async () => {
  const { followLimitOverrideV1Enabled } = await import("./follow-limit-feature.ts");
  assert.equal(followLimitOverrideV1Enabled({} as NodeJS.ProcessEnv), false);
});

test("34 mixed dimensions expose deterministic sources", () => {
  const result = resolveAccountFollowBusinessPolicy(input({ override: { followDayCapOverride: null, followSessionCapOverride: 15, source: "admin" }, warmup: { enabled: true, packageStartedAt: "2026-07-21T00:00:00Z" } }));
  assert.equal(result.day_limiting_source, "warmup");
  assert.equal(result.session_limiting_source, "account_override");
  assert.equal(result.limiting_source, "mixed");
});

test("35 missing package and settings remain ambiguous in reconciliation", () => {
  const row = classifyFollowLimitReconciliation({ account: "recovery_test", packageCode: null, packageDayCap: null, packageSessionCap: null, legacyDayCap: null, legacySessionCap: null, legacyRunCap: null, exactAdminAuditMatch: false, onboardingDefaultsMatch: false, confirmedTestValue: false });
  assert.equal(row.classification, "ambiguous_manual_review");
});
