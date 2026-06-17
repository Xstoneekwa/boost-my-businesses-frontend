import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isClientAiTargetingEnabled } from "./ai-targeting-gate.ts";
import {
  evaluateAiTargetEligibility,
  hasIneligibleAiTargetSelection,
} from "./target-ai-eligibility.ts";
import {
  buildTargetAiSystemPrompt,
  sanitizeTargetAiDiscoveryResponse,
  sanitizeTargetAiSuggestedUsernames,
  targetingAiPromptVersion,
} from "./target-ai-contract.ts";
import { readTargetAiConfigStatus } from "./target-ai-config.ts";
import { readTargetingAiSettings, TARGETING_AI_PROMPT_VERSION } from "./targeting-ai-settings.ts";
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

test("target AI contract uses targeting_ai_v1 and strategy schema", () => {
  assert.equal(targetingAiPromptVersion(), "targeting_ai_v1");
  assert.equal(TARGETING_AI_PROMPT_VERSION, "targeting_ai_v1");
  assert.match(buildTargetAiSystemPrompt(), /search strategist/i);
  assert.match(buildTargetAiSystemPrompt(), /do NOT know which accounts exist/i);
  const contractSource = source("./target-ai-contract.ts");
  assert.match(contractSource, /search_angles/);
  assert.match(contractSource, /seed_usernames/);
});

test("target AI settings default to broader candidate pipeline", () => {
  const settings = readTargetingAiSettings();
  assert.equal(settings.promptVersion, "targeting_ai_v1");
  assert.ok(settings.maxGptCandidates >= 30);
  assert.ok(settings.maxDisplayedResults >= 10);
  assert.equal(settings.minFollowers, 500);
  assert.equal(settings.allowVerified, false);
  assert.equal(settings.secondPassEnabled, true);
});

test("target AI search service loads DB-backed config and logs prompt_source", () => {
  const serviceSource = source("./target-ai-search-service.ts");
  assert.match(serviceSource, /resolveActiveTargetingAiConfig/);
  assert.match(serviceSource, /callTargetAiOpenAiDiscovery/);
  assert.match(serviceSource, /prompt_source/);
  assert.doesNotMatch(serviceSource, /buildTargetAiSystemPrompt\(\)/);
});

test("targeting AI config store supports DB custom prompt with code fallback", () => {
  const storeSource = source("./targeting-ai-config-store.ts");
  assert.match(storeSource, /ig_system_settings/);
  assert.match(storeSource, /prompt_source/);
  assert.match(storeSource, /code_default/);
  assert.match(storeSource, /db_custom/);
  const contractSource = source("./target-ai-contract.ts");
  assert.match(contractSource, /renderTargetAiUserPrompt/);
  assert.match(contractSource, /buildDefaultUserPromptTemplate/);
  assert.match(contractSource, /\{\{niche\}\}/);
});

test("targeting AI admin routes support editable config without secrets", () => {
  const configRoute = source("../../app/api/instagram-dashboard/targeting-ai/config/route.ts");
  const resetRoute = source("../../app/api/instagram-dashboard/targeting-ai/config/reset/route.ts");
  const testRoute = source("../../app/api/instagram-dashboard/targeting-ai/test/route.ts");
  assert.match(configRoute, /PATCH/);
  assert.match(configRoute, /saveTargetingAiConfig/);
  assert.match(configRoute, /serializeTargetingAiPublicConfig/);
  assert.match(resetRoute, /resetTargetingAiConfig/);
  assert.match(testRoute, /callTargetAiOpenAiDiscovery/);
  assert.match(testRoute, /dry_run/);
  assert.doesNotMatch(configRoute, /process\.env\.OPENAI_API_KEY/);
});

test("targeting AI prompt validation rejects empty or secret-bearing prompts", async () => {
  const { validateTargetingAiPromptText } = await import("./targeting-ai-config-validation.ts");
  const invalid = validateTargetingAiPromptText({ systemPrompt: "short", userPromptTemplate: "too short" });
  assert.equal(invalid.ok, false);
  const missingToken = validateTargetingAiPromptText({
    systemPrompt: "You are a search strategist for Instagram discovery only.",
    userPromptTemplate: "Find accounts for {{location_line}} without niche token.",
  });
  assert.equal(missingToken.ok, false);
  const secret = validateTargetingAiPromptText({
    systemPrompt: "You are a search strategist for Instagram discovery only.",
    userPromptTemplate: "Use sk-1234567890abcdef and find {{niche}} with {{max_candidates}} and {{min_followers}}.",
  });
  assert.equal(secret.ok, false);
});

