import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CLIENT_ONBOARDING_TARGET_MINIMUM,
  hasClientOnboardingTargetMinimum,
} from "./client-account-onboarding-policy.ts";
import { summarizeTargetEligibilityRows } from "../instagram-dashboard/account-target-eligibility.ts";
import { resolveAddProfilePackagePreset } from "../instagram-dashboard/add-profile-packages.ts";
import {
  clientOnboardingProgressIndex,
  isClientOnboardingResumeCandidate,
  resolveClientOnboardingRenderIssue,
} from "./client-onboarding-render-contract.ts";

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
  const canonicalMigration = source("../../supabase/migrations/20260809210000_canonical_instagram_account_onboarding_v1.sql");
  const service = source("./client-account-onboarding.ts");
  assert.match(service, /rpc\("begin_instagram_account_onboarding_v1"/);
  assert.match(canonicalMigration, /public\.begin_client_instagram_onboarding\(/);
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
  assert.match(service, /expire_instagram_account_onboarding_sessions_v1/);
  assert.match(wizard, /restart_session_id/);
  assert.match(wizard, /setPassword\(""\)/);
});

test("rollback-terminal sessions are never returned as resumable onboarding", () => {
  assert.equal(isClientOnboardingResumeCandidate({ status: "completed" }), false);
  assert.equal(isClientOnboardingResumeCandidate({ status: "rolled_back" }), false);
  assert.equal(isClientOnboardingResumeCandidate({ status: "abandoned", failure_reason: "test_onboarding_rollback" }), false);
  assert.equal(isClientOnboardingResumeCandidate({ status: "abandoned", failure_reason: "operator_abandoned" }), true);
  assert.equal(isClientOnboardingResumeCandidate({ status: "expired" }), true);
  assert.equal(isClientOnboardingResumeCandidate({ status: "active" }), true);
});

test("connection renders without account id and incomplete or unknown payloads fail visibly", () => {
  assert.equal(resolveClientOnboardingRenderIssue(null), null);
  assert.equal(resolveClientOnboardingRenderIssue({ currentStep: "connection", accountId: null }), null);
  assert.equal(resolveClientOnboardingRenderIssue({ currentStep: "analysis", publicAnalysis: null }), "onboarding_payload_incomplete");
  assert.equal(resolveClientOnboardingRenderIssue({ currentStep: "protection_lists", accountId: null }), "onboarding_payload_incomplete");
  assert.equal(resolveClientOnboardingRenderIssue({ currentStep: "future_step", accountId: null }), "onboarding_step_render_failed");
  assert.equal(resolveClientOnboardingRenderIssue({ currentStep: "future_step", canRestart: true }), null);
});

test("six server steps map to the five visible progress groups", () => {
  assert.equal(clientOnboardingProgressIndex("connection"), 0);
  assert.equal(clientOnboardingProgressIndex("analysis"), 1);
  assert.equal(clientOnboardingProgressIndex("protection_lists"), 2);
  assert.equal(clientOnboardingProgressIndex("targeting"), 2);
  assert.equal(clientOnboardingProgressIndex("targets"), 3);
  assert.equal(clientOnboardingProgressIndex("complete"), 4);
});

test("wizard initialization cannot stay blank on timeout or an invalid payload", () => {
  const wizard = source("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx");
  const renderContract = source("./client-onboarding-render-contract.ts");
  assert.match(wizard, /ONBOARDING_INIT_TIMEOUT_MS/);
  assert.match(wizard, /new AbortController\(\)/);
  assert.match(wizard, /onboarding_payload_incomplete/);
  assert.match(renderContract, /onboarding_step_render_failed/);
  assert.match(wizard, /Réessayer/);
  assert.match(wizard, /Fermer/);
  assert.match(wizard, /Chargement de votre progression/);
});

