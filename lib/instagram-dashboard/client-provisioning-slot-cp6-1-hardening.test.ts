import assert from "node:assert/strict";
import test from "node:test";

import {
  CP6_TEST_IDS,
  createCp6IntegrationSupabase,
  createInMemoryProvisioningReservationStore,
  tstzRangeHalfOpenOverlap,
} from "./cp6-integration-test-harness.ts";
import { evaluatePhoneIdleForClientConnect } from "./evaluate-phone-idle-for-client-connect.ts";
import { findNextSafeProvisioningSlot } from "./provisioning-slot-scheduler.ts";
import {
  expireProvisioningSlotReservations,
  reserveOrReturnProvisioningSlot,
} from "./client-provisioning-slot-reservations.ts";
import { startAssistedAutoLoginFromReservation } from "./start-assisted-auto-login.ts";
import { clientProvisioningSlotReservationsEnabled } from "./client-provisioning-slot-feature.ts";

const WINDOW_START = "2026-07-08T16:00:00.000Z";
const WINDOW_END = "2026-07-08T16:30:00.000Z";
const NOW_BEFORE_WINDOW = new Date("2026-07-08T15:00:00.000Z");
const NOW_IN_WINDOW = new Date("2026-07-08T16:05:00.000Z");
const NOW_AFTER_WINDOW = new Date("2026-07-08T17:00:00.000Z");

function reserveBaseArgs(clientInstagramAccountId: string, igAccountId: string, deviceId: string, appInstanceId: string) {
  return {
    clientId: CP6_TEST_IDS.clientId,
    igAccountId,
    assignmentId: igAccountId === CP6_TEST_IDS.accountA ? CP6_TEST_IDS.assignmentA : CP6_TEST_IDS.assignmentB,
    deviceId,
    appInstanceId,
    now: NOW_BEFORE_WINDOW,
    clientInstagramAccountId,
  };
}

function openReservationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "reservation-open-1",
    client_id: CP6_TEST_IDS.clientId,
    client_instagram_account_id: CP6_TEST_IDS.clientInstagramA,
    ig_account_id: CP6_TEST_IDS.accountA,
    assignment_id: CP6_TEST_IDS.assignmentA,
    device_id: CP6_TEST_IDS.deviceA,
    app_instance_id: CP6_TEST_IDS.appX,
    expected_package: CP6_TEST_IDS.packageX,
    window_start_utc: WINDOW_START,
    window_end_utc: WINDOW_END,
    expires_at: WINDOW_END,
    status: "window_open",
    reservation_source: "client_connect",
    assisted_connect_requested_at: null,
    dedupe_key: `client_provisioning:${CP6_TEST_IDS.clientInstagramA}`,
    safe_metadata: {},
    created_at: "2026-07-08T15:30:00.000Z",
    updated_at: "2026-07-08T16:00:00.000Z",
    ...overrides,
  };
}

// =============================================================================
// A — DB concurrency (in-memory store mirrors GIST exclusion + RPC semantics)
// =============================================================================

test("CP6.1 GIST half-open overlap detects same-device conflicting windows", () => {
  assert.equal(
    tstzRangeHalfOpenOverlap(WINDOW_START, WINDOW_END, "2026-07-08T16:15:00.000Z", "2026-07-08T16:45:00.000Z"),
    true,
  );
  assert.equal(
    tstzRangeHalfOpenOverlap(WINDOW_START, WINDOW_END, WINDOW_END, "2026-07-08T17:00:00.000Z"),
    false,
  );
});

