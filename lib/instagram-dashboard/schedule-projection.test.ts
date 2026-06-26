import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scheduleRoute = readFileSync(
  new URL("../../app/api/instagram-dashboard/settings/schedule/route.ts", import.meta.url),
  "utf8",
);

test("schedule projection hides default RPC device when account has no assignment", () => {
  assert.match(scheduleRoute, /const projectionDeviceId = currentAssignmentRaw/);
  assert.match(scheduleRoute, /: null;/);
  assert.match(scheduleRoute, /device_label: deviceLabel/);
  assert.doesNotMatch(
    scheduleRoute,
    /const deviceId = readString\(slotPayload\.device_id[\s\S]{0,120}device_label: deviceLabel/,
  );
});

test("assign now keeps current-window requirement separate from onboarding reservation", () => {
  const assignNow = readFileSync(new URL("./assign-now.ts", import.meta.url), "utf8");
  const onboarding = readFileSync(new URL("./onboarding-schedule.ts", import.meta.url), "utf8");
  assert.match(assignNow, /requireCurrentWindow: true/);
  assert.match(onboarding, /reservationMode: explicitWindowProvided \? "immediate" : "onboarding"/);
});