test("target AI contract sanitizes suggested usernames", () => {
  assert.deepEqual(
    sanitizeTargetAiSuggestedUsernames({ usernames: ["@Valid_User", "valid_user", "!!!", "abc"] }, 10),
    ["valid_user", "abc"],
  );
  const flattened = sanitizeTargetAiDiscoveryResponse({
    seed_usernames: ["seed_one"],
    search_angles: [{ seed_usernames: ["angle_user", "seed_one"] }],
    usernames: ["legacy_user"],
  }, 10);
  assert.deepEqual(new Set(flattened), new Set(["seed_one", "angle_user", "legacy_user"]));
});

test("OpenStreetMap embed URL is deterministic", () => {
  const url = buildOpenStreetMapEmbedUrl(48.8566, 2.3522);
  assert.match(url, /openstreetmap\.org\/export\/embed\.html/);
  assert.match(url, /marker=48\.85660%2C2\.35220/);
});

test("target AI discovery parses search_queries and seed usernames separately", async () => {
  const { parseTargetAiDiscoveryPayload } = await import("./target-ai-contract.ts");
  const parsed = parseTargetAiDiscoveryPayload({
    search_queries: [
      'site:instagram.com "psychologist" "Johannesburg"',
      "site:instagram.com therapy Johannesburg",
    ],
    seed_usernames: ["maybe_fake_user"],
    search_angles: [{ keywords: ["football"], hashtag_hints: ["#psg"], seed_usernames: ["angle_user"] }],
    niche_variants: ["mental health coach"],
  }, 20);
  assert.equal(parsed.searchQueries.length, 3);
  assert.ok(parsed.searchQueries.some((query) => query.includes("psychologist")));
  assert.deepEqual(new Set(parsed.usernames), new Set(["maybe_fake_user", "angle_user"]));
});

test("target AI discovery query builder uses GPT search_queries first", async () => {
  const { buildTargetAiDiscoveryQueries } = await import("./target-ai-discovery-queries.ts");
  const { parseTargetAiDiscoveryPayload } = await import("./target-ai-contract.ts");
  const discovery = parseTargetAiDiscoveryPayload({
    search_queries: ['site:instagram.com "football" "Paris"'],
    search_angles: [{ keywords: ["soccer"], hashtag_hints: ["#football"], label: "clubs" }],
  }, 20);
  const queries = buildTargetAiDiscoveryQueries({
    niche: "football",
    locationLabel: "Paris",
    discovery,
    pass: "primary",
    maxQueries: 12,
  });
  assert.ok(queries.length >= 3);
  assert.equal(queries[0], 'site:instagram.com "football" "Paris"');
  assert.ok(queries.some((query) => query.includes("Paris")));
});

test("instagram URL extractor ignores non-profile paths and extracts profile handles", async () => {
  const {
    extractInstagramUsernameFromUrl,
    extractInstagramUsernamesFromSearchResult,
  } = await import("./target-ai-instagram-url.ts");
  assert.equal(extractInstagramUsernameFromUrl("https://www.instagram.com/reel/abc123/"), null);
  assert.equal(extractInstagramUsernameFromUrl("https://www.instagram.com/explore/tags/football/"), null);
  assert.equal(extractInstagramUsernameFromUrl("https://www.instagram.com/paris.football.club/"), "paris.football.club");
  assert.deepEqual(
    extractInstagramUsernamesFromSearchResult({
      link: "https://www.instagram.com/p/abc123/",
      title: "Coach (@realcoach) • Instagram photos",
      snippet: "Visit https://www.instagram.com/realcoach/ for sessions in Johannesburg",
    }),
    ["realcoach"],
  );
});