test("CP6.1 concurrent same-device reservation allows only one winner", async () => {
  const store = createInMemoryProvisioningReservationStore(NOW_BEFORE_WINDOW);
  const commonArgs = {
    p_client_id: CP6_TEST_IDS.clientId,
    p_assignment_id: CP6_TEST_IDS.assignmentA,
    p_device_id: CP6_TEST_IDS.deviceA,
    p_app_instance_id: CP6_TEST_IDS.appX,
    p_expected_package: CP6_TEST_IDS.packageX,
    p_window_start_utc: WINDOW_START,
    p_reservation_source: "client_connect",
    p_safe_metadata: { source: "test" },
  };

  const first = store.reserve({
    ...commonArgs,
    p_client_instagram_account_id: CP6_TEST_IDS.clientInstagramA,
    p_ig_account_id: CP6_TEST_IDS.accountA,
    p_dedupe_key: `client_provisioning:${CP6_TEST_IDS.clientInstagramA}`,
  });
  assert.equal(first.error, null);
  assert.ok(first.data);

  const second = store.reserve({
    ...commonArgs,
    p_client_instagram_account_id: CP6_TEST_IDS.clientInstagramB,
    p_ig_account_id: CP6_TEST_IDS.accountB,
    p_dedupe_key: `client_provisioning:${CP6_TEST_IDS.clientInstagramB}`,
  });
  assert.equal(second.error?.message, "provisioning_slot_device_overlap");
  assert.equal(store.rows.filter((row) => row.status !== "expired").length, 1);
});

test("CP6.1 two clients on two phones can reserve in parallel", async () => {
  const harnessA = createCp6IntegrationSupabase({ now: NOW_BEFORE_WINDOW });
  const harnessB = createCp6IntegrationSupabase({ now: NOW_BEFORE_WINDOW });

  const first = await reserveOrReturnProvisioningSlot(harnessA.supabase, {
    clientId: CP6_TEST_IDS.clientId,
    igAccountId: CP6_TEST_IDS.accountA,
    assignmentId: CP6_TEST_IDS.assignmentA,
    deviceId: CP6_TEST_IDS.deviceA,
    appInstanceId: CP6_TEST_IDS.appX,
    now: NOW_BEFORE_WINDOW,
  });
  const second = await reserveOrReturnProvisioningSlot(harnessB.supabase, {
    clientId: CP6_TEST_IDS.clientId,
    igAccountId: CP6_TEST_IDS.accountB,
    assignmentId: CP6_TEST_IDS.assignmentB,
    deviceId: CP6_TEST_IDS.deviceB,
    appInstanceId: CP6_TEST_IDS.appY,
    now: NOW_BEFORE_WINDOW,
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.notEqual(first.reservation.device_id, second.reservation.device_id);
  }
});

test("CP6.1 same client reconnect returns the same reservation idempotently", async () => {
  const harness = createCp6IntegrationSupabase({ now: NOW_BEFORE_WINDOW });
  const input = {
    clientId: CP6_TEST_IDS.clientId,
    igAccountId: CP6_TEST_IDS.accountA,
    assignmentId: CP6_TEST_IDS.assignmentA,
    deviceId: CP6_TEST_IDS.deviceA,
    appInstanceId: CP6_TEST_IDS.appX,
    now: NOW_BEFORE_WINDOW,
  };
  const first = await reserveOrReturnProvisioningSlot(harness.supabase, input);
  const second = await reserveOrReturnProvisioningSlot(harness.supabase, input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.equal(first.reservation.id, second.reservation.id);
    assert.equal(second.idempotent, true);
    assert.equal(harness.reservationStore.rows.length, 1);
  }
});

test("CP6.1 expired reservation releases capacity for a new booking", async () => {
  const harness = createCp6IntegrationSupabase({ now: NOW_AFTER_WINDOW });
  harness.reservationStore.rows.push({
    id: "expired-candidate",
    created_at: "2026-07-08T15:00:00.000Z",
    updated_at: "2026-07-08T17:00:00.000Z",
    client_id: CP6_TEST_IDS.clientId,
    client_instagram_account_id: CP6_TEST_IDS.clientInstagramA,
    ig_account_id: CP6_TEST_IDS.accountA,
    assignment_id: CP6_TEST_IDS.assignmentA,
    device_id: CP6_TEST_IDS.deviceA,
    app_instance_id: CP6_TEST_IDS.appX,
    expected_package: CP6_TEST_IDS.packageX,
    window_start_utc: WINDOW_START,
    window_end_utc: WINDOW_END,
    expires_at: WINDOW_END,
    status: "reserved",
    reservation_source: "client_connect",
    assisted_connect_requested_at: null,
    dedupe_key: `client_provisioning:${CP6_TEST_IDS.clientInstagramA}`,
    safe_metadata: {},
  });

  await expireProvisioningSlotReservations(harness.supabase, NOW_AFTER_WINDOW);
  assert.equal(harness.reservationStore.rows[0]?.status, "expired");

  const next = await reserveOrReturnProvisioningSlot(harness.supabase, {
    clientId: CP6_TEST_IDS.clientId,
    igAccountId: CP6_TEST_IDS.accountA,
    assignmentId: CP6_TEST_IDS.assignmentA,
    deviceId: CP6_TEST_IDS.deviceA,
    appInstanceId: CP6_TEST_IDS.appX,
    now: NOW_AFTER_WINDOW,
  });
  assert.equal(next.ok, true);
  if (next.ok) {
    assert.notEqual(next.reservation.id, "expired-candidate");
    assert.equal(next.idempotent, false);
  }
});

// =============================================================================
// B — CP4 / CP5 blocking
// =============================================================================

test("CP6.1 preflight running blocks provisioning slot scan", async () => {
  const harness = createCp6IntegrationSupabase({
    now: NOW_BEFORE_WINDOW,
    tables: {
      scheduled_session_preflights: [{
        account_id: CP6_TEST_IDS.accountA,
        device_id: CP6_TEST_IDS.deviceA,
        status: "preflight_running",
        scheduled_session_start: "2026-07-08T15:00:00.000Z",
        scheduled_session_end: "2026-07-08T15:30:00.000Z",
      }],
    },
  });
  const slot = await findNextSafeProvisioningSlot(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    assignmentId: CP6_TEST_IDS.assignmentA,
    deviceId: CP6_TEST_IDS.deviceA,
    appInstanceId: CP6_TEST_IDS.appX,
    now: NOW_BEFORE_WINDOW,
  });
  assert.equal(slot.ok, false);
  if (!slot.ok) assert.equal(slot.reason, "no_safe_provisioning_slot_within_horizon");
});

