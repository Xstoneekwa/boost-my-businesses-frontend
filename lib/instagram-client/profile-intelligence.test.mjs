import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detectProfileLanguage } from "./profile-language.ts";
import {
  applyClientPublicAnalysisConfirmation,
  buildStoredPublicAnalysis,
  mergeReanalysisPreservingConfirmations,
  projectClientPublicAnalysis,
  readStoredPublicAnalysis,
  withReanalysisState,
} from "./profile-intelligence.ts";
import { evaluateProfileReanalysis } from "./profile-reanalysis-policy.ts";

const observedAt = "2026-07-21T17:00:00.000Z";

function profile(overrides = {}) {
  return {
    lookupStatus: "found",
    providerProfileId: null,
    username: "factual_profile",
    displayName: "Factual Profile",
    biography: "Nous aidons les entreprises à développer leur stratégie avec des conseils simples.",
    avatarUrl: "https://cdn.example.test/avatar.jpg",
    avatarHdUrl: "https://cdn.example.test/avatar-hd.jpg",
    followersCount: 100,
    followingCount: 50,
    postsCount: 20,
    isPrivate: false,
    isVerified: true,
    isBusiness: true,
    officialCategory: "Entrepreneur",
    externalUrl: "https://example.test/",
    bioLinks: [{ title: "Website", url: "https://example.test/" }],
    recentCaptionSamples: ["Une stratégie claire pour développer votre entreprise."],
    checkedAt: observedAt,
    ...overrides,
  };
}

test("deterministic language detects a sufficiently long French profile", () => {
  const result = detectProfileLanguage({ biography: profile().biography });
  assert.equal(result.language, "fr");
  assert.equal(result.reason, "detected");
  assert.ok((result.confidence ?? 0) > 0.5);
  assert.deepEqual(result.sourceFields, ["biography"]);
});
test("deterministic language detects a sufficiently long English profile", () => {
  const result = detectProfileLanguage({ biography: "We help small businesses grow online with clear marketing strategies for their audience." });
  assert.equal(result.language, "en");
  assert.equal(result.reason, "detected");
});

test("deterministic language keeps short, multilingual, emoji-only and absent text unknown", () => {
  assert.equal(detectProfileLanguage({ biography: "Bonjour" }).language, null);
  assert.equal(detectProfileLanguage({ biography: "Nous aidons your business avec marketing and growth pour votre audience" }).language, null);
  assert.equal(detectProfileLanguage({ biography: "🚀✨🔥" }).language, null);
  assert.equal(detectProfileLanguage({}).language, null);
});

test("profile intelligence V1 preserves observed facts and strips raw avatar and caption content from the client DTO", () => {
  const stored = buildStoredPublicAnalysis(profile());
  assert.equal(stored.version, 1);
  assert.equal(stored.fields.followingCount.value, 50);
  assert.equal(stored.fields.followingCount.source_type, "public_observed");
  assert.equal(stored.fields.language.source_type, "deterministic_derived");
  assert.equal(stored.fields.niche.source_type, "unknown");
  const client = projectClientPublicAnalysis(stored);
  assert.equal(client?.avatarAvailable, true);
  assert.equal(client?.followingCount, 50);
  assert.equal(client?.recentCaptionSampleCount, 1);
  assert.equal(JSON.stringify(client).includes("cdn.example.test"), false);
  assert.equal(JSON.stringify(client).includes("stratégie claire"), false);
});

test("legacy public_analysis hydrates without error and is projected as V1", () => {
  const legacy = {
    lookupStatus: "found",
    username: "legacy_profile",
    displayName: "Legacy",
    biography: "Legacy public biography remains readable after deployment.",
    avatarUrl: "https://cdn.example.test/legacy.jpg",
    followersCount: 12,
    isPrivate: null,
    isVerified: null,
    checkedAt: observedAt,
    category: null,
    language: null,
    location: null,
    niche: null,
    themes: [],
    probableAudience: null,
    sources: { displayName: "public" },
  };
  const stored = readStoredPublicAnalysis(legacy);
  const client = projectClientPublicAnalysis(legacy);
  assert.equal(stored?.version, 1);
  assert.equal(client?.username, "legacy_profile");
  assert.equal(client?.avatarAvailable, true);
  assert.equal(JSON.stringify(client).includes("legacy.jpg"), false);
});

test("legacy null public counters remain unknown instead of being projected as zero", () => {
  const client = projectClientPublicAnalysis({
    lookupStatus: "provider_error",
    username: "unknown_profile",
    followersCount: null,
    followingCount: null,
    postsCount: null,
    checkedAt: observedAt,
  });
  assert.equal(client?.followersCount, null);
  assert.equal(client?.followingCount, null);
  assert.equal(client?.postsCount, null);
});

