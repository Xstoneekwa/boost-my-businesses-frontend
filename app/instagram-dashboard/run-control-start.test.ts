import assert from "node:assert/strict";
import test from "node:test";
import { dmClientValidationError, dmDomainPayload, getDmServiceAvailability, readApiResponse, runStartSuccessMessage } from "./InstagramDashboardButtons";
import { runStartSuccessPayload } from "../api/instagram-dashboard/runs/start/route";
import { DEFAULT_OUTREACH_DM_DAY_CAP, DEFAULT_WELCOME_DM_DAY_CAP, dmChangedFields, readProductDefaultDayCap, validateDmDomainInput, type DmDomainValidationInput } from "../api/instagram-dashboard/settings/dm/route";
import { DM_TEMPLATE_MESSAGE_MAX_CHARS, normalizeDmTemplateMessage } from "../../lib/instagram-dashboard/dm-formatting";
import {
  accountSessionBlockedByWelcomeRealSendDisabled,
  evaluateDmStartGate,
  evaluateMiniRunCapsPreflight,
  evaluateUnfollowAnyStartGate,
  outreachSessionBlockedByOutreachRealSendDisabled,
  resolveOutreachPreflightCap,
  resolveWelcomePreflightCap,
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

const baseDmDomainInput: DmDomainValidationInput = {
  welcomeServiceActive: true,
  outreachServiceActive: true,
  welcomeEnabled: true,
  outreachEnabled: true,
  welcomeMessage: "Welcome",
  outreachMessage: "Outreach",
  welcomeCapSession: 1,
  welcomeCapDay: 1,
  outreachCapSession: 1,
  outreachCapDay: 1,
};

const multilineDmTemplate = "Bonjour {{first_name}},\n\nJe voulais vous contacter rapidement.\n\nÀ bientôt";

test("DM formatting normalizes line endings without flattening paragraphs", () => {
  const raw = ` ${multilineDmTemplate.replace(/\n/g, "\r\n")} `;
  const normalized = normalizeDmTemplateMessage(raw);

  assert.equal(normalized, multilineDmTemplate);
  assert.match(normalized, /\n\nJe voulais/);
  assert.doesNotMatch(normalized, /Bonjour \{\{first_name\}\}, Je voulais/);
});

test("DM domain payload preserves Welcome and Outreach line breaks", () => {
  const payload = dmDomainPayload({
    account_id: "00000000-0000-4000-8000-000000000001",
    welcome_dm_runtime_enabled: true,
    outreach_dm_runtime_enabled: true,
    welcome_dm_message: multilineDmTemplate,
    cold_dm_message: multilineDmTemplate,
    welcome_dm_effective_cap: 1,
    welcome_dm_effective_day_cap: 10,
    outreach_dm_effective_session_cap: 1,
    outreach_dm_effective_day_cap: 1,
  });

  assert.equal(payload.welcome_message, multilineDmTemplate);
  assert.equal(payload.outreach_message, multilineDmTemplate);
  assert.equal(payload.welcome_cap_day, 10);
  assert.equal(payload.welcome_message.split("\n").length, 5);
  assert.equal(payload.outreach_message.split("\n").length, 5);
});

test("DM domain payload never falls back to legacy max_dm_per_run", () => {
  const payload = dmDomainPayload({
    account_id: "00000000-0000-4000-8000-000000000001",
    welcome_dm_runtime_enabled: true,
    welcome_dm_message: "Welcome",
    max_dm_per_run: 9,
    outreach_dm_runtime_enabled: false,
    cold_dm_message: "Outreach",
  });

  assert.equal(payload.welcome_cap_session, 0);
  assert.equal(payload.welcome_cap_day, DEFAULT_WELCOME_DM_DAY_CAP);
});

test("DM domain validation accepts multi-line templates without flattening", () => {
  assert.equal(
    validateDmDomainInput({
      ...baseDmDomainInput,
      welcomeMessage: multilineDmTemplate,
      outreachMessage: multilineDmTemplate,
    }),
    null,
  );
});

test("DM domain validation rejects too-long messages without truncating", () => {
  const tooLong = "a".repeat(DM_TEMPLATE_MESSAGE_MAX_CHARS + 1);

  assert.match(
    validateDmDomainInput({
      ...baseDmDomainInput,
      welcomeMessage: tooLong,
    }) ?? "",
    /Welcome message is too long/,
  );
  assert.equal(tooLong.length, DM_TEMPLATE_MESSAGE_MAX_CHARS + 1);
});

test("DM client validation rejects too-long messages before save", () => {
  const error = dmClientValidationError({
    account_id: "00000000-0000-4000-8000-000000000001",
    welcome_dm_runtime_enabled: true,
    outreach_dm_runtime_enabled: false,
    welcome_dm_message: "a".repeat(DM_TEMPLATE_MESSAGE_MAX_CHARS + 1),
    welcome_dm_effective_cap: 1,
  });

  assert.match(error, /Welcome message is too long/);
});

test("DM client validation rejects day caps above product max before save", () => {
  assert.match(
    dmClientValidationError({
      account_id: "00000000-0000-4000-8000-000000000001",
      welcome_dm_runtime_enabled: true,
      outreach_dm_runtime_enabled: false,
      welcome_dm_message: "Welcome",
      cold_dm_message: "Outreach",
      welcome_dm_effective_cap: 1,
      welcome_dm_effective_day_cap: 11,
    }),
    /welcome_daily_cap_exceeded/,
  );
  assert.match(
    dmClientValidationError({
      account_id: "00000000-0000-4000-8000-000000000001",
      welcome_dm_runtime_enabled: false,
      outreach_dm_runtime_enabled: true,
      welcome_dm_message: "Welcome",
      cold_dm_message: "Outreach",
      outreach_dm_effective_session_cap: 1,
      outreach_dm_effective_day_cap: 31,
    }),
    /outreach_daily_cap_exceeded/,
  );
});

test("DM client validation rejects session caps above day caps before save", () => {
  assert.match(
    dmClientValidationError({
      account_id: "00000000-0000-4000-8000-000000000001",
      welcome_dm_runtime_enabled: true,
      outreach_dm_runtime_enabled: false,
      welcome_dm_message: "Welcome",
      welcome_dm_effective_cap: 6,
      welcome_dm_effective_day_cap: 5,
    }),
    /session_cap_exceeds_day_cap/,
  );
  assert.match(
    dmClientValidationError({
      account_id: "00000000-0000-4000-8000-000000000001",
      welcome_dm_runtime_enabled: false,
      outreach_dm_runtime_enabled: true,
      cold_dm_message: "Outreach",
      outreach_dm_effective_session_cap: 21,
      outreach_dm_effective_day_cap: 20,
    }),
    /session_cap_exceeds_day_cap/,
  );
});

test("DM domain validation blocks Outreach writes when entitlement is missing", () => {
  assert.equal(
    validateDmDomainInput({
      ...baseDmDomainInput,
      outreachServiceActive: false,
      outreachEnabled: true,
    }),
    "Outreach service is not active for this account.",
  );
});

test("DM domain validation keeps Welcome independent from Outreach", () => {
  assert.equal(
    validateDmDomainInput({
      ...baseDmDomainInput,
      outreachServiceActive: false,
      outreachEnabled: false,
    }),
    null,
  );
});

test("DM domain validation enforces Welcome daily cap defaults", () => {
  assert.equal(DEFAULT_WELCOME_DM_DAY_CAP, 10);
  assert.equal(validateDmDomainInput({ ...baseDmDomainInput, welcomeCapDay: 5 }), null);
  assert.equal(validateDmDomainInput({ ...baseDmDomainInput, welcomeCapDay: 10 }), null);
  assert.match(validateDmDomainInput({ ...baseDmDomainInput, welcomeCapDay: 11 }) ?? "", /welcome_daily_cap_exceeded/);
});

test("DM domain validation enforces Outreach daily cap defaults", () => {
  assert.equal(DEFAULT_OUTREACH_DM_DAY_CAP, 30);
  assert.equal(validateDmDomainInput({ ...baseDmDomainInput, outreachCapDay: 20 }), null);
  assert.equal(validateDmDomainInput({ ...baseDmDomainInput, outreachCapDay: 30 }), null);
  assert.match(validateDmDomainInput({ ...baseDmDomainInput, outreachCapDay: 31 }) ?? "", /outreach_daily_cap_exceeded/);
});

test("DM day cap projection shows real DB values and only defaults missing values", () => {
  assert.equal(readProductDefaultDayCap(null, DEFAULT_WELCOME_DM_DAY_CAP), 10);
  assert.equal(readProductDefaultDayCap(5, DEFAULT_WELCOME_DM_DAY_CAP), 5);
  assert.equal(readProductDefaultDayCap(50, DEFAULT_WELCOME_DM_DAY_CAP), 50);
  assert.equal(readProductDefaultDayCap(null, DEFAULT_OUTREACH_DM_DAY_CAP), 30);
  assert.equal(readProductDefaultDayCap(20, DEFAULT_OUTREACH_DM_DAY_CAP), 20);
  assert.equal(readProductDefaultDayCap(45, DEFAULT_OUTREACH_DM_DAY_CAP), 45);
});

test("DM domain validation rejects session caps above day caps", () => {
  assert.match(
    validateDmDomainInput({ ...baseDmDomainInput, welcomeCapSession: 6, welcomeCapDay: 5 }) ?? "",
    /session_cap_exceeds_day_cap/,
  );
  assert.match(
    validateDmDomainInput({ ...baseDmDomainInput, outreachCapSession: 21, outreachCapDay: 20 }) ?? "",
    /session_cap_exceeds_day_cap/,
  );
});

test("DM domain validation keeps Outreach independent from Welcome", () => {
  assert.equal(
    validateDmDomainInput({
      ...baseDmDomainInput,
      welcomeServiceActive: false,
      welcomeEnabled: false,
    }),
    null,
  );
});

test("DM domain validation blocks empty required templates", () => {
  assert.match(
    validateDmDomainInput({
      ...baseDmDomainInput,
      welcomeMessage: "   ",
    }) ?? "",
    /Template message is required/,
  );
  assert.match(
    validateDmDomainInput({
      ...baseDmDomainInput,
      outreachMessage: "",
    }) ?? "",
    /Template message is required/,
  );
});

test("DM domain changed fields only include domain source changes", () => {
  assert.deepEqual(
    dmChangedFields(baseDmDomainInput, {
      ...baseDmDomainInput,
      welcomeEnabled: false,
      outreachMessage: "New outreach",
      outreachCapDay: 2,
    }),
    ["welcome_enabled", "outreach_template_body", "outreach_per_day_limit"],
  );
  assert.deepEqual(dmChangedFields(baseDmDomainInput, baseDmDomainInput), []);
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

test("Welcome preflight cap uses package default day cap and remaining quota", () => {
  const cap = resolveWelcomePreflightCap({
    sessionCap: 5,
    dayCap: null,
    welcomeSentToday: 9,
    totalDayCap: 100,
    totalDmSentToday: 9,
  });

  assert.equal(cap.effectiveDayCap, DEFAULT_WELCOME_DM_DAY_CAP);
  assert.equal(cap.effectiveCap, 1);
  assert.equal(cap.dailyCapExceeded, false);
});

test("account_session DM gate blocks when Welcome remaining quota is zero", () => {
  const cap = resolveWelcomePreflightCap({
    sessionCap: 5,
    dayCap: 10,
    welcomeSentToday: 10,
    totalDayCap: 100,
    totalDmSentToday: 10,
  });

  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeTemplateReady: true,
      welcomeRealSendEnabled: true,
      welcomeEffectiveCap: cap.effectiveCap,
      welcomeDailyCapExceeded: cap.dailyCapExceeded,
      welcomeSessionCapExceedsDayCap: cap.sessionCapExceedsDayCap,
      outreachEnabled: false,
      outreachTemplateReady: false,
      outreachRealSendEnabled: false,
      outreachEffectiveSessionCap: null,
      outreachEffectiveDayCap: null,
      outreachEntitlementActive: false,
    }),
    "welcome_daily_cap_exceeded",
  );
});

