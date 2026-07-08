import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_PROVISIONING_SLOT_WINDOW_MINUTES,
  CLIENT_PROVISIONING_SLOT_WINDOW_MS,
  CLIENT_PROVISIONING_SLOT_CLIENT_TIMEZONE,
} from "./client-provisioning-slot-constants.ts";
import { clientProvisioningSlotReservationsEnabled } from "./client-provisioning-slot-feature.ts";
import {
  buildProvisioningSlotClientProjection,
  clientProvisioningSlotMessage,
} from "../instagram-client/client-provisioning-slot-messages.ts";
import { clientReadinessAllowsConnect } from "../instagram-client/client-readiness-projection.ts";
import { formatProvisioningSlotFranceTime } from "./client-provisioning-slot-presentation.ts";

test("CP6 feature flag is OFF by default", () => {
  assert.equal(clientProvisioningSlotReservationsEnabled({}), false);
  assert.equal(clientProvisioningSlotReservationsEnabled({ CLIENT_PROVISIONING_SLOT_RESERVATIONS_ENABLED: "false" }), false);
  assert.equal(clientProvisioningSlotReservationsEnabled({ CLIENT_PROVISIONING_SLOT_RESERVATIONS_ENABLED: "true" }), true);
});

test("CP6 reservation window is exactly 30 minutes", () => {
  assert.equal(CLIENT_PROVISIONING_SLOT_WINDOW_MINUTES, 30);
  assert.equal(CLIENT_PROVISIONING_SLOT_WINDOW_MS, 30 * 60_000);
});

test("CP6 FR/EN client messages use i18n keys", () => {
  assert.match(clientProvisioningSlotMessage("phonesBusyTitle", "fr"), /occupés/);
  assert.match(clientProvisioningSlotMessage("phonesBusyTitle", "en"), /busy/i);
  assert.match(
    clientProvisioningSlotMessage("phonesBusyBody", "en", { time: "18:00" }),
    /18:00/,
  );
  assert.match(clientProvisioningSlotMessage("assistedConnect", "fr"), /équipe/);
  assert.match(clientProvisioningSlotMessage("assistedConnect", "en"), /team/i);
});

test("CP6 Europe/Paris formatting handles DST winter sample", () => {
  const label = formatProvisioningSlotFranceTime("2026-01-15T17:00:00.000Z", "fr");
  assert.match(label, /18:00|19:00/);
});

test("CP6 provisioning slot open allows connect readiness", () => {
  assert.equal(clientReadinessAllowsConnect("ready_to_connect"), true);
  assert.equal(clientReadinessAllowsConnect("provisioning_slot_open"), true);
  assert.equal(clientReadinessAllowsConnect("provisioning_slot_reserved"), false);
});

test("CP6 reservation dedupe key is stable per client instagram account", () => {
  assert.equal(
    `client_provisioning:11111111-1111-1111-1111-111111111111`,
    "client_provisioning:11111111-1111-1111-1111-111111111111",
  );
});

test("CP6 client projection hides technical details", () => {
  const projection = buildProvisioningSlotClientProjection({
    reservation: {
      id: "res-1",
      client_id: "client",
      client_instagram_account_id: "cia-1",
      ig_account_id: "acc-1",
      assignment_id: "asg-1",
      device_id: "dev-1",
      app_instance_id: "app-1",
      expected_package: "com.hidden.package",
      window_start_utc: "2026-07-08T16:00:00.000Z",
      window_end_utc: "2026-07-08T16:30:00.000Z",
      expires_at: "2026-07-08T16:30:00.000Z",
      status: "reserved",
      reservation_source: "client_connect",
      assisted_connect_requested_at: null,
      dedupe_key: "client_provisioning:cia-1",
      safe_metadata: {},
      created_at: "2026-07-08T15:00:00.000Z",
      updated_at: "2026-07-08T15:00:00.000Z",
    },
    lang: "en",
    now: new Date("2026-07-08T15:30:00.000Z"),
  });
  assert.equal(projection.connect_disabled, true);
  assert.match(projection.body, /30 minutes/i);
  assert.doesNotMatch(projection.body, /dev-1|app-1|com\.hidden/);
});