test("SearchAPI discovery mock extracts usernames from organic Instagram URLs", async () => {
  const { discoverInstagramUsernamesViaSearchApi } = await import("./target-ai-searchapi-discovery.ts");
  const fetcher = async (url) => {
    const parsed = new URL(String(url));
    assert.equal(parsed.searchParams.get("engine"), "google");
    assert.ok(parsed.searchParams.get("q")?.includes("site:instagram.com"));
    return {
      ok: true,
      async json() {
        return {
          organic_results: [
            { link: "https://www.instagram.com/jozi.psychologist/", title: "Jozi Psychologist" },
            { link: "https://www.instagram.com/p/abc/", title: "Post" },
            { title: "Therapy Hub", snippet: "https://www.instagram.com/therapyhub_jhb" },
          ],
        };
      },
    };
  };
  const previousKey = process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY;
  process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY = "test-key";
  const result = await discoverInstagramUsernamesViaSearchApi({
    queries: ['site:instagram.com "psychologist" "Johannesburg"'],
    maxUsernames: 10,
    fetcher,
  });
  process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY = previousKey;
  assert.ok(result.queriesExecuted >= 1);
  assert.equal(result.extractedUsernamesCount, 2);
  assert.deepEqual(new Set(result.usernames), new Set(["jozi.psychologist", "therapyhub_jhb"]));
});

test("target AI search service wires discovery before profile verification", () => {
  const serviceSource = source("./target-ai-search-service.ts");
  assert.match(serviceSource, /discoverInstagramUsernamesViaSearchApi/);
  assert.match(serviceSource, /buildTargetAiDiscoveryQueries/);
  assert.match(serviceSource, /gpt_search_queries_count/);
  assert.match(serviceSource, /profile_checked_count/);
  assert.match(serviceSource, /profile_provider_error_count/);
});

test("target AI error message stays user-safe when no verified accounts are found", () => {
  assert.match(targetAiErrorMessage("fr", "no_candidates_found"), /Aucun compte vérifié trouvé/i);
  assert.doesNotMatch(targetAiErrorMessage("fr", "no_candidates_found"), /SearchAPI|GPT|provider/i);
});

test("AI candidate avatar proxy path is account and username scoped", async () => {
  const { clientAiCandidateAvatarProxyPath, serializeTargetAiCandidateForClient } = await import("./target-ai-candidate-avatar.ts");
  const path = clientAiCandidateAvatarProxyPath("acc-1", "sample_user");
  assert.match(path, /\/targets\/ai-candidate\/avatar\?username=sample_user/);
  const serialized = serializeTargetAiCandidateForClient("acc-1", {
    username: "sample_user",
    followersCount: 1200,
    avatarUrl: "https://cdn.example.test/a.jpg",
    avatarAvailable: true,
    eligible: true,
    ineligibleReasonCode: null,
    profileUrl: "https://www.instagram.com/sample_user/",
    isVerified: false,
    isPrivate: false,
    verificationStatus: "found",
    qualityStatus: "eligible",
    relevanceScore: 4,
  });
  assert.equal(serialized.avatarUrl, path);
  assert.equal(serialized.avatarProxyUrl, path);
  assert.doesNotMatch(String(serialized.avatarUrl), /cdn\.example/);
});

test("AI wizard uses server avatar proxy for temporary candidates", () => {
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  assert.match(wizardSource, /avatarAvailable/);
  assert.match(wizardSource, /row\.avatarUrl/);
  const routeSource = source("../../app/api/instagram-client/accounts/[accountId]/targets/ai-search/route.ts");
  assert.match(routeSource, /serializeTargetAiCandidateForClient/);
  const avatarSource = source("./target-ai-candidate-avatar.ts");
  assert.match(avatarSource, /ai-candidate\/avatar/);
});

test("target AI relevance scoring prefers niche and location matches", async () => {
  const { scoreTargetAiCandidateRelevance } = await import("./target-ai-relevance-score.ts");
  const strong = scoreTargetAiCandidateRelevance({
    username: "pretoria_chinese_food",
    niche: "chinese restaurant",
    locationLabel: "Pretoria",
    profileName: "Pretoria Chinese Kitchen",
    biography: "Authentic chinese food in Pretoria",
  });
  const weak = scoreTargetAiCandidateRelevance({
    username: "random.photo.studio",
    niche: "chinese restaurant",
    locationLabel: "Pretoria",
    profileName: "Portrait Studio",
    biography: "Wedding photography",
  });
  assert.ok(strong > weak);
});

test("target AI profile lookup concurrency stays throttled at two workers max", async () => {
  const { readTargetAiProfileLookupConcurrency } = await import("./target-ai-profile-verify.ts");
  assert.equal(readTargetAiProfileLookupConcurrency(4), 2);
  assert.equal(readTargetAiProfileLookupConcurrency(1), 1);
});
