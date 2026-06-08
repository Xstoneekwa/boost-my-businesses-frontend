import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultAddProfileCommercialPackage,
  resolveAddProfilePackagePreset,
} from "./add-profile-packages.ts";

test("default Add Profile package is production Growth", () => {
  assert.equal(defaultAddProfileCommercialPackage(), "growth");
});

test("Growth preset keeps Outreach optional and enables normal post-follow actions for full_cycle", () => {
  const preset = resolveAddProfilePackagePreset({
    commercialPackage: "growth",
    runtimeMode: "full_cycle",
    addons: [],
  });

  assert.equal(preset.commercialPackageCode, "growth");
  assert.equal(preset.followEnabled, true);
  assert.equal(preset.likeEnabled, true);
  assert.equal(preset.muteAfterFollowEnabled, true);
  assert.equal(preset.unfollowEnabled, true);
  assert.equal(preset.outreachEnabled, false);
});

test("Pro and Premium presets enable Welcome but keep Outreach disabled without add-on", () => {
  for (const commercialPackage of ["pro", "premium"] as const) {
    const preset = resolveAddProfilePackagePreset({
      commercialPackage,
      runtimeMode: "full_cycle",
      addons: [],
    });

    assert.equal(preset.welcomeEnabled, true);
    assert.equal(preset.outreachEnabled, false);
  }
});

test("Outreach only becomes enabled with explicit outreach add-on", () => {
  const withoutAddon = resolveAddProfilePackagePreset({
    commercialPackage: "premium",
    runtimeMode: "outreach_only",
    addons: [],
  });
  const withAddon = resolveAddProfilePackagePreset({
    commercialPackage: "premium",
    runtimeMode: "outreach_only",
    addons: ["extra_outreach_volume"],
  });

  assert.equal(withoutAddon.outreachEnabled, false);
  assert.equal(withAddon.outreachEnabled, true);
  assert.equal(withAddon.outreachPerDayLimit, 30);
});

test("safe_setup does not enable runtime actions", () => {
  const preset = resolveAddProfilePackagePreset({
    commercialPackage: "growth",
    runtimeMode: "safe_setup",
    addons: ["extra_outreach_volume"],
  });

  assert.equal(preset.followEnabled, false);
  assert.equal(preset.likeEnabled, false);
  assert.equal(preset.muteAfterFollowEnabled, false);
  assert.equal(preset.unfollowEnabled, false);
  assert.equal(preset.welcomeEnabled, false);
  assert.equal(preset.outreachEnabled, false);
});
