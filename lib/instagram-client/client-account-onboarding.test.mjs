import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLIENT_ONBOARDING_TARGET_MINIMUM,
  hasClientOnboardingTargetMinimum,
} from "./client-account-onboarding-policy.ts";
import { isClientAiTargetingEnabled } from "./ai-targeting-gate.ts";
import { summarizeTargetEligibilityRows } from "../instagram-dashboard/account-target-eligibility.ts";
import { resolveAddProfilePackagePreset } from "../instagram-dashboard/add-profile-packages.ts";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("onboarding target minimum rejects 0 and 14, then accepts 15", () => {
  assert.equal(CLIENT_ONBOARDING_TARGET_MINIMUM, 15);
  assert.equal(hasClientOnboardingTargetMinimum(0), false);
  assert.equal(hasClientOnboardingTargetMinimum(14), false);
  assert.equal(hasClientOnboardingTargetMinimum(15), true);
});

test("only found, eligible, non-terminal target rows count", () => {
  const rows = [
    ...Array.from({ length: 15 }, () => ({ status: "valid", quality_status: "eligible", verification_status: "found" })),
    { status: "pending", quality_status: "eligible", verification_status: "found" },
    { status: "rejected", quality_status: "eligible", verification_status: "found" },
    { status: "duplicate", quality_status: "eligible", verification_status: "found" },
    { status: "valid", quality_status: "rejected_irrelevant", verification_status: "found" },
    { status: "valid", quality_status: "eligible", verification_status: "pending" },
    { status: "valid", quality_status: "eligible", verification_status: "found", archived_at: "2026-07-21T00:00:00Z" },
    { status: "active", quality_status: "eligible", verification_status: "found", deleted_at: "2026-07-21T00:00:00Z" },
  ];
  const counts = summarizeTargetEligibilityRows(rows);
  assert.equal(counts.eligible, 15);
  assert.equal(counts.pending, 2);
  assert.equal(counts.rejected, 3);
  assert.equal(counts.archived, 2);
});

test("server completion recounts exactly 15 eligible targets in PostgreSQL", () => {
  const migration = source("../../supabase/migrations/20260721120000_client_instagram_onboarding_sessions.sql");
  assert.match(migration, /public_analysis_required/);
  assert.match(migration, /targeting_criteria_required/);
  assert.match(migration, /v_eligible_count < 15/);
  assert.match(migration, /lower\(trim\(coalesce\(t\.status, ''\)\)\) in \('valid', 'active'\)/);
  assert.match(migration, /quality_status, ''\)\)\) = 'eligible'/);
  assert.match(migration, /verification_status, ''\)\)\) = 'found'/);
  assert.match(migration, /t\.archived_at is null/);
  assert.match(migration, /t\.deleted_at is null/);
  assert.match(migration, /runtime_activation_requested', false/);
});

