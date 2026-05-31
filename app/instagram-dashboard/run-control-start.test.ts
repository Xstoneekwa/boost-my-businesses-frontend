import assert from "node:assert/strict";
import test from "node:test";
import { getDmServiceAvailability, readApiResponse, runStartSuccessMessage } from "./InstagramDashboardButtons";
import { runStartSuccessPayload } from "../api/instagram-dashboard/runs/start/route";
import {
  accountSessionBlockedByWelcomeRealSendDisabled,
  evaluateDmStartGate,
  evaluateMiniRunCapsPreflight,
  evaluateUnfollowAnyStartGate,
  outreachSessionBlockedByOutreachRealSendDisabled,
  runControlOutreachRealSendEnabled,
  runControlWelcomeRealSendEnabled,
  runStartBlockMessage,
} from "../../lib/instagram-dashboard/run-control";

test("run start 401 is surfaced as an error", async () => {
  await assert.rejects(
    readApiResponse(
      new Response(JSON.stringify({ ok: false, error: "Authentication required." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
      "Could not start the run.",
    ),
    /Authentication required/,
  );
});

test("run start success without request_id is rejected by UI", () => {
  assert.throws(
    () => runStartSuccessMessage({ started: true, message: "Manual run request noted.", status: "queued" }),
    /request id/,
  );
});

test("run start success with request_id is shown as success", () => {
  const message = runStartSuccessMessage({
    started: true,
    request_id: "00000000-0000-4000-8000-000000000123",
    status: "queued",
  });
  assert.equal(message, "Run request 00000000 queued (queued).");
});

test("API start success payload includes request id and account id", () => {
  const payload = runStartSuccessPayload({
    accountId: "00000000-0000-4000-8000-000000000001",
    requestId: "00000000-0000-4000-8000-000000000002",
    requestStatus: "queued",
    requestedRunType: "account_session",
  });
  assert.equal(payload.started, true);
  assert.equal(payload.request_id, "00000000-0000-4000-8000-000000000002");
  assert.equal(payload.account_id, "00000000-0000-4000-8000-000000000001");
  assert.equal(payload.status, "queued");
});

test("API idempotent start payload returns existing request id", () => {
  const payload = runStartSuccessPayload({
    accountId: "00000000-0000-4000-8000-000000000001",
    requestId: "00000000-0000-4000-8000-000000000003",
    requestStatus: "claimed",
    requestedRunType: "account_session",
    idempotent: true,
  });
  assert.equal(payload.started, false);
  assert.equal(payload.idempotent, true);
  assert.equal(payload.request_id, "00000000-0000-4000-8000-000000000003");
});

test("DM service availability disables Growth without add-ons", () => {
  const availability = getDmServiceAvailability({
    packageLabel: "Growth",
    entitlementSummary: "follow, unfollow",
    welcomeEntitlementStatus: "Missing",
    welcomeEnabled: false,
    welcomeTemplateStatus: "Missing",
    outreachEntitlementStatus: "Missing",
    outreachEnabled: false,
    outreachTemplateStatus: "Missing",
  });

  assert.equal(availability.welcomeServiceActive, false);
  assert.equal(availability.outreachServiceActive, false);
  assert.equal(availability.welcomeDisabledReason, "not_included_in_package");
  assert.equal(availability.outreachDisabledReason, "add_on_not_active");
});

test("DM service availability allows Welcome from runtime entitlement when package is unknown", () => {
  const availability = getDmServiceAvailability({
    packageLabel: "unknown",
    entitlementSummary: "unknown",
    welcomeEntitlementStatus: "Active",
    welcomeEnabled: true,
    welcomeTemplateStatus: "Ready",
    outreachEntitlementStatus: "Missing",
    outreachEnabled: false,
    outreachTemplateStatus: "Missing",
  });

  assert.equal(availability.welcomeServiceActive, true);
  assert.equal(availability.outreachServiceActive, false);
  assert.equal(availability.welcomeDisabledReason, null);
});

test("DM service availability allows Outreach from runtime entitlement when package is unknown", () => {
  const availability = getDmServiceAvailability({
    packageLabel: "unknown",
    entitlementSummary: "unknown",
    welcomeEntitlementStatus: "Missing",
    welcomeEnabled: false,
    welcomeTemplateStatus: "Missing",
    outreachEntitlementStatus: "Active",
    outreachEnabled: true,
    outreachTemplateStatus: "Ready",
  });

  assert.equal(availability.welcomeServiceActive, false);
  assert.equal(availability.outreachServiceActive, true);
  assert.equal(availability.outreachDisabledReason, null);
});

test("DM service availability allows Welcome only", () => {
  const availability = getDmServiceAvailability({
    packageLabel: "unknown",
    entitlementSummary: "welcome",
    welcomeEntitlementStatus: "Active",
    welcomeEnabled: true,
    welcomeTemplateStatus: "Ready",
    outreachEntitlementStatus: "Missing",
    outreachEnabled: false,
    outreachTemplateStatus: "Missing",
  });

  assert.equal(availability.welcomeServiceActive, true);
  assert.equal(availability.outreachServiceActive, false);
  assert.equal(availability.welcomeDisabledReason, null);
  assert.equal(availability.outreachDisabledReason, "add_on_not_active");
});

test("DM service availability allows Outreach only", () => {
  const availability = getDmServiceAvailability({
    packageLabel: "unknown",
    entitlementSummary: "outreach",
    welcomeEntitlementStatus: "Missing",
    welcomeEnabled: false,
    welcomeTemplateStatus: "Missing",
    outreachEntitlementStatus: "Active",
    outreachEnabled: true,
    outreachTemplateStatus: "Ready",
  });

  assert.equal(availability.welcomeServiceActive, false);
  assert.equal(availability.outreachServiceActive, true);
  assert.equal(availability.welcomeDisabledReason, "not_included_in_package");
  assert.equal(availability.outreachDisabledReason, null);
});

test("DM service availability allows Welcome and Outreach together", () => {
  const availability = getDmServiceAvailability({
    packageLabel: "unknown",
    entitlementSummary: "welcome, outreach",
    welcomeEntitlementStatus: "Active",
    welcomeEnabled: true,
    welcomeTemplateStatus: "Ready",
    outreachEntitlementStatus: "Active",
    outreachEnabled: true,
    outreachTemplateStatus: "Ready",
  });

  assert.equal(availability.welcomeServiceActive, true);
  assert.equal(availability.outreachServiceActive, true);
  assert.equal(availability.welcomeDisabledReason, null);
  assert.equal(availability.outreachDisabledReason, null);
});

test("DM service availability treats package Pro and Premium only as Welcome fallback", () => {
  const proAvailability = getDmServiceAvailability({
    packageLabel: "Pro",
    entitlementSummary: "unknown",
  });
  const premiumAvailability = getDmServiceAvailability({
    packageLabel: "Premium",
    entitlementSummary: "unknown",
  });

  assert.equal(proAvailability.welcomeServiceActive, true);
  assert.equal(premiumAvailability.welcomeServiceActive, true);
});

test("DM service availability does not treat runtime profiles as commercial packages", () => {
  const availability = getDmServiceAvailability({
    packageLabel: "full_cycle outreach_only",
    entitlementSummary: "runtime profile only",
  });

  assert.equal(availability.welcomeServiceActive, false);
  assert.equal(availability.outreachServiceActive, false);
});

test("DM service availability stays conservative when domain source is pending", () => {
  const availability = getDmServiceAvailability({});

  assert.equal(availability.welcomeServiceActive, false);
  assert.equal(availability.outreachServiceActive, false);
  assert.equal(availability.welcomeDisabledReason, "domain_api_pending");
  assert.equal(availability.outreachDisabledReason, "domain_api_pending");
});

test("account_session is blocked when Welcome requires disabled real send", () => {
  assert.equal(
    accountSessionBlockedByWelcomeRealSendDisabled({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: false,
    }),
    true,
  );
  assert.equal(
    accountSessionBlockedByWelcomeRealSendDisabled({
      requestedRunType: "outreach_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: false,
    }),
    false,
  );
  assert.match(runStartBlockMessage("welcome_real_send_disabled"), /Welcome DM real send is disabled/);
});

test("dispatcher launch disabled has a safe block message", () => {
  assert.match(runStartBlockMessage("dispatcher_launch_disabled"), /dispatcher launch is disabled/);
});

test("domain real-send flags isolate Welcome from Outreach and legacy global", () => {
  const env = {
    WELCOME_DM_REAL_SEND_ENABLED: "true",
    OUTREACH_DM_REAL_SEND_ENABLED: "false",
    DM_SENDER_REAL_SEND_ENABLED: "true",
  };

  assert.equal(runControlWelcomeRealSendEnabled(env), true);
  assert.equal(runControlOutreachRealSendEnabled(env), false);
  assert.equal(
    accountSessionBlockedByWelcomeRealSendDisabled({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: runControlWelcomeRealSendEnabled(env),
    }),
    false,
  );
  assert.equal(
    outreachSessionBlockedByOutreachRealSendDisabled({
      requestedRunType: "outreach_session",
      outreachEnabled: true,
      outreachRealSendEnabled: runControlOutreachRealSendEnabled(env),
    }),
    true,
  );
  assert.match(runStartBlockMessage("outreach_real_send_disabled"), /Outreach DM real send is disabled/);
});

test("account_session DM gate blocks Welcome when template is missing", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeTemplateReady: false,
      welcomeRealSendEnabled: true,
      welcomeEffectiveCap: 1,
      outreachEnabled: false,
      outreachTemplateReady: false,
      outreachRealSendEnabled: false,
      outreachEffectiveSessionCap: null,
      outreachEffectiveDayCap: null,
      outreachEntitlementActive: false,
    }),
    "welcome_template_missing",
  );
});