test("CP6.1 preflight ready blocks overlapping provisioning slot", async () => {
  const harness = createCp6IntegrationSupabase({
    now: NOW_BEFORE_WINDOW,
    tables: {
      scheduled_session_preflights: [{
        account_id: CP6_TEST_IDS.accountA,
        device_id: CP6_TEST_IDS.deviceA,
        status: "preflight_ready",
        scheduled_session_start: "2026-07-08T16:10:00.000Z",
        scheduled_session_end: "2026-07-08T16:40:00.000Z",
      }],
    },
  });
  const evaluation = await evaluatePhoneIdleForClientConnect(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    assignmentId: CP6_TEST_IDS.assignmentA,
    deviceId: CP6_TEST_IDS.deviceA,
    appInstanceId: CP6_TEST_IDS.appX,
    now: NOW_BEFORE_WINDOW,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  });
  assert.equal(evaluation.idle, false);
  assert.ok(evaluation.blockers.includes("preflight_window_conflict"));
});

test("CP6.1 buffer T-10 blocks instant Start Auto Login evaluation", async () => {
  const harness = createCp6IntegrationSupabase({
    now: new Date("2026-07-08T16:12:00.000Z"),
    tables: {
      account_assignments: [{
        id: CP6_TEST_IDS.assignmentA,
        account_id: CP6_TEST_IDS.accountA,
        device_id: CP6_TEST_IDS.deviceA,
        app_instance_id: CP6_TEST_IDS.appX,
        starts_at: "2026-07-08T16:00:00.000Z",
        ends_at: "2026-07-08T16:20:00.000Z",
        status: "active",
      }],
    },
  });
  const evaluation = await evaluatePhoneIdleForClientConnect(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    assignmentId: CP6_TEST_IDS.assignmentA,
    deviceId: CP6_TEST_IDS.deviceA,
    appInstanceId: CP6_TEST_IDS.appX,
    now: new Date("2026-07-08T16:12:00.000Z"),
  });
  assert.equal(evaluation.idle, false);
  assert.ok(
    evaluation.blockers.includes("scheduler_session_active")
    || evaluation.blockers.includes("scheduler_window_conflict"),
  );
});

