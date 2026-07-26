import assert from "node:assert/strict";
import test from "node:test";

import { applyAddProfileRuntimeDefaults } from "./add-profile-runtime-defaults.ts";
import { resolveAddProfilePackagePreset } from "./add-profile-packages.ts";

function makeSupabase(welcomeTemplateBody: string | null = null) {
  const calls: Array<{ table: string; action: string; payload?: unknown }> = [];
  const builder = (table: string, action: string, payload?: unknown) => {
    calls.push({ table, action, payload });
    const chain = {
      eq: () => Promise.resolve({ data: [], error: null }),
      catch: () => Promise.resolve({ data: [], error: null }),
    };
    return chain;
  };

  return {
    calls,
    client: {
      from(table: string) {
        return {
          select() {
            calls.push({ table, action: "select" });
            const chain = {
              eq: () => chain,
              limit: () => chain,
              maybeSingle: () => Promise.resolve({
                data: welcomeTemplateBody === null ? null : { id: "welcome-template-1", body: welcomeTemplateBody },
                error: null,
              }),
            };
            return chain;
          },
          update(payload: unknown) {
            return {
              eq: () => {
                calls.push({ table, action: "update", payload });
                return Promise.resolve({ data: [], error: null });
              },
            };
          },
          upsert(payload: unknown) {
            return builder(table, "upsert", payload);
          },
          insert(payload: unknown) {
            calls.push({ table, action: "insert", payload });
            return Promise.resolve({ data: [], error: null });
          },
        };
      },
    },
  };
}

test("applyAddProfileRuntimeDefaults writes domain rows without device ids or secrets", async () => {
  const supabase = makeSupabase();
  const preset = resolveAddProfilePackagePreset({
    commercialPackage: "pro",
    runtimeMode: "full_cycle",
    addons: [],
  });

  const result = await applyAddProfileRuntimeDefaults(supabase.client as never, {
    accountId: "account-1",
    username: "safeuser",
    appPackageName: "com.instagram.android.clone1",
    preset,
  });

  assert.equal(result.ok, true);
  const settingsPayload = supabase.calls.find((call) => call.table === "ig_account_settings")?.payload as Record<string, unknown>;
  assert.equal(settingsPayload.max_actions_per_day, preset.defaultFollowDayCap);
  assert.equal(settingsPayload.follow_limit, preset.defaultFollowSessionCap);
  assert.equal(settingsPayload.max_follow_per_run, preset.defaultFollowSessionCap);
  assert.deepEqual(supabase.calls.map((call) => call.table), [
    "ig_dm_templates",
    "ig_account_settings",
    "ig_account_follow_settings",
    "ig_account_dm_settings",
    "ig_account_unfollow_settings",
    "add_profile_audit_events",
  ]);

  const serialized = JSON.stringify(supabase.calls).toLowerCase();
  for (const forbidden of ["password", "secret", "vault", "token", "service_role", "device_id", "app_instance_id", "adb"]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden leak: ${forbidden}`);
  }
  assert.equal(serialized.includes("mute_after_follow_enabled"), true);
  assert.equal(serialized.includes("outreach_enabled"), true);
});

test("Pro runtime defaults keep Welcome disabled when no valid template exists", async () => {
  const supabase = makeSupabase();
  const preset = resolveAddProfilePackagePreset({
    commercialPackage: "pro",
    runtimeMode: "full_cycle",
    addons: [],
  });

  const result = await applyAddProfileRuntimeDefaults(supabase.client as never, {
    accountId: "account-1",
    username: "safeuser",
    appPackageName: "com.instagram.android.clone1",
    preset,
  });

  assert.equal(result.ok, true);
  const settings = supabase.calls.find((call) => call.table === "ig_account_settings")?.payload as Record<string, unknown>;
  const dm = supabase.calls.find((call) => call.table === "ig_account_dm_settings")?.payload as Record<string, unknown>;
  const unfollow = supabase.calls.find((call) => call.table === "ig_account_unfollow_settings")?.payload as Record<string, unknown>;

  assert.equal(settings.follow_enabled, true);
  assert.equal(settings.unfollow_enabled, true);
  assert.equal(settings.welcome_dm_enabled, false);
  assert.equal(settings.cold_dm_enabled, false);
  assert.equal(dm.welcome_enabled, false);
  assert.equal(dm.outreach_enabled, false);
  assert.equal(unfollow.unfollow_enabled, true);
  assert.equal(unfollow.unfollow_mode, "unfollow");
  assert.equal(unfollow.unfollow_per_session_limit, 120);
  assert.equal(unfollow.unfollow_per_day_limit, 120);
  assert.equal(unfollow.runtime_cap_mode, "prod_normal");
  assert.equal(unfollow.runtime_safety_cap, null);
});

test("Pro runtime defaults enable Welcome only when an active non-empty template exists", async () => {
  const supabase = makeSupabase("Bienvenue !");
  const preset = resolveAddProfilePackagePreset({
    commercialPackage: "pro",
    runtimeMode: "full_cycle",
    addons: [],
  });

  const result = await applyAddProfileRuntimeDefaults(supabase.client as never, {
    accountId: "account-1",
    username: "safeuser",
    appPackageName: "com.instagram.android.clone1",
    preset,
  });
  const settings = supabase.calls.find((call) => call.table === "ig_account_settings")?.payload as Record<string, unknown>;
  const dm = supabase.calls.find((call) => call.table === "ig_account_dm_settings")?.payload as Record<string, unknown>;
  assert.equal(result.ok, true);
  assert.equal(settings.welcome_dm_enabled, true);
  assert.equal(dm.welcome_enabled, true);
});

for (const packageCode of ["growth", "pro", "premium"] as const) {
  test(`${packageCode} new account inherits its package day/session caps without 20/10 legacy defaults`, async () => {
    const supabase = makeSupabase();
    const preset = resolveAddProfilePackagePreset({
      commercialPackage: packageCode,
      runtimeMode: "full_cycle",
      addons: [],
    });
    await applyAddProfileRuntimeDefaults(supabase.client as never, {
      accountId: `account-${packageCode}`,
      username: `safe_${packageCode}`,
      appPackageName: "com.instagram.android",
      preset,
    });
    const settings = supabase.calls.find((call) => call.table === "ig_account_settings")?.payload as Record<string, unknown>;
    assert.equal(settings.max_actions_per_day, preset.defaultFollowDayCap);
    assert.equal(settings.follow_limit, preset.defaultFollowSessionCap);
    assert.equal(settings.max_follow_per_run, preset.defaultFollowSessionCap);
    if (packageCode !== "growth") {
      assert.notEqual(settings.follow_limit, 20);
      assert.notEqual(settings.max_follow_per_run, 10);
    }
  });
}