test("account_session DM gate blocks Welcome when real send is off", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeTemplateReady: true,
      welcomeRealSendEnabled: false,
      welcomeEffectiveCap: 1,
      outreachEnabled: false,
      outreachTemplateReady: false,
      outreachRealSendEnabled: false,
      outreachEffectiveSessionCap: null,
      outreachEffectiveDayCap: null,
      outreachEntitlementActive: false,
    }),
    "welcome_real_send_disabled",
  );
});

test("account_session DM gate blocks Welcome when cap is unproven", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeTemplateReady: true,
      welcomeRealSendEnabled: true,
      welcomeEffectiveCap: 0,
      outreachEnabled: false,
      outreachTemplateReady: false,
      outreachRealSendEnabled: false,
      outreachEffectiveSessionCap: null,
      outreachEffectiveDayCap: null,
      outreachEntitlementActive: false,
    }),
    "welcome_cap_unproven",
  );
});

test("account_session DM gate does not require Outreach when Outreach is off", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeTemplateReady: true,
      welcomeRealSendEnabled: true,
      welcomeEffectiveCap: 1,
      outreachEnabled: false,
      outreachTemplateReady: false,
      outreachRealSendEnabled: false,
      outreachEffectiveSessionCap: null,
      outreachEffectiveDayCap: null,
      outreachEntitlementActive: false,
    }),
    null,
  );
});