test("RLS and grants keep onboarding RPCs server-only and reject technical ownership fields", () => {
  const migration = source("../../supabase/migrations/20260721120000_client_instagram_onboarding_sessions.sql");
  const canonicalMigration = source("../../supabase/migrations/20260809210000_canonical_instagram_account_onboarding_v1.sql");
  const route = source("../../app/api/instagram-client/onboarding/route.ts");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.client_instagram_onboarding_sessions from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.begin_client_instagram_onboarding[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.begin_client_instagram_onboarding[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /grant execute on function public\.begin_client_instagram_onboarding[\s\S]{0,180}to authenticated/);
  assert.match(canonicalMigration, /revoke all on function public\.begin_instagram_account_onboarding_v1[\s\S]*from public, anon, authenticated/);
  assert.match(canonicalMigration, /grant execute on function public\.begin_instagram_account_onboarding_v1[\s\S]*to service_role/);
  assert.match(route, /rejectTechnicalClientFields/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SERVICE_ROLE_KEY/);
});

test("direct client account creation is closed while account subroutes remain intact", () => {
  const accountsRoute = source("../../app/api/instagram-client/accounts/route.ts");
  const accountsSection = source("../../app/instagram-client/ClientAccountsSection.tsx");
  const dashboard = source("../../app/instagram-client/ClientDashboard.tsx");
  assert.match(accountsRoute, /export async function GET/);
  assert.match(accountsRoute, /instagram_onboarding_required/);
  assert.doesNotMatch(accountsRoute, /createClientInstagramAccount/);
  assert.match(accountsSection, /ClientInstagramOnboardingWizard/);
  assert.match(accountsSection, /fetch\("\/api\/instagram-client\/accounts"/);
  assert.match(accountsSection, /displayMode\?: "accounts" \| "add_only"/);
  assert.match(accountsSection, /const addOnly = displayMode === "add_only"/);
  assert.match(dashboard, /displayMode=\{connectionActionPanel\.showAccountActions \? "accounts" : "add_only"\}/);
});

test("package presets do not duplicate the canonical AI targeting entitlement", () => {
  const growth = resolveAddProfilePackagePreset({ commercialPackage: "growth", runtimeMode: "safe_setup", addons: [] });
  const pro = resolveAddProfilePackagePreset({ commercialPackage: "pro", runtimeMode: "safe_setup", addons: [] });
  const premium = resolveAddProfilePackagePreset({ commercialPackage: "premium", runtimeMode: "safe_setup", addons: [] });
  assert.equal("aiTargetingEnabled" in growth, false);
  assert.equal("aiTargetingEnabled" in pro, false);
  assert.equal("aiTargetingEnabled" in premium, false);
});

test("AI search UI and route consume the canonical catalogue projection", () => {
  const drawer = source("../../app/instagram-client/ClientAccountTargetsDrawer.tsx");
  const auth = source("./target-ai-route-auth.ts");
  const onboarding = source("./client-account-onboarding.ts");
  const capabilities = source("../commercial/package-capabilities.ts");
  assert.match(drawer, /const aiEnabled = isClientAiTargetingEnabled\(aiTargetingEnabled\)/);
  assert.match(drawer, /aria-disabled="true"/);
  assert.match(drawer, /if \(!aiEnabled\) return/);
  assert.match(auth, /loadCommercialPackageCapabilities/);
  assert.match(auth, /isClientAiTargetingEnabled\(packageCapabilities\.aiTargetingEnabled\)/);
  assert.match(onboarding, /aiTargetingEnabled: packageCapabilities\.aiTargetingEnabled/);
  assert.match(capabilities, /from\("commercial_packages"\)/);
  assert.match(capabilities, /ai_targeting_enabled/);
  assert.match(auth, /plan_not_allowed/);
});

test("public analysis remains factual and distinguishes unavailable facts from pending AI analysis", () => {
  const service = source("./client-account-onboarding.ts");
  const intelligence = source("./profile-intelligence.ts");
  const aiUi = source("./profile-intelligence-ui.ts");
  const wizard = source("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx");
  assert.match(service, /buildStoredPublicAnalysis/);
  assert.match(intelligence, /officialCategory:\s*observed\(profile\.officialCategory/);
  assert.match(intelligence, /source_type:\s*"deterministic_derived"/);
  assert.match(intelligence, /location:\s*unknownEnvelope/);
  assert.match(intelligence, /niche:\s*unknownEnvelope/);
  assert.match(intelligence, /probableAudience:\s*unknownEnvelope/);
  assert.match(intelligence, /"user_confirmed"/);
  assert.match(intelligence, /"unknown"/);
  assert.match(wizard, /Donnée publique observée/);
  assert.match(wizard, /Confirmé par vous/);
  assert.match(wizard, /Non fournie par le profil/);
  assert.match(aiUi, /À analyser/);
  assert.match(aiUi, /Suggéré par l'analyse/);
  assert.match(aiUi, /Aucune exclusion suggérée/);
  assert.doesNotMatch(wizard, /Non détecté/);
});

test("wizard implements the six required steps and keeps Auto Login explicit", () => {
  const wizard = source("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx");
  const renderContract = source("./client-onboarding-render-contract.ts");
  const createAccount = source("./create-account.ts");
  const onboardingService = source("./client-account-onboarding.ts");
  assert.match(renderContract, /"connection",[\s\S]*"analysis",[\s\S]*"protection_lists",[\s\S]*"targeting",[\s\S]*"targets",[\s\S]*"complete"/);
  assert.match(wizard, /eligibleCount < requiredCount/);
  assert.match(wizard, /ClientAccountTargetsDrawer/);
  assert.match(wizard, /Auto Login démarrera uniquement après ton clic explicite/);
  assert.doesNotMatch(wizard, /Start run|scheduler|device_id|clone_index/);
  assert.match(createAccount, /legacy_direct_create_disabled/);
  assert.doesNotMatch(createAccount, /\.insert\(|\.upsert\(|rotate_instagram_account_credentials/);
  assert.match(onboardingService, /finalizeCompletedOnboardingAssignment/);
  assert.match(onboardingService, /tryAutoAssignOnboardingSchedule\(accountId, \{/);
  assert.match(onboardingService, /provisioning_status: "login_pending"/);
  assert.match(onboardingService, /login_status: "pending"/);
  assert.doesNotMatch(onboardingService, /login_status: "pending_login"/);
  assert.match(onboardingService, /if \(!assignment\.assigned\)[\s\S]{0,240}assignmentStatus: "pending_assignment"/);
  assert.match(onboardingService, /if \(readString\(row\.status\) === "completed"\)[\s\S]{0,240}finalizeCompletedOnboardingAssignment/);
  assert.doesNotMatch(onboardingService, /enqueueClientConnectRequest|connectClientInstagramAccount/);
});

test("completion projection uses the database login contract and returns a resumable client-safe error", () => {
  const route = source("../../app/api/instagram-client/onboarding/route.ts");
  const onboardingService = source("./client-account-onboarding.ts");
  assert.match(onboardingService, /provisioning_status: "login_pending"/);
  assert.match(onboardingService, /login_status: "pending"/);
  assert.match(onboardingService, /onboarding_login_pending_projection_failed/);
  assert.match(route, /Instagram onboarding was completed, but login preparation is still pending\. Refresh to resume\./);
  const messageOffset = route.indexOf("Instagram onboarding was completed");
  assert.ok(messageOffset > 0);
  assert.doesNotMatch(route.slice(messageOffset - 200, messageOffset + 240), /password|secret_ref|service_role/i);
});

test("reserved entitlements open the generic first or nth account wizard", () => {
  const accountsSection = source("../../app/instagram-client/ClientAccountsSection.tsx");
  const checkoutContext = source("../commercial/checkout-context.ts");
  assert.match(checkoutContext, /existing_workspace_add_account[\s\S]*instagram-client\?onboarding=1/);
  assert.match(accountsSection, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(accountsSection, /!onboardingRequested && items\.length > 0/);
  assert.match(accountsSection, /setFormOpen\(true\)/);
  assert.match(accountsSection, /searchParams\.delete\("onboarding"\)/);
});

test("analysis retry is explicit, idempotent, client-safe, and preserves the current session", () => {
  const route = source("../../app/api/instagram-client/onboarding/route.ts");
  const service = source("./client-account-onboarding.ts");
  const wizard = source("../../app/instagram-client/ClientInstagramOnboardingWizard.tsx");
  assert.match(route, /"reanalyze_public"/);
  assert.match(route, /request_key/);
  assert.match(route, /profile_reanalysis_not_found/);
  assert.match(route, /profile_reanalysis_rate_limited/);
  assert.match(route, /profile_reanalysis_invalid_response/);
  assert.match(service, /const attemptCount = \(analysis\.reanalysis\?\.attempt_count \?\? 0\) \+ 1/);
  assert.match(service, /\.eq\("id", input\.sessionId\)/);
  assert.match(service, /\.eq\("client_id", input\.clientId\)/);
  assert.match(wizard, /Réanalyser les données publiques/);
  assert.match(wizard, /!canConfirmAnalysis/);
  assert.match(wizard, /Aucune donnée exploitable n'est encore disponible/);
});