test("CP6.1 active scheduler session blocks phone idle", async () => {
  const harness = createCp6IntegrationSupabase({
    now: new Date("2026-07-08T16:05:00.000Z"),
    tables: {
      account_assignments: [{
        id: CP6_TEST_IDS.assignmentA,
        account_id: CP6_TEST_IDS.accountA,
        device_id: CP6_TEST_IDS.deviceA,
        app_instance_id: CP6_TEST_IDS.appX,
        starts_at: "2026-07-08T16:00:00.000Z",
        ends_at: "2026-07-08T16:30:00.000Z",
        status: "active",
      }],
    },
  });
  const evaluation = await evaluatePhoneIdleForClientConnect(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    assignmentId: CP6_TEST_IDS.assignmentA,
    deviceId: CP6_TEST_IDS.deviceA,
    appInstanceId: CP6_TEST_IDS.appX,
    now: new Date("2026-07-08T16:05:00.000Z"),
  });
  assert.equal(evaluation.idle, false);
  assert.ok(evaluation.blockers.includes("scheduler_session_active"));
});

test("CP6.1 active run/request blocks phone idle", async () => {
  const harness = createCp6IntegrationSupabase({
    now: NOW_IN_WINDOW,
    tables: {
      account_run_requests: [{
        id: "req-peer",
        account_id: CP6_TEST_IDS.accountB,
        status: "running",
        requested_run_type: "full_cycle",
      }],
      account_assignments: [
        {
          id: CP6_TEST_IDS.assignmentA,
          account_id: CP6_TEST_IDS.accountA,
          device_id: CP6_TEST_IDS.deviceA,
          app_instance_id: CP6_TEST_IDS.appX,
          starts_at: "2026-07-08T14:00:00.000Z",
          ends_at: "2026-07-08T22:00:00.000Z",
          status: "active",
        },
        {
          id: CP6_TEST_IDS.assignmentB,
          account_id: CP6_TEST_IDS.accountB,
          device_id: CP6_TEST_IDS.deviceA,
          app_instance_id: CP6_TEST_IDS.appY,
          starts_at: "2026-07-08T14:00:00.000Z",
          ends_at: "2026-07-08T22:00:00.000Z",
          status: "active",
        },
      ],
      phone_app_instances: [
        {
          id: CP6_TEST_IDS.appX,
          device_id: CP6_TEST_IDS.deviceA,
          status: "available",
          usable_for_auto_login: true,
          is_launchable: true,
          package_name: CP6_TEST_IDS.packageX,
        },
        {
          id: CP6_TEST_IDS.appY,
          device_id: CP6_TEST_IDS.deviceA,
          status: "available",
          usable_for_auto_login: true,
          is_launchable: true,
          package_name: CP6_TEST_IDS.packageX,
        },
      ],
    },
  });
  const evaluation = await evaluatePhoneIdleForClientConnect(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    assignmentId: CP6_TEST_IDS.assignmentA,
    deviceId: CP6_TEST_IDS.deviceA,
    appInstanceId: CP6_TEST_IDS.appX,
    now: NOW_IN_WINDOW,
  });
  assert.equal(evaluation.idle, false);
  assert.equal(evaluation.reason, "skipped_phone_busy");
});