test("account_session DM gate does not require Welcome when Welcome is off", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "account_session",
      welcomeEnabled: false,
      welcomeTemplateReady: false,
      welcomeRealSendEnabled: false,
      welcomeEffectiveCap: null,
      outreachEnabled: true,
      outreachTemplateReady: false,
      outreachRealSendEnabled: false,
      outreachEffectiveSessionCap: null,
      outreachEffectiveDayCap: null,
      outreachEntitlementActive: false,
    }),
    null,
  );
});

test("outreach_session DM gate blocks when Outreach entitlement is missing", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "outreach_session",
      welcomeEnabled: false,
      welcomeTemplateReady: false,
      welcomeRealSendEnabled: false,
      welcomeEffectiveCap: null,
      outreachEnabled: true,
      outreachTemplateReady: true,
      outreachRealSendEnabled: true,
      outreachEffectiveSessionCap: 1,
      outreachEffectiveDayCap: 1,
      outreachEntitlementActive: false,
    }),
    "outreach_entitlement_missing",
  );
});

test("outreach_session DM gate blocks when Outreach template is missing", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "outreach_session",
      welcomeEnabled: false,
      welcomeTemplateReady: false,
      welcomeRealSendEnabled: false,
      welcomeEffectiveCap: null,
      outreachEnabled: true,
      outreachTemplateReady: false,
      outreachRealSendEnabled: true,
      outreachEffectiveSessionCap: 1,
      outreachEffectiveDayCap: 1,
      outreachEntitlementActive: true,
    }),
    "outreach_template_missing",
  );
});