test("account_session DM gate blocks when DB Welcome day cap exceeds product max", () => {
  const cap = resolveWelcomePreflightCap({
    sessionCap: 10,
    dayCap: 50,
    welcomeSentToday: 0,
    totalDayCap: 100,
    totalDmSentToday: 0,
  });

  assert.equal(
    evaluateDmStartGate({
      requestedRunType: "account_session",
      welcomeEnabled: true,
      welcomeTemplateReady: true,
      welcomeRealSendEnabled: true,
      welcomeEffectiveCap: cap.effectiveCap,
      welcomeDayCapExceedsProductMax: cap.dayCapExceedsProductMax,
      welcomeSessionCapExceedsDayCap: cap.sessionCapExceedsDayCap,
      outreachEnabled: false,
      outreachTemplateReady: false,
      outreachRealSendEnabled: false,
      outreachEffectiveSessionCap: null,
      outreachEffectiveDayCap: null,
      outreachEntitlementActive: false,
    }),
    "welcome_daily_cap_exceeded",
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

test("Outreach preflight cap uses package default day cap and remaining quota", () => {
  const cap = resolveOutreachPreflightCap({
    sessionCap: 5,
    dayCap: null,
    outreachSentToday: 29,
    totalDayCap: 100,
    totalDmSentToday: 29,
  });

  assert.equal(cap.effectiveDayCap, DEFAULT_OUTREACH_DM_DAY_CAP);
  assert.equal(cap.effectiveCap, 1);
  assert.equal(cap.dailyCapExceeded, false);
});

test("outreach_session DM gate blocks when effective Outreach remaining quota is zero", () => {
  const cap = resolveOutreachPreflightCap({
    sessionCap: 5,
    dayCap: 30,
    outreachSentToday: 30,
    totalDayCap: 100,
    totalDmSentToday: 30,
  });

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
      outreachEffectiveSessionCap: cap.effectiveCap,
      outreachEffectiveDayCap: cap.effectiveDayCap,
      outreachDailyCapExceeded: cap.dailyCapExceeded,
      outreachSessionCapExceedsDayCap: cap.sessionCapExceedsDayCap,
      outreachEntitlementActive: true,
    }),
    "outreach_daily_cap_exceeded",
  );
});

test("outreach_session DM gate blocks when DB Outreach day cap exceeds product max", () => {
  const cap = resolveOutreachPreflightCap({
    sessionCap: 5,
    dayCap: 45,
    outreachSentToday: 0,
    totalDayCap: 100,
    totalDmSentToday: 0,
  });

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
      outreachEffectiveSessionCap: cap.effectiveCap,
      outreachEffectiveDayCap: cap.effectiveDayCap,
      outreachDayCapExceedsProductMax: cap.dayCapExceedsProductMax,
      outreachSessionCapExceedsDayCap: cap.sessionCapExceedsDayCap,
      outreachEntitlementActive: true,
    }),
    "outreach_daily_cap_exceeded",
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