test("CP6.1 active CP3 lease blocks phone idle", async () => {
  const harness = createCp6IntegrationSupabase({
    now: NOW_IN_WINDOW,
    tables: {
      auto_restart_device_locks: [{
        device_id: CP6_TEST_IDS.deviceA,
        worker_id: "worker-1",
        account_id: CP6_TEST_IDS.accountB,
        app_instance_id: CP6_TEST_IDS.appY,
        request_id: "req-lease",
        reason: "manual_run",
        lease_expires_at: "2026-07-08T18:00:00.000Z",
      }],
    },
  });
  const evaluation = await evaluatePhoneIdleForClientConnect(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    assignmentId: CP6_TEST_IDS.assignmentA,
    deviceId: CP6_TEST_IDS.deviceA,
    appInstanceId: CP6_TEST_IDS.appX,
    now: NOW_IN_WINDOW,
  });
  assert.equal(evaluation.idle, false);
  assert.ok(evaluation.blockers.includes("device_lease_unavailable"));
});

test("CP6.1 operator stop suppression blocks Start Auto Login", async () => {
  const harness = createCp6IntegrationSupabase({
    now: NOW_IN_WINDOW,
    tables: {
      client_provisioning_slot_reservations: [openReservationRow()],
      operator_stop_suppressions: [{
        id: "sup-1",
        account_id: CP6_TEST_IDS.accountA,
        assignment_id: CP6_TEST_IDS.assignmentA,
        scheduled_window_start: "2026-07-08T14:00:00.000Z",
        scheduled_window_end: "2026-07-08T22:00:00.000Z",
        request_id: "req-stop",
        run_id: "run-stop",
        status: "active",
        reason_code: "operator_stop_suppressed",
        suppressed_at: "2026-07-08T15:30:00.000Z",
        expires_at: "2026-07-08T22:00:00.000Z",
        metadata_safe: {},
      }],
    },
  });
  harness.reservationStore.rows.push(openReservationRow() as never);

  const result = await startAssistedAutoLoginFromReservation(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    reservationId: "reservation-open-1",
    now: NOW_IN_WINDOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "stop_cleanup_in_progress");
    assert.equal(harness.createdRequests.length, 0);
  }
});

// =============================================================================
// C — Start Auto Login E2E (backend-controlled, no Android)
// =============================================================================

test("CP6.1 Start Auto Login succeeds on exact reserved phone and clone", async () => {
  const harness = createCp6IntegrationSupabase({
    now: NOW_IN_WINDOW,
    tables: {
      client_provisioning_slot_reservations: [openReservationRow()],
      account_dashboard_actions: [
        {
          account_id: CP6_TEST_IDS.accountA,
          status: "pending_verification",
          blocking_campaign: true,
          action_type: "submit_instagram_credentials",
        },
        {
          id: "action-1",
          account_id: CP6_TEST_IDS.accountA,
          action_type: "client_assisted_login_requested",
          metadata: { reservation_id: "reservation-open-1" },
        },
      ],
    },
  });
  harness.reservationStore.rows.push(openReservationRow() as never);

  const result = await startAssistedAutoLoginFromReservation(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    reservationId: "reservation-open-1",
    actionId: "action-1",
    actorId: "operator-1",
    now: NOW_IN_WINDOW,
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(harness.createdRequests.length, 1);
    const enqueueCall = harness.rpcCalls.find((call) => call.name === "create_account_run_request");
    assert.ok(enqueueCall);
    const leaseCall = harness.rpcCalls.find((call) => call.name === "auto_restart_acquire_device_lock");
    assert.ok(leaseCall);
    assert.equal(leaseCall?.args.p_device_id, CP6_TEST_IDS.deviceA);
    assert.equal(leaseCall?.args.p_app_instance_id, CP6_TEST_IDS.appX);
    assert.equal(result.reservation?.status, "consumed");
    assert.equal(
      harness.rpcCalls.some((call) => call.args?.p_device_id === CP6_TEST_IDS.deviceB),
      false,
    );
  }
});