test("outreach_session DM gate blocks when Outreach real send is off", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "outreach_session",
      welcomeEnabled: false,
      welcomeTemplateReady: false,
      welcomeRealSendEnabled: false,
      welcomeEffectiveCap: null,
      outreachEnabled: true,
      outreachTemplateReady: true,
      outreachRealSendEnabled: false,
      outreachEffectiveSessionCap: 1,
      outreachEffectiveDayCap: 1,
      outreachEntitlementActive: true,
    }),
    "outreach_real_send_disabled",
  );
});

test("outreach_session DM gate does not require Welcome when Welcome is off", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "outreach_session",
      welcomeEnabled: false,
      welcomeTemplateReady: false,
      welcomeRealSendEnabled: false,
      welcomeEffectiveCap: null,
      outreachEnabled: true,
      outreachTemplateReady: true,
      outreachRealSendEnabled: true,
      outreachEffectiveSessionCap: 1,
      outreachEffectiveDayCap: 1,
      outreachEntitlementActive: true,
    }),
    null,
  );
});

test("outreach_session DM gate blocks Outreach OFF and legacy global cannot bypass it", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "outreach_session",
      welcomeEnabled: false,
      welcomeTemplateReady: false,
      welcomeRealSendEnabled: false,
      welcomeEffectiveCap: null,
      outreachEnabled: false,
      outreachTemplateReady: true,
      outreachRealSendEnabled: true,
      outreachEffectiveSessionCap: 1,
      outreachEffectiveDayCap: 1,
      outreachEntitlementActive: true,
      legacyDmSenderRealSendEnabled: true,
    }),
    "outreach_disabled",
  );
});

test("DM gate reports legacy global mismatch before domain send bypass", () => {
  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "outreach_session",
      welcomeEnabled: false,
      welcomeTemplateReady: false,
      welcomeRealSendEnabled: false,
      welcomeEffectiveCap: null,
      outreachEnabled: true,
      outreachTemplateReady: true,
      outreachRealSendEnabled: false,
      outreachEffectiveSessionCap: 1,
      outreachEffectiveDayCap: 1,
      outreachEntitlementActive: true,
      legacyDmSenderRealSendEnabled: true,
    }),
    "dm_legacy_gate_mismatch",
  );
});

test("mini-run preflight blocks when Welcome cap is not proven to be one", () => {
  assert.equal(
    evaluateMiniRunCapsPreflight({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: true,
      outreachRealSendEnabled: false,
      outreachEnabled: false,
      env: {
        INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED: "true",
        FOLLOW_MAX_PER_RUN: "1",
        FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN: "1",
        RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES: "account_session",
      },
    }),
    "mini_run_welcome_cap_unproven",
  );
});

test("mini-run preflight blocks when Follow caps are not proven to be one", () => {
  assert.equal(
    evaluateMiniRunCapsPreflight({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: true,
      outreachRealSendEnabled: false,
      outreachEnabled: false,
      env: {
        INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED: "true",
        WELCOME_SESSION_SEND_MAX_JOBS: "1",
        FOLLOW_MAX_PER_RUN: "2",
        FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN: "1",
        RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES: "account_session",
      },
    }),
    "mini_run_follow_cap_unproven",
  );
});

test("mini-run preflight blocks when Outreach isolation is not proven", () => {
  assert.equal(
    evaluateMiniRunCapsPreflight({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: true,
      outreachRealSendEnabled: true,
      outreachEnabled: true,
      env: {
        INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED: "true",
        WELCOME_SESSION_SEND_MAX_JOBS: "1",
        FOLLOW_MAX_PER_RUN: "1",
        FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN: "1",
        RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES: "account_session,outreach_session",
      },
    }),
    "mini_run_outreach_off_unproven",
  );
});

