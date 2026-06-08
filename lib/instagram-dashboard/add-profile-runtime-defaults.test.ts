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
