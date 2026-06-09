import assert from "node:assert/strict";
import test from "node:test";

import { applyAddProfileRuntimeDefaults } from "./add-profile-runtime-defaults.ts";
import { resolveAddProfilePackagePreset } from "./add-profile-packages.ts";

function makeSupabase() {
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
  assert.deepEqual(supabase.calls.map((call) => call.table), [
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

test("Pro runtime defaults write coherent Follow Unfollow Welcome settings without Outreach", async () => {
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
  assert.equal(settings.welcome_dm_enabled, true);
  assert.equal(settings.cold_dm_enabled, false);
  assert.equal(dm.welcome_enabled, true);
  assert.equal(dm.outreach_enabled, false);
  assert.equal(unfollow.unfollow_enabled, true);
  assert.equal(unfollow.unfollow_mode, "unfollow");
  assert.equal(unfollow.unfollow_per_session_limit, 120);
  assert.equal(unfollow.unfollow_per_day_limit, 120);
  assert.equal(unfollow.runtime_cap_mode, "prod_normal");
  assert.equal(unfollow.runtime_safety_cap, null);
});