test("reanalysis attempt state survives persistence and client projection", () => {
  const stored = withReanalysisState(buildStoredPublicAnalysis(profile()), {
    request_key: "key-a",
    status: "failed",
    attempt_count: 2,
    started_at: observedAt,
    completed_at: "2026-07-21T17:00:05.000Z",
    error_code: "provider_throttled",
  });
  assert.equal(readStoredPublicAnalysis(stored)?.reanalysis?.attempt_count, 2);
  assert.deepEqual(projectClientPublicAnalysis(stored)?.reanalysis, {
    status: "failed",
    attemptCount: 2,
    startedAt: observedAt,
    completedAt: "2026-07-21T17:00:05.000Z",
    errorCode: "provider_throttled",
  });
});

test("client correction remains separate from the original public observation", () => {
  const stored = buildStoredPublicAnalysis(profile());
  const confirmed = applyClientPublicAnalysisConfirmation({
    ...projectClientPublicAnalysis(stored),
    displayName: "Confirmed Name",
  }, stored, "2026-07-21T17:05:00.000Z");
  assert.equal(confirmed.fields.displayName.value, "Factual Profile");
  assert.equal(confirmed.confirmations.displayName?.value, "Confirmed Name");
  assert.equal(confirmed.confirmations.displayName?.source_type, "user_confirmed");
  assert.equal(projectClientPublicAnalysis(confirmed)?.displayName, "Confirmed Name");
});

test("reanalysis replaces observations while preserving user confirmations", () => {
  const oldStored = applyClientPublicAnalysisConfirmation({
    ...projectClientPublicAnalysis(buildStoredPublicAnalysis(profile())),
    displayName: "Confirmed Name",
  }, buildStoredPublicAnalysis(profile()), "2026-07-21T17:05:00.000Z");
  const fresh = buildStoredPublicAnalysis(profile({ displayName: "New Public Name", followersCount: 120 }));
  const merged = mergeReanalysisPreservingConfirmations(fresh, oldStored);
  assert.equal(merged.fields.displayName.value, "New Public Name");
  assert.equal(projectClientPublicAnalysis(merged)?.displayName, "Confirmed Name");
  assert.equal(projectClientPublicAnalysis(merged)?.followersCount, 120);
});

test("reanalysis policy handles double-click, network retry, refresh, concurrency and terminal sessions", () => {
  const base = buildStoredPublicAnalysis(profile());
  const now = new Date("2026-07-21T17:10:00.000Z");
  const common = { status: "active", currentStep: "analysis", expiresAt: "2026-07-28T17:00:00.000Z", requestKey: "key-a", now };

  assert.equal(evaluateProfileReanalysis({ ...common, analysis: base }).action, "allow");
  const running = { ...base, reanalysis: { request_key: "key-a", status: "running", started_at: "2026-07-21T17:09:50.000Z", completed_at: null, error_code: null } };
  assert.equal(evaluateProfileReanalysis({ ...common, analysis: running }).action, "return_existing");
  assert.deepEqual(evaluateProfileReanalysis({ ...common, requestKey: "key-b", analysis: running }), { action: "reject", code: "profile_reanalysis_in_progress", status: 409 });
  const failed = { ...base, reanalysis: { request_key: "key-a", status: "failed", started_at: "2026-07-21T17:09:40.000Z", completed_at: "2026-07-21T17:09:48.000Z", error_code: "network" } };
  assert.equal(evaluateProfileReanalysis({ ...common, analysis: failed }).action, "allow");
  const completed = { ...base, reanalysis: { request_key: "key-a", status: "completed", started_at: "2026-07-21T17:09:40.000Z", completed_at: "2026-07-21T17:09:50.000Z", error_code: null } };
  assert.equal(evaluateProfileReanalysis({ ...common, analysis: completed }).action, "return_existing");
  assert.deepEqual(evaluateProfileReanalysis({ ...common, requestKey: "key-b", analysis: completed }), { action: "reject", code: "profile_reanalysis_cooldown", status: 429 });
  assert.equal(evaluateProfileReanalysis({ ...common, status: "completed", analysis: base }).action, "reject");
  assert.equal(evaluateProfileReanalysis({ ...common, expiresAt: "2026-07-21T17:00:00.000Z", analysis: base }).action, "reject");
});

test("reanalysis implementation cannot create accounts, rewrite credentials or consume entitlements", () => {
  const source = readFileSync(new URL("./client-account-onboarding.ts", import.meta.url), "utf8");
  const section = source.split("export async function reanalyzeClientInstagramOnboarding")[1];
  assert.ok(section);
  assert.doesNotMatch(section, /createClientInstagramAccount|submitClientCredentials|markEntitlementConsumed/);
  assert.doesNotMatch(section, /\.from\("ig_accounts"\)|\.from\("client_account_entitlements"\)|password|credentials/i);
  assert.match(section, /\.eq\("client_id", input\.clientId\)/);
  assert.match(section, /\.eq\("updated_at", readString\(row\.updated_at\)\)/);
});