test("mini-run preflight allows account session when Outreach real send is off", () => {
  assert.equal(
    evaluateMiniRunCapsPreflight({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: true,
      outreachRealSendEnabled: false,
      outreachEnabled: true,
      env: {
        INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED: "true",
        WELCOME_SESSION_SEND_MAX_JOBS: "1",
        FOLLOW_MAX_PER_RUN: "1",
        FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN: "1",
        RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES: "account_session,outreach_session",
      },
    }),
    null,
  );
});

test("mini-run preflight allows capped account session with dispatcher isolated", () => {
  assert.equal(
    evaluateMiniRunCapsPreflight({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeRealSendEnabled: true,
      outreachRealSendEnabled: true,
      outreachEnabled: true,
      env: {
        INSTAGRAM_RUN_CONTROL_MINI_RUN_CAPS_REQUIRED: "true",
        WELCOME_SESSION_SEND_MAX_JOBS: "1",
        FOLLOW_MAX_PER_RUN: "1",
        FOLLOWERS_LIST_MAX_ITERATIONS_PER_RUN: "1",
        RUN_CONTROL_DISPATCHER_ALLOWED_RUN_TYPES: "account_session",
      },
    }),
    null,
  );
});

test("unfollow-any blocks account start when real handoff is off", () => {
  assert.equal(
    evaluateUnfollowAnyStartGate({
      requestedRunType: "account_session",
      unfollowEnabled: true,
      unfollowMode: "unfollow-any",
      unfollowPerSessionLimit: 1,
      realHandoffEnabled: false,
      realMaxActions: 1,
      realHardMax: 1,
      h3RealSupported: true,
      safeCandidateStrategyProven: true,
    }),
    "real_handoff_disabled",
  );
  assert.match(runStartBlockMessage("real_handoff_disabled"), /Unfollow real handoff is disabled/);
});

test("unfollow-any blocks account start when H3 real support is not proven", () => {
  assert.equal(
    evaluateUnfollowAnyStartGate({
      requestedRunType: "account_session",
      unfollowEnabled: true,
      unfollowMode: "unfollow-any",
      unfollowPerSessionLimit: 1,
      realHandoffEnabled: true,
      realMaxActions: 1,
      realHardMax: 1,
      h3RealSupported: false,
      safeCandidateStrategyProven: true,
    }),
    "unfollow_any_not_supported",
  );
  assert.match(runStartBlockMessage("unfollow_any_not_supported"), /not supported by the H3 real handoff path/);
});

test("unfollow-any blocks account start when cap is not proven", () => {
  assert.equal(
    evaluateUnfollowAnyStartGate({
      requestedRunType: "account_session",
      unfollowEnabled: true,
      unfollowMode: "unfollow-any",
      unfollowPerSessionLimit: 1,
      realHandoffEnabled: true,
      realMaxActions: null,
      realHardMax: 1,
      h3RealSupported: true,
      safeCandidateStrategyProven: true,
    }),
    "unfollow_cap_unproven",
  );
  assert.match(runStartBlockMessage("unfollow_cap_unproven"), /cap is not proven/);
});

test("unfollow-any blocks account start when safe strategy is not proven", () => {
  assert.equal(
    evaluateUnfollowAnyStartGate({
      requestedRunType: "account_session",
      unfollowEnabled: true,
      unfollowMode: "unfollow-any",
      unfollowPerSessionLimit: 1,
      realHandoffEnabled: true,
      realMaxActions: 1,
      realHardMax: 1,
      h3RealSupported: true,
      safeCandidateStrategyProven: false,
    }),
    "no_safe_unfollow_strategy",
  );
  assert.match(runStartBlockMessage("no_safe_unfollow_strategy"), /no safe Unfollow-any candidate strategy/);
});

test("unfollow-any ready state passes the Unfollow start gate", () => {
  assert.equal(
    evaluateUnfollowAnyStartGate({
      requestedRunType: "account_session",
      unfollowEnabled: true,
      unfollowMode: "unfollow-any",
      unfollowPerSessionLimit: 1,
      realHandoffEnabled: true,
      realMaxActions: 1,
      realHardMax: 1,
      h3RealSupported: true,
      safeCandidateStrategyProven: true,
    }),
    null,
  );
});
