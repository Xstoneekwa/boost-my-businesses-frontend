import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("all growth run types fail closed on the canonical package contract before scheduling", () => {
  const runControl = source("./run-control.ts");
  const packageGate = runControl.slice(
    runControl.indexOf("GROWTH_RUN_TYPES.includes"),
    runControl.indexOf("const scheduleBlock"),
  );
  assert.match(packageGate, /loadPackageRuntimeContract\(supabase, accountId\)/);
  assert.match(packageGate, /if \(!packageRuntimeContract\.ok\)/);
  assert.match(packageGate, /packageRuntimeContract\.reason/);
});

test("client onboarding does not use the obsolete global account-count environment gate", () => {
  const createAccount = source("../instagram-client/create-account.ts");
  assert.doesNotMatch(createAccount, /clientMaxAccountsLimit|max_accounts_reached|INSTAGRAM_CLIENT_MAX_ACCOUNTS/);
  assert.match(createAccount, /peekReservedEntitlementForClient/);
});

test("Admin Add Profile cannot mutate the canonical commercial package catalogue", () => {
  const ownership = source("./ensure-add-profile-ownership.ts");
  const guard = ownership.slice(
    ownership.indexOf("async function requireActiveCommercialPackage"),
    ownership.indexOf("function normalizeAddonCodes"),
  );
  assert.match(guard, /from\("commercial_packages"\)/);
  assert.doesNotMatch(guard, /\.upsert\(|\.insert\(|\.update\(|\.delete\(/);
});

test("client campaign readiness copy shares the server-side 15 target constant", () => {
  const dashboard = source("../../app/instagram-client/ClientDashboard.tsx");
  assert.match(dashboard, /CLIENT_ONBOARDING_TARGET_MINIMUM/);
  assert.doesNotMatch(dashboard, /campaign starts as soon as 6 targets|démarre dès que 6 comptes/);
});
