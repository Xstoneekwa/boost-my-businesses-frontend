import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ASSIGNMENT_HEARTBEAT_STALE_MS,
  chooseLiveAssignmentSlot,
  isAppInstanceEligibleForNewAssignment,
  isAssignmentHeartbeatLive,
  isAutoAssignmentDeviceKindEligible,
  isDeviceInventoryEligible,
  isPhysicalPhoneDevice,
} from "./assignment-live-capacity.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const now = new Date("2026-06-15T12:00:00.000Z");

test("physical phone online with free clone is eligible for auto assignment", () => {
  assert.equal(isPhysicalPhoneDevice({ device_kind: "physical_phone" }), true);
  assert.equal(
    isAutoAssignmentDeviceKindEligible({ device_kind: "physical_phone" }, "physical_phone_only"),
    true,
  );
  assert.equal(
    isAssignmentHeartbeatLive({
      status: "online",
      last_seen_at: new Date(now.getTime() - 60_000).toISOString(),
    }, now),
    true,
  );
  assert.equal(isAppInstanceEligibleForNewAssignment({
    status: "available",
    usable_for_auto_login: true,
    is_launchable: true,
    current_account_id: null,
  }), true);
});

test("stale or offline physical phone is rejected", () => {
  assert.equal(isPhysicalPhoneDevice({ device_kind: "physical_phone" }), true);
  assert.equal(
    isAssignmentHeartbeatLive({
      status: "online",
      last_seen_at: new Date(now.getTime() - ASSIGNMENT_HEARTBEAT_STALE_MS - 1000).toISOString(),
    }, now),
    false,
  );
});

test("online emulator with free clone is rejected for client auto assignment", () => {
  assert.equal(isPhysicalPhoneDevice({ device_kind: "emulator" }), false);
  assert.equal(
    isAutoAssignmentDeviceKindEligible({ device_kind: "emulator" }, "physical_phone_only"),
    false,
  );
  assert.equal(
    isAutoAssignmentDeviceKindEligible({ device_kind: "emulator" }, "any_eligible"),
    true,
  );
});

test("unknown or virtual device kinds are rejected for auto assignment", () => {
  assert.equal(
    isAutoAssignmentDeviceKindEligible({ device_kind: "virtual" }, "physical_phone_only"),
    false,
  );
  assert.equal(
    isAutoAssignmentDeviceKindEligible({ device_kind: "test_device" }, "physical_phone_only"),
    false,
  );
  assert.equal(
    isAutoAssignmentDeviceKindEligible({ device_kind: "" }, "physical_phone_only"),
    false,
  );
});

test("stale or offline heartbeat is rejected", () => {
  assert.equal(isAssignmentHeartbeatLive({ status: "offline", last_seen_at: now.toISOString() }, now), false);
  assert.equal(
    isAssignmentHeartbeatLive({
      status: "online",
      last_seen_at: new Date(now.getTime() - ASSIGNMENT_HEARTBEAT_STALE_MS - 1000).toISOString(),
    }, now),
    false,
  );
});

test("fresh online heartbeat is accepted", () => {
  assert.equal(
    isAssignmentHeartbeatLive({
      status: "online",
      last_seen_at: new Date(now.getTime() - 60_000).toISOString(),
    }, now),
    true,
  );
});

test("maintenance and disabled devices are rejected", () => {
  assert.equal(isDeviceInventoryEligible("maintenance"), false);
  assert.equal(isDeviceInventoryEligible("disabled"), false);
  assert.equal(isDeviceInventoryEligible("available"), true);
  assert.equal(isDeviceInventoryEligible("active"), true);
});

test("occupied clone is rejected for new assignment", () => {
  assert.equal(isAppInstanceEligibleForNewAssignment({
    status: "available",
    usable_for_auto_login: true,
    is_launchable: true,
    current_account_id: "other-account",
  }), false);
  assert.equal(isAppInstanceEligibleForNewAssignment({
    status: "occupied",
    usable_for_auto_login: true,
    is_launchable: true,
    current_account_id: null,
  }), false);
});

test("free launchable clone is accepted", () => {
  assert.equal(isAppInstanceEligibleForNewAssignment({
    status: "available",
    usable_for_auto_login: true,
    is_launchable: true,
    current_account_id: null,
  }), true);
});

test("current-window slot selection prefers live now window", () => {
  const slots = [
    {
      slot_index: 1,
      slot_kind: "full_cycle",
      slot_kind_label: "Morning",
      local_label: "08:00",
      starts_at: "2026-06-15T06:00:00.000Z",
      ends_at: "2026-06-15T10:00:00.000Z",
      available: true,
      reason: "available",
      occupied_by: null,
    },
    {
      slot_index: 2,
      slot_kind: "full_cycle",
      slot_kind_label: "Afternoon",
      local_label: "12:00",
      starts_at: "2026-06-15T12:00:00.000Z",
      ends_at: "2026-06-15T16:00:00.000Z",
      available: true,
      reason: "available",
      occupied_by: null,
    },
  ];
  const selected = chooseLiveAssignmentSlot(slots, { requireCurrentWindow: true, now });
  assert.equal(selected?.slot_index, 2);
});

test("onboarding schedule uses live assignment resolver", () => {
  const onboarding = source("./onboarding-schedule.ts");
  assert.match(onboarding, /resolveLiveAssignmentTarget/);
  assert.match(onboarding, /already_assigned/);
  assert.match(onboarding, /deviceKindPolicy: target\.deviceId \? "any_eligible" : "physical_phone_only"/);
  assert.match(onboarding, /reservationMode: explicitWindowProvided \? "immediate" : "onboarding"/);
  assert.match(onboarding, /releaseIneligibleOnboardingAssignment/);
  assert.doesNotMatch(onboarding, /requireCurrentWindow: !explicitWindowProvided/);
});

test("assign now uses live assignment resolver before slot write", () => {
  const assignNow = source("./assign-now.ts");
  assert.match(assignNow, /resolveLiveAssignmentTarget/);
  assert.match(assignNow, /deviceKindPolicy: "physical_phone_only"/);
  assert.match(assignNow, /live_device_unavailable/);
});

test("readiness now checks assignment slot capacity and physical phone assignments", () => {
  const readiness = source("./readiness-now.ts");
  assert.match(readiness, /list_available_assignment_slots/);
  assert.match(readiness, /requirePhysicalPhone: audience === "client"/);
});

test("resolver queries canonical phone_devices.device_kind for auto assignment", () => {
  const resolver = source("./assignment-live-capacity.ts");
  assert.match(resolver, /device_kind/);
  assert.match(resolver, /physical_phone_only/);
  assert.match(resolver, /physical_phone_unavailable/);
  assert.doesNotMatch(resolver, /Entry 2C Emulator/);
  assert.doesNotMatch(resolver, /emulator-5554/);
});

test("create account defers assignment when only emulators are available", () => {
  const createAccount = source("../instagram-client/create-account.ts");
  const onboarding = source("./onboarding-schedule.ts");
  assert.match(createAccount, /pending_assignment/);
  assert.match(onboarding, /physical_phone_only/);
});

test("dm domain service resolves welcome from account package capacity", () => {
  const dmService = source("../instagram-client/account-dm-capacity.ts");
  const domainService = source("./dm-domain-service.ts");
  assert.match(dmService, /account_package_summary|resolveAccountPackageCode/);
  assert.match(dmService, /packageIncludesWelcomeDm/);
  assert.match(domainService, /resolveAccountWelcomeServiceActive/);
});