test("CP6.1 Start Auto Login refuses when phone is busy and keeps reservation", async () => {
  const harness = createCp6IntegrationSupabase({
    now: NOW_IN_WINDOW,
    tables: {
      client_provisioning_slot_reservations: [openReservationRow()],
      account_run_requests: [{
        id: "req-busy",
        account_id: CP6_TEST_IDS.accountB,
        status: "running",
        requested_run_type: "full_cycle",
      }],
      account_assignments: [
        {
          id: CP6_TEST_IDS.assignmentA,
          account_id: CP6_TEST_IDS.accountA,
          device_id: CP6_TEST_IDS.deviceA,
          app_instance_id: CP6_TEST_IDS.appX,
          starts_at: "2026-07-08T14:00:00.000Z",
          ends_at: "2026-07-08T22:00:00.000Z",
          status: "active",
        },
        {
          id: CP6_TEST_IDS.assignmentB,
          account_id: CP6_TEST_IDS.accountB,
          device_id: CP6_TEST_IDS.deviceA,
          app_instance_id: CP6_TEST_IDS.appY,
          starts_at: "2026-07-08T14:00:00.000Z",
          ends_at: "2026-07-08T22:00:00.000Z",
          status: "active",
        },
      ],
      phone_app_instances: [
        {
          id: CP6_TEST_IDS.appX,
          device_id: CP6_TEST_IDS.deviceA,
          status: "available",
          usable_for_auto_login: true,
          is_launchable: true,
          package_name: CP6_TEST_IDS.packageX,
        },
        {
          id: CP6_TEST_IDS.appY,
          device_id: CP6_TEST_IDS.deviceA,
          status: "available",
          usable_for_auto_login: true,
          is_launchable: true,
          package_name: CP6_TEST_IDS.packageX,
        },
      ],
    },
  });
  harness.reservationStore.rows.push(openReservationRow() as never);

  const result = await startAssistedAutoLoginFromReservation(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    reservationId: "reservation-open-1",
    now: NOW_IN_WINDOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "skipped_phone_busy");
    assert.equal(harness.createdRequests.length, 0);
    assert.equal(harness.reservationStore.rows[0]?.status, "window_open");
  }
});

test("CP6.1 Start Auto Login refuses clone mismatch against current assignment", async () => {
  const harness = createCp6IntegrationSupabase({
    now: NOW_IN_WINDOW,
    tables: {
      client_provisioning_slot_reservations: [openReservationRow()],
      account_assignments: [{
        id: CP6_TEST_IDS.assignmentA,
        account_id: CP6_TEST_IDS.accountA,
        device_id: CP6_TEST_IDS.deviceA,
        app_instance_id: CP6_TEST_IDS.appY,
        starts_at: "2026-07-08T14:00:00.000Z",
        ends_at: "2026-07-08T22:00:00.000Z",
        status: "active",
      }],
    },
  });
  harness.reservationStore.rows.push(openReservationRow() as never);

  const result = await startAssistedAutoLoginFromReservation(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    reservationId: "reservation-open-1",
    now: NOW_IN_WINDOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "provisioning_reservation_resource_mismatch");
    assert.equal(harness.createdRequests.length, 0);
  }
});

test("CP6.1 Start Auto Login refuses expired reservation", async () => {
  const harness = createCp6IntegrationSupabase({
    now: NOW_AFTER_WINDOW,
    tables: {
      client_provisioning_slot_reservations: [openReservationRow({ status: "expired" })],
    },
  });
  harness.reservationStore.rows.push(openReservationRow({ status: "expired" }) as never);

  const result = await startAssistedAutoLoginFromReservation(harness.supabase, {
    accountId: CP6_TEST_IDS.accountA,
    reservationId: "reservation-open-1",
    now: NOW_AFTER_WINDOW,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "provisioning_reservation_not_active");
    assert.equal(harness.createdRequests.length, 0);
  }
});

test("CP6.1 feature flag remains OFF by default after hardening", () => {
  assert.equal(clientProvisioningSlotReservationsEnabled({}), false);
});
