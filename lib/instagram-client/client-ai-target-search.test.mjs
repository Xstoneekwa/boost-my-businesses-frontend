import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isClientAiTargetingEnabled } from "./ai-targeting-gate.ts";
import {
  evaluateAiTargetEligibility,
  hasIneligibleAiTargetSelection,
} from "./target-ai-eligibility.ts";
import { sanitizeTargetAiSuggestedUsernames } from "./target-ai-contract.ts";
import { readTargetAiConfigStatus } from "./target-ai-config.ts";
import { targetAiErrorMessage } from "./target-ai-errors.ts";
import { buildOpenStreetMapEmbedUrl } from "../geocoding/osm-embed.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("AI targeting gate keeps Growth disabled and Pro/Premium enabled", () => {
  assert.equal(isClientAiTargetingEnabled("growth"), false);
  assert.equal(isClientAiTargetingEnabled("pro"), true);
  assert.equal(isClientAiTargetingEnabled("premium"), true);
  assert.equal(isClientAiTargetingEnabled("internal_test"), false);
});

test("Growth drawer shows disabled upgrade CTA and does not open wizard", () => {
  const drawerSource = source("../../app/instagram-client/ClientAccountTargetsDrawer.tsx");
  assert.match(drawerSource, /cd-dwr-import-upgrade/);
  assert.match(drawerSource, /aria-disabled="true"/);
  assert.match(drawerSource, /if \(!aiEnabled\) return/);
  assert.match(drawerSource, /setAiWizardOpen\(true\)/);
});

test("drawer AI button opens wizard for eligible plans only", () => {
  const drawerSource = source("../../app/instagram-client/ClientAccountTargetsDrawer.tsx");
  assert.match(drawerSource, /ClientAiTargetSearchWizard/);
  assert.match(drawerSource, /clientAiTargetingButtonLabel/);
  assert.match(drawerSource, /clientAiTargetingUpgradeLabel/);
  assert.doesNotMatch(drawerSource, /clientAiTargetingComingSoonMessage/);
});

test("AI wizard blocks step 1 continue when niche is empty", () => {
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  assert.match(wizardSource, /disabled=\{niche\.trim\(\)\.length < 2\}/);
});

test("AI wizard removes help link and maps typed server errors", () => {
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  assert.doesNotMatch(wizardSource, /Comment choisir mes comptes cibles/);
  assert.doesNotMatch(wizardSource, /How to choose target accounts/);
  assert.doesNotMatch(wizardSource, /cd-ai-help/);
  assert.match(wizardSource, /TargetAiRequestError/);
  assert.match(wizardSource, /error_code/);
  assert.match(wizardSource, /no_candidates_found/);
});

test("package resolver prefers account_package_summary and pro priority", () => {
  const resolverSource = source("./resolve-account-package-code.ts");
  assert.match(resolverSource, /account_package_summary/);
  assert.match(resolverSource, /pro: 80/);
  assert.match(resolverSource, /internal_test: 10/);
});

test("AI route auth returns typed error codes instead of generic plan message", () => {
  const authSource = source("./target-ai-route-auth.ts");
  assert.match(authSource, /error_code/);
  assert.match(authSource, /plan_not_allowed/);
  assert.match(authSource, /readTargetAiConfigStatus/);
  assert.match(authSource, /configStatus/);
  assert.match(authSource, /resolveAccountPackageCode/);
  const routeSource = source("../../app/api/instagram-client/accounts/[accountId]/targets/ai-search/route.ts");
  assert.match(routeSource, /authorizeClientTargetAiRoute/);
  assert.doesNotMatch(routeSource, /AI targeting is not available on your plan/);
});

test("config missing maps to temporary unavailable message not plan error", () => {
  const previousEnabled = process.env.TARGET_AI_ENABLED;
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.TARGET_AI_ENABLED = "false";
  process.env.OPENAI_API_KEY = "test-key";
  assert.equal(readTargetAiConfigStatus(), "target_ai_disabled");
  assert.match(targetAiErrorMessage("fr", "target_ai_disabled"), /temporairement indisponible/i);
  assert.doesNotMatch(targetAiErrorMessage("fr", "target_ai_disabled"), /formule/i);
  process.env.TARGET_AI_ENABLED = previousEnabled;
  process.env.OPENAI_API_KEY = previousKey;
});

test("AI eligibility rejects low followers and verified accounts", () => {
  assert.deepEqual(
    evaluateAiTargetEligibility({ quality_status: "rejected_low_followers", status: "rejected", followers_count: 120 }),
    { eligible: false, reasonCode: "low_followers" },
  );
  assert.deepEqual(
    evaluateAiTargetEligibility({ quality_status: "rejected_verified", status: "rejected", is_verified: true }),
    { eligible: false, reasonCode: "verified" },
  );
  assert.deepEqual(
    evaluateAiTargetEligibility({ quality_status: "eligible", status: "valid", followers_count: 1200 }),
    { eligible: true, reasonCode: null },
  );
});

test("AI selection blocks validation while ineligible accounts remain", () => {
  const rows = [
    { eligible: true },
    { eligible: false },
  ];
  assert.equal(hasIneligibleAiTargetSelection(rows), true);
  assert.equal(hasIneligibleAiTargetSelection([{ eligible: true }]), false);
});

test("AI wizard validates through existing bulk targets pipeline", () => {
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  assert.match(wizardSource, /import_source: "ai_discovery"/);
  assert.match(wizardSource, /targets\/ai-search/);
  assert.match(wizardSource, /target="_blank"/);
  assert.match(wizardSource, /disabled=\{!canValidate\}/);
});

test("location autocomplete route proxies geocoding server-side", () => {
  const routeSource = source("../../app/api/instagram-client/accounts/[accountId]/targets/location/route.ts");
  assert.match(routeSource, /searchGeocodedPlaces/);
  assert.match(routeSource, /authorizeClientTargetAiRoute/);
  assert.doesNotMatch(routeSource, /GEOCODING_API_KEY/);
});

test("targets bulk route supports AI discovery import source", () => {
  const routeSource = source("../../app/api/instagram-client/accounts/[accountId]/targets/route.ts");
  assert.match(routeSource, /client_dashboard_ai/);
  assert.match(routeSource, /import_source/);
});

test("target AI contract sanitizes suggested usernames", () => {
  assert.deepEqual(
    sanitizeTargetAiSuggestedUsernames({ usernames: ["@Valid_User", "valid_user", "!!!", "abc"] }, 10),
    ["valid_user", "abc"],
  );
});

test("OpenStreetMap embed URL is deterministic", () => {
  const url = buildOpenStreetMapEmbedUrl(48.8566, 2.3522);
  assert.match(url, /openstreetmap\.org\/export\/embed\.html/);
  assert.match(url, /marker=48\.85660%2C2\.35220/);
});
