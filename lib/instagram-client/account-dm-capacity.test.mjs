import assert from "node:assert/strict";
import test from "node:test";
import {
  packageIncludesWelcomeDm,
  welcomeCapacityStatusLabel,
} from "./account-dm-capacity.ts";
import { projectClientDmTemplates } from "./client-dm-templates-projection.ts";

test("Growth package does not include Welcome DM", () => {
  assert.equal(packageIncludesWelcomeDm("growth"), false);
  assert.equal(packageIncludesWelcomeDm("internal_test"), false);
});

test("Pro and Premium packages include Welcome DM", () => {
  assert.equal(packageIncludesWelcomeDm("pro"), true);
  assert.equal(packageIncludesWelcomeDm("premium"), true);
  assert.equal(packageIncludesWelcomeDm("custom"), true);
});

test("Growth welcome projection stays locked with upgrade CTA", () => {
  const projection = projectClientDmTemplates({
    accountId: "acct-growth",
    username: "growth_user",
    packageCode: "growth",
    domain: {
      account_id: "acct-growth",
      welcome_service_active: false,
      outreach_service_active: false,
      welcome_entitlement_status: "Missing",
      outreach_entitlement_status: "Missing",
      welcome_enabled: false,
      outreach_enabled: false,
      welcome_message: "",
      outreach_message: "",
      welcome_template_id: "",
      outreach_template_id: "",
      welcome_template_status: "Missing",
      outreach_template_status: "Missing",
      welcome_cap_session: 0,
      welcome_cap_day: 10,
      outreach_cap_session: 0,
      outreach_cap_day: 30,
      welcome_real_send_status: "Disabled",
      outreach_real_send_status: "Disabled",
      legacy_dm_gate_status: "Not configured",
      save_ready: true,
      validation_error: null,
    },
  });
  assert.equal(projection.canConfigureWelcome, false);
  assert.equal(projection.welcome.locked, true);
  assert.match(projection.welcome.ctaPath ?? "", /change-plan\?intention=welcome_dm/);
});

test("Pro welcome projection is editable when service active from package", () => {
  const projection = projectClientDmTemplates({
    accountId: "acct-pro",
    username: "pro_user",
    packageCode: "pro",
    domain: {
      account_id: "acct-pro",
      welcome_service_active: true,
      outreach_service_active: false,
      welcome_entitlement_status: "Included",
      outreach_entitlement_status: "Missing",
      welcome_enabled: true,
      outreach_enabled: false,
      welcome_message: "Bonjour {{username}}",
      outreach_message: "",
      welcome_template_id: "tpl-1",
      outreach_template_id: "",
      welcome_template_status: "Configured",
      outreach_template_status: "Missing",
      welcome_cap_session: 10,
      welcome_cap_day: 10,
      outreach_cap_session: 0,
      outreach_cap_day: 30,
      welcome_real_send_status: "Disabled",
      outreach_real_send_status: "Disabled",
      legacy_dm_gate_status: "Not configured",
      save_ready: true,
      validation_error: null,
    },
  });
  assert.equal(projection.canConfigureWelcome, true);
  assert.equal(projection.welcome.locked, false);
  assert.equal(projection.welcomeUpgradePath, null);
});

test("Premium welcome projection is editable", () => {
  const projection = projectClientDmTemplates({
    accountId: "acct-premium",
    username: "premium_user",
    packageCode: "premium",
    domain: {
      account_id: "acct-premium",
      welcome_service_active: true,
      outreach_service_active: false,
      welcome_entitlement_status: "Included",
      outreach_entitlement_status: "Missing",
      welcome_enabled: false,
      outreach_enabled: false,
      welcome_message: "",
      outreach_message: "",
      welcome_template_id: "",
      outreach_template_id: "",
      welcome_template_status: "Missing",
      outreach_template_status: "Missing",
      welcome_cap_session: 0,
      welcome_cap_day: 10,
      outreach_cap_session: 0,
      outreach_cap_day: 30,
      welcome_real_send_status: "Disabled",
      outreach_real_send_status: "Disabled",
      legacy_dm_gate_status: "Not configured",
      save_ready: true,
      validation_error: null,
    },
  });
  assert.equal(projection.canConfigureWelcome, true);
  assert.equal(projection.welcome.locked, false);
});

test("Outreach remains locked unless outreach entitlement is active", () => {
  const projection = projectClientDmTemplates({
    accountId: "acct-pro",
    username: "pro_user",
    packageCode: "pro",
    domain: {
      account_id: "acct-pro",
      welcome_service_active: true,
      outreach_service_active: false,
      welcome_entitlement_status: "Included",
      outreach_entitlement_status: "Missing",
      welcome_enabled: true,
      outreach_enabled: false,
      welcome_message: "Hi",
      outreach_message: "",
      welcome_template_id: "tpl-1",
      outreach_template_id: "",
      welcome_template_status: "Configured",
      outreach_template_status: "Missing",
      welcome_cap_session: 10,
      welcome_cap_day: 10,
      outreach_cap_session: 0,
      outreach_cap_day: 30,
      welcome_real_send_status: "Disabled",
      outreach_real_send_status: "Disabled",
      legacy_dm_gate_status: "Not configured",
      save_ready: true,
      validation_error: null,
    },
  });
  assert.equal(projection.canConfigureWelcome, true);
  assert.equal(projection.canConfigureOutreach, false);
  assert.equal(projection.outreach.locked, true);
});

test("welcome capacity status label distinguishes entitlement vs package", () => {
  assert.equal(welcomeCapacityStatusLabel({ active: false, source: "none", packageCode: "growth" }), "Missing");
  assert.equal(welcomeCapacityStatusLabel({ active: true, source: "account_entitlement", packageCode: "pro" }), "Active");
  assert.equal(welcomeCapacityStatusLabel({ active: true, source: "account_package", packageCode: "pro" }), "Included");
});