test("account, credential vault, ownership, package, and entitlement share one RPC transaction", () => {
  const migration = source("../../supabase/migrations/20260721120000_client_instagram_onboarding_sessions.sql");
  const service = source("./client-account-onboarding.ts");
  assert.match(service, /rpc\("begin_client_instagram_onboarding"/);
  assert.doesNotMatch(service, /\.from\("ig_accounts"\)[\s\S]{0,160}\.insert/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /for update/);
  assert.match(migration, /create_instagram_credentials_vault_secret/);
  assert.match(migration, /rotate_instagram_account_credentials/);
  assert.match(migration, /insert into public\.client_instagram_accounts/);
  assert.match(migration, /insert into public\.client_subscription_accounts/);
  assert.match(migration, /set status = 'entitlement_consumed'/);
  assert.match(migration, /exception when others then/);
  assert.match(migration, /status = 'failed_retryable'/);
});

test("onboarding sessions are server-owned, credential-free, leased, expirable, and restartable", () => {
  const migration = source("../../supabase/migrations/20260721120000_client_instagram_onboarding_sessions.sql");
  const service = source("./client-account-onboarding.ts");
  const wizard = source("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx");
  assert.match(migration, /Never stores credentials or recovery secrets/);
  assert.doesNotMatch(migration.split("create table if not exists public.client_instagram_onboarding_sessions")[1].split(");")[0], /password|secret_ref/);
  assert.match(migration, /lease_expires_at/);
  assert.match(migration, /expires_at/);
  assert.match(migration, /'expired', 'abandoned'/);
  assert.match(migration, /restart_client_instagram_onboarding/);
  assert.match(service, /expire_client_instagram_onboarding_sessions/);
  assert.match(wizard, /restart_session_id/);
  assert.match(wizard, /setPassword\(""\)/);
});

test("RLS and grants keep onboarding RPCs server-only and reject technical ownership fields", () => {
  const migration = source("../../supabase/migrations/20260721120000_client_instagram_onboarding_sessions.sql");
  const route = source("../../app/api/instagram-client/onboarding/route.ts");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.client_instagram_onboarding_sessions from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.begin_client_instagram_onboarding[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.begin_client_instagram_onboarding[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.begin_client_instagram_onboarding[\s\S]{0,180}to authenticated/);
  assert.match(route, /rejectTechnicalClientFields/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test("direct client account creation is closed while account subroutes remain intact", () => {
  const accountsRoute = source("../../app/api/instagram-client/accounts/route.ts");
  const accountsSection = source("../../app/instagram-client/ClientAccountsSection.tsx");
  assert.match(accountsRoute, /export async function GET/);
  assert.match(accountsRoute, /instagram_onboarding_required/);
  assert.doesNotMatch(accountsRoute, /createClientInstagramAccount/);
  assert.match(accountsSection, /ClientInstagramOnboardingWizard/);
  assert.match(accountsSection, /fetch\("\/api\/instagram-client\/accounts"/);
});

test("Growth, Pro, and Premium expose the canonical targeting contract", () => {
  const growth = resolveAddProfilePackagePreset({ commercialPackage: "growth", runtimeMode: "safe_setup", addons: [] });
  const pro = resolveAddProfilePackagePreset({ commercialPackage: "pro", runtimeMode: "safe_setup", addons: [] });
  const premium = resolveAddProfilePackagePreset({ commercialPackage: "premium", runtimeMode: "safe_setup", addons: [] });
  assert.equal(growth.aiTargetingEnabled, false);
  assert.equal(pro.aiTargetingEnabled, true);
  assert.equal(premium.aiTargetingEnabled, true);
  assert.equal(isClientAiTargetingEnabled("growth"), false);
  assert.equal(isClientAiTargetingEnabled("pro"), true);
  assert.equal(isClientAiTargetingEnabled("premium"), true);
});

test("Growth UI locks AI search and the server route uses the same gate", () => {
  const drawer = source("../../app/instagram-client/ClientAccountTargetsDrawer.tsx");
  const auth = source("./target-ai-route-auth.ts");
  assert.match(drawer, /const aiEnabled = isClientAiTargetingEnabled\(packageCode\)/);
  assert.match(drawer, /aria-disabled="true"/);
  assert.match(drawer, /if \(!aiEnabled\) return/);
  assert.match(auth, /isClientAiTargetingEnabled\(packageCode\)/);
  assert.match(auth, /plan_not_allowed/);
});

test("public analysis remains factual and explicitly labels undetected values", () => {
  const service = source("./client-account-onboarding.ts");
  const wizard = source("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx");
  assert.match(service, /category:\s*null/);
  assert.match(service, /language:\s*null/);
  assert.match(service, /location:\s*null/);
  assert.match(service, /niche:\s*null/);
  assert.match(service, /probableAudience:\s*null/);
  assert.match(service, /"user_confirmed"/);
  assert.match(service, /"not_detected"/);
  assert.match(wizard, /Donnée publique/);
  assert.match(wizard, /Confirmé par vous/);
  assert.match(wizard, /Non détecté/);
});

test("wizard implements exactly the five required steps and never activates runtime", () => {
  const wizard = source("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx");
  const createAccount = source("./create-account.ts");
  assert.match(wizard, /\["connection", "analysis", "targeting", "targets", "complete"\]/);
  assert.match(wizard, /eligibleCount < requiredCount/);
  assert.match(wizard, /ClientAccountTargetsDrawer/);
  assert.doesNotMatch(wizard, /Auto Login|Start run|scheduler|device_id|clone_index/);
  assert.match(createAccount, /flowMode === "targeting_setup"/);
  assert.match(createAccount, /accountStatus: targetingSetup \? "inactive" : "active"/);
});
