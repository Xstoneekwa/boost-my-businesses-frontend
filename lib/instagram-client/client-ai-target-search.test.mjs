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

test("AI wizard uses shared avatar component with server proxy", () => {
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  assert.match(wizardSource, /AiCandidateAvatar/);
  assert.match(wizardSource, /avatarAvailable/);
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
  assert.equal(readTargetAiProfileLookupConcurrency(4, 12), 1);
});

test("primary discovery queries require location when location is provided", async () => {
  const { buildTargetAiDiscoveryQueries, parseTargetAiLocationParts } = await import("./target-ai-discovery-queries.ts");
  const { parseTargetAiDiscoveryPayload } = await import("./target-ai-contract.ts");
  const discovery = parseTargetAiDiscoveryPayload({
    search_queries: [
      "site:instagram.com cuisine asiatique",
      "site:instagram.com restaurant asiatique",
    ],
    niche_variants: ["traiteur asiatique"],
  }, 20);
  const queries = buildTargetAiDiscoveryQueries({
    niche: "restaurant asiatique",
    locationLabel: "Bordeaux, Gironde, France",
    discovery,
    pass: "primary",
    maxQueries: 12,
  });
  assert.ok(queries.length >= 4);
  for (const query of queries) {
    const parts = parseTargetAiLocationParts("Bordeaux, Gironde, France");
    const lower = query.toLowerCase();
    const hasLocation = lower.includes(parts.city.toLowerCase())
      || (parts.region && lower.includes(parts.region.toLowerCase()))
      || (parts.country && lower.includes(parts.country.toLowerCase()));
    assert.ok(hasLocation, `primary query missing location: ${query}`);
  }
});

test("discovery candidate pre-score ranks niche and location matches first", async () => {
  const { scoreDiscoveryCandidate, rankDiscoveryCandidates } = await import("./target-ai-discovery-candidate-score.ts");
  const ranked = rankDiscoveryCandidates([
    {
      username: "generic_food",
      discoveryScore: scoreDiscoveryCandidate({
        username: "generic_food",
        niche: "restaurant asiatique",
        locationLabel: "Bordeaux",
        sourceQuery: 'site:instagram.com cuisine asiatique',
        title: "Asian cuisine inspiration",
        snippet: "National food blog",
      }),
    },
    {
      username: "bordeaux_asian_kitchen",
      discoveryScore: scoreDiscoveryCandidate({
        username: "bordeaux_asian_kitchen",
        niche: "restaurant asiatique",
        locationLabel: "Bordeaux",
        sourceQuery: 'site:instagram.com "restaurant asiatique" "Bordeaux"',
        title: "Bordeaux Asian Kitchen",
        snippet: "Restaurant asiatique à Bordeaux",
      }),
    },
  ]);
  assert.equal(ranked[0].username, "bordeaux_asian_kitchen");
});

test("target AI runtime stops when max latency is exceeded", async () => {
  const { TargetAiSearchRuntime } = await import("./target-ai-search-runtime.ts");
  const runtime = new TargetAiSearchRuntime({
    maxLatencyMs: 50,
    primaryQueryLimit: 14,
    broadenedQueryLimit: 12,
    complementaryQueryLimit: 8,
    rateLimitCooldownMs: 1000,
    minCandidateScore: -20,
    targetEligibleCount: 12,
    minDisplayedBeforeStop: 15,
    thirdPassDisplayThreshold: 10,
    broadenedDisplayThreshold: 15,
    thirdPassEnabled: true,
    maxDiscoveredUsernames: 100,
    maxProfileChecks: 80,
  }, Date.now() - 60);
  assert.equal(runtime.isTimeExceeded(), true);
  runtime.markStopped("time_budget_reached");
  assert.equal(runtime.stoppedReason, "time_budget_reached");
});

test("target AI runtime only hard-stops rate limits after many hits", async () => {
  const { TargetAiSearchRuntime } = await import("./target-ai-search-runtime.ts");
  const runtime = new TargetAiSearchRuntime({
    maxLatencyMs: 120000,
    primaryQueryLimit: 14,
    broadenedQueryLimit: 12,
    complementaryQueryLimit: 8,
    rateLimitCooldownMs: 1000,
    minCandidateScore: -20,
    targetEligibleCount: 12,
    minDisplayedBeforeStop: 15,
    thirdPassDisplayThreshold: 10,
    broadenedDisplayThreshold: 15,
    thirdPassEnabled: true,
    maxDiscoveredUsernames: 100,
    maxProfileChecks: 80,
  });
  for (let index = 0; index < 8; index += 1) runtime.recordRateLimit();
  assert.equal(runtime.isRateLimitHardStop(), false);
  assert.equal(runtime.shouldSlowDownProfileLookups(), false);
  for (let index = 0; index < 16; index += 1) runtime.recordRateLimit();
  assert.equal(runtime.isRateLimitHardStop(), true);
  assert.equal(runtime.profileConcurrency(4), 1);
});

test("provider error reason summary excludes rate limits and not_found", async () => {
  const {
    applyTargetAiProfileVerifyStats,
    createTargetAiProfileVerifyStats,
    topTargetAiProviderErrorReasons,
  } = await import("./target-ai-profile-verify.ts");
  const stats = createTargetAiProfileVerifyStats();
  applyTargetAiProfileVerifyStats(stats, {
    errorReason: "rate_limited",
    verificationStatus: "provider_error",
  });
  applyTargetAiProfileVerifyStats(stats, {
    errorReason: "not_found",
    verificationStatus: "not_found",
  });
  applyTargetAiProfileVerifyStats(stats, {
    errorReason: "provider_timeout",
    verificationStatus: "provider_error",
  });
  const top = topTargetAiProviderErrorReasons(stats);
  assert.ok(top.some((row) => row.reason === "provider_timeout"));
  assert.ok(!top.some((row) => row.reason === "rate_limited"));
  assert.ok(!top.some((row) => row.reason === "not_found"));
});

test("broadened pass should run when displayed count stays below threshold", () => {
  const serviceSource = source("./target-ai-search-service.ts");
  assert.match(serviceSource, /broadenedDisplayThreshold/);
  assert.match(serviceSource, /displayCount >= input\.displayThreshold/);
  assert.doesNotMatch(serviceSource, /isRateLimitSevere/);
});

test("google query builder prioritizes loose instagram queries before strict site queries", async () => {
  const { buildTargetAiGoogleQueries, buildTargetAiLooseQueries, buildTargetAiStrictComplementQueries } = await import("./target-ai-google-query-builder.ts");
  const queries = buildTargetAiGoogleQueries({
    niche: "restaurant chinois",
    locationLabel: "Johannesburg, Gauteng, South Africa",
    maxQueries: 12,
  });
  assert.ok(queries.length >= 4);
  assert.match(queries[0], /instagram/i);
  assert.doesNotMatch(queries[0], /site:instagram\.com/);
  assert.ok(queries.some((query) => query.includes("chinese restaurant") || query.includes("restaurant chinois")));
  assert.ok(queries.some((query) => query.includes("Sandton") || query.includes("sandton")));
  const loose = buildTargetAiLooseQueries({
    niche: "psychologue",
    locationLabel: "Johannesburg, Gauteng, South Africa",
    maxQueries: 8,
  });
  assert.ok(loose.every((query) => /instagram/i.test(query) && !/site:instagram\.com/.test(query)));
  const strict = buildTargetAiStrictComplementQueries({
    niche: "psychologue",
    locationLabel: "Johannesburg, Gauteng, South Africa",
    maxQueries: 4,
  });
  assert.ok(strict.every((query) => /site:instagram\.com/.test(query)));
});

test("manual benchmark queries expose strict and loose sets", async () => {
  const { buildTargetAiManualBenchmarkQueries } = await import("./target-ai-google-query-builder.ts");
  const jhb = buildTargetAiManualBenchmarkQueries({
    niche: "restaurant chinois",
    locationLabel: "Johannesburg",
  });
  assert.ok(jhb.loose.some((query) => query.includes("chinese restaurant")));
  assert.ok(jhb.strict.some((query) => query.includes("site:instagram.com")));
  const psycho = buildTargetAiManualBenchmarkQueries({
    niche: "psychologue",
    locationLabel: "Johannesburg",
  });
  assert.ok(psycho.loose.some((query) => query.includes("psychologist")));
  const belgium = buildTargetAiManualBenchmarkQueries({
    niche: "agence social media",
    locationLabel: "Belgique",
  });
  assert.ok(belgium.loose.join("\n").toLowerCase().includes("bruxelles") || belgium.loose.join("\n").toLowerCase().includes("brussels"));
  assert.ok(
    belgium.loose.join("\n").toLowerCase().includes("antwerp")
    || belgium.loose.join("\n").toLowerCase().includes("gent")
    || belgium.loose.join("\n").toLowerCase().includes("liege"),
  );
});

test("Belgium geocoding label expands to country city fan-out", async () => {
  const { normalizeTargetAiLocation } = await import("./target-ai-location-normalize.ts");
  const { buildTargetAiLooseQueries } = await import("./target-ai-google-query-builder.ts");
  const normalized = normalizeTargetAiLocation("België / Belgique / Belgien");
  const tokenKeys = normalized.tokens.map((token) => token.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, ""));
  assert.equal(normalized.kind, "country");
  assert.ok(tokenKeys.some((token) => token === "bruxelles" || token === "brussels"));
  assert.ok(tokenKeys.some((token) => token === "antwerp" || token === "antwerpen"));
  assert.ok(tokenKeys.some((token) => token === "gent"));
  const queries = buildTargetAiLooseQueries({
    niche: "agence social media",
    locationLabel: "België / Belgique / Belgien",
    maxQueries: 24,
  });
  assert.ok(queries.length >= 15);
  assert.ok(queries.some((query) => query.includes('"Bruxelles"') || query.includes('"Brussels"')));
  assert.doesNotMatch(queries.join("\n"), /België \/ Belgique \/ Belgien/);
});

test("wizard requires selected location when user typed a query", () => {
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  assert.match(wizardSource, /locationTypedWithoutSelection/);
  assert.match(wizardSource, /disabled=\{!canLaunchSearch\}/);
  assert.match(wizardSource, /locationSelectionRequired/);
});

test("runtime query plan is logged from V2 service", () => {
  const v2Source = source("./target-ai-search-v2-service.ts");
  assert.match(v2Source, /runtime_query_plan/);
  assert.match(v2Source, /buildTargetAiRuntimeQueryPlan/);
});

test("JHB chinese runtime uses harness-equivalent loose queries", async () => {
  const { buildTargetAiLooseQueries } = await import("./target-ai-google-query-builder.ts");
  const queries = buildTargetAiLooseQueries({
    niche: "restaurant chinois",
    locationLabel: "Johannesburg, City of Johannesburg Metropolitan Municipality, Gauteng, South Africa",
    maxQueries: 24,
  });
  assert.ok(queries.length >= 15);
  assert.ok(queries.some((query) => query.toLowerCase().includes('"johannesburg" "dim sum"')));
  assert.ok(queries.some((query) => query.toLowerCase().includes('"sandton" "dim sum"')));
  assert.ok(queries.some((query) => query.toLowerCase().includes('"rosebank" "asian restaurant"')));
});

test("SERP extractor accepts loose instagram username fallback when profile URL is absent", async () => {
  const { extractLooseSerpProfileFromOrganicRow } = await import("./target-ai-serp-extractor.ts");
  const candidate = extractLooseSerpProfileFromOrganicRow({
    row: {
      link: "https://example.com/listing",
      title: "Nice Halaal Restaurant in Cape Town",
      snippet: "Best dumplings in Johannesburg https://www.instagram.com/merakicoffeehouse_/",
    },
    sourceQuery: "test",
    position: 1,
  });
  assert.equal(candidate?.username, "merakicoffeehouse_");
  assert.equal(candidate?.extractionMode, "loose");
});

test("runtime_vs_harness_diff is logged from V2 service", () => {
  const v2Source = source("./target-ai-search-v2-service.ts");
  assert.match(v2Source, /runtime_vs_harness_diff/);
  assert.match(v2Source, /buildTargetAiRuntimeHarnessDiff/);
});

test("pending AI avatars skip proxy fetch until verified", () => {
  const avatarSource = source("../../app/instagram-client/TargetAvatar.tsx");
  assert.match(avatarSource, /shouldUseProxy/);
  assert.match(avatarSource, /avatarAvailable !== false/);
});

test("client copy never mentions Google, SearchAPI, SERP or Profil suggéré", () => {
  const copySource = source("./target-ai-copy.ts");
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  for (const blob of [copySource, wizardSource]) {
    assert.doesNotMatch(blob, /Google/i);
    assert.doesNotMatch(blob, /SearchAPI/i);
    assert.doesNotMatch(blob, /SERP/i);
    assert.doesNotMatch(blob, /via Google/i);
    assert.doesNotMatch(blob, /Profil suggéré/);
    assert.doesNotMatch(blob, /Suggested profile/);
  }
});

test("serialized AI candidates do not expose discovery source fields", async () => {
  const { serializeTargetAiCandidateForClient } = await import("./target-ai-candidate-avatar.ts");
  const serialized = serializeTargetAiCandidateForClient("acc-1", {
    username: "sample_user",
    followersCount: null,
    avatarUrl: null,
    avatarAvailable: false,
    eligible: false,
    ineligibleReasonCode: "pending_verification",
    profileUrl: "https://www.instagram.com/sample_user/",
    isVerified: null,
    isPrivate: null,
    verificationStatus: "pending",
    qualityStatus: "pending_verification",
    relevanceScore: 4,
    serpTitle: "Sample title",
    serpSnippet: "Sample snippet",
    serpSourceQuery: "secret query",
    serpPosition: 1,
  });
  assert.equal(serialized.displayTitle, "Sample title");
  assert.equal("serpSnippet" in serialized, false);
  assert.equal("serpSourceQuery" in serialized, false);
  assert.ok(String(serialized.avatarUrl).includes("ai-candidate/avatar"));
});

test("SERP extractor rejects candidates without profile URL username", async () => {
  const { extractSerpProfileFromOrganicRow } = await import("./target-ai-serp-extractor.ts");
  assert.equal(
    extractSerpProfileFromOrganicRow({
      row: {
        title: "Restaurant phone 012345",
        snippet: "Best food in town without instagram profile url",
      },
      sourceQuery: "x",
      position: 1,
    }),
    null,
  );
});

test("AI wizard validates selection with background verification only", () => {
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  const copySource = source("./target-ai-copy.ts");
  assert.match(copySource, /Valider la sélection/);
  assert.match(wizardSource, /validateSelection/);
  assert.doesNotMatch(wizardSource, /verifySelection/);
  assert.doesNotMatch(wizardSource, /serpSnippet/);
  assert.match(wizardSource, /ai-search\/verify/);
  assert.match(wizardSource, /enrichCandidates/);
});

test("google query builder includes Bordeaux asiatique loose variants", async () => {
  const { buildTargetAiLooseQueries } = await import("./target-ai-google-query-builder.ts");
  const queries = buildTargetAiLooseQueries({
    niche: "restaurant asiatique",
    locationLabel: "Bordeaux, Gironde, France",
    maxQueries: 12,
  });
  assert.ok(queries.some((query) => query.includes('"Bordeaux"') || query.includes('"bordeaux"')));
  assert.ok(queries.some((query) => query.includes("restaurant asiatique") || query.includes("restaurant japonais") || query.includes("ramen")));
  assert.ok(queries.some((query) => query.includes("Mérignac") || query.includes("Pessac")));
});

test("SERP extractor accepts profile URLs and rejects post paths", async () => {
  const { extractSerpProfileFromOrganicRow } = await import("./target-ai-serp-extractor.ts");
  const profile = extractSerpProfileFromOrganicRow({
    row: {
      link: "https://www.instagram.com/bordeaux.asian.kitchen/",
      title: "Bordeaux Asian Kitchen",
      snippet: "Restaurant asiatique à Bordeaux",
    },
    sourceQuery: '"Bordeaux" "restaurant asiatique" site:instagram.com',
    position: 1,
  });
  assert.equal(profile?.username, "bordeaux.asian.kitchen");
  assert.equal(
    extractSerpProfileFromOrganicRow({
      row: { link: "https://www.instagram.com/p/abc123/" },
      sourceQuery: "x",
      position: 2,
    }),
    null,
  );
});

test("SERP scorer demotes JHB chinese false positives below direct restaurants", async () => {
  const { rankSerpProfileCandidates } = await import("./target-ai-serp-score.ts");
  const locationLabel = "Johannesburg, City of Johannesburg Metropolitan Municipality, Gauteng, South Africa";
  const candidates = [
    {
      username: "notredameozanam",
      profileUrl: "https://www.instagram.com/notredameozanam/",
      title: "Centre scolaire Notre-Dame Ozanam Mâcon ...",
      snippet: "restaurant chinois ... De Johannesburg à Sydney",
      displayedLink: null,
      sourceQuery: '"johannesburg" "restaurant chinois" site:instagram.com',
      position: 1,
    },
    {
      username: "merakicoffeehouse_",
      profileUrl: "https://www.instagram.com/merakicoffeehouse_/",
      title: "Nice Halaal Restaurant in Cape Town",
      snippet: "Halaal Chinese Restaurant in Johannesburg",
      displayedLink: null,
      sourceQuery: '"johannesburg" "halaal chinese" instagram',
      position: 2,
    },
    {
      username: "basicallybedfordview",
      profileUrl: "https://www.instagram.com/basicallybedfordview/",
      title: "Basically Bedfordview (@basicallybedfordview)",
      snippet: "Best restaurants in Johannesburg",
      displayedLink: null,
      sourceQuery: '"johannesburg" "asian restaurant" instagram',
      position: 3,
    },
    {
      username: "dumplingdza",
      profileUrl: "https://www.instagram.com/dumplingdza/",
      title: "DumplingD (@dumplingdza) · Johannesburg",
      snippet: "Dim sum dumplings in Johannesburg",
      displayedLink: null,
      sourceQuery: '"johannesburg" "dumplings" instagram',
      position: 4,
    },
    {
      username: "lovemesojhb",
      profileUrl: "https://www.instagram.com/lovemesojhb/",
      title: "Love Me So (@lovemesojhb) · Johannesburg",
      snippet: "asian restaurant johannesburg",
      displayedLink: null,
      sourceQuery: '"johannesburg" "asian restaurant" instagram',
      position: 5,
    },
  ];
  const ranked = rankSerpProfileCandidates(candidates, "restaurant chinois", locationLabel);
  const top5 = ranked.slice(0, 5).map((row) => row.username);
  assert.ok(top5.includes("dumplingdza"));
  assert.ok(top5.includes("lovemesojhb"));
  assert.ok(top5.indexOf("dumplingdza") < top5.indexOf("notredameozanam"));
  assert.ok(top5.indexOf("lovemesojhb") < top5.indexOf("merakicoffeehouse_"));
  assert.ok(top5.indexOf("dumplingdza") < top5.indexOf("basicallybedfordview"));
});

test("SERP scorer matches bilingual psychologue and psychologist terms", async () => {
  const { rankSerpProfileCandidates } = await import("./target-ai-serp-score.ts");
  const ranked = rankSerpProfileCandidates([
    {
      username: "generic_news",
      profileUrl: "https://www.instagram.com/generic_news/",
      title: "City news",
      snippet: "Daily headlines",
      displayedLink: null,
      sourceQuery: '"Johannesburg" news instagram',
      position: 3,
    },
    {
      username: "drhananbushkin",
      profileUrl: "https://www.instagram.com/drhananbushkin/",
      title: "Clinical Psychologist Johannesburg",
      snippet: "Therapy and counselling in Sandton",
      displayedLink: null,
      sourceQuery: '"sandton" "psychologist" instagram',
      position: 2,
    },
  ], "psychologue", "Johannesburg, Gauteng, South Africa");
  assert.equal(ranked[0].username, "drhananbushkin");
  assert.equal(ranked[0].nicheHit, true);
  assert.equal(ranked[0].locHit, true);
});

test("V2 search service uses SearchAPI loose discovery with SERP client projection", () => {
  const serviceSource = source("./target-ai-search-service.ts");
  const v2Source = source("./target-ai-search-v2-service.ts");
  const discoverySource = source("./target-ai-google-serp-discovery.ts");
  const projectionSource = source("./target-ai-client-projection.ts");
  assert.match(serviceSource, /searchTargetAccountsWithAiV2/);
  assert.match(v2Source, /searchapi_loose_v21/);
  assert.match(v2Source, /runTargetAiGoogleSerpDiscovery/);
  assert.match(v2Source, /evaluateSerpClientProjection/);
  assert.match(v2Source, /pagesPerQuery/);
  assert.match(v2Source, /readTargetAiVerifyConcurrency/);
  assert.match(v2Source, /pendingToVerify/);
  assert.match(v2Source, /resolveTargetAiUiDiscoveryProfile/);
  assert.match(v2Source, /earlyStopCandidateCount/);
  assert.match(projectionSource, /evaluateSerpClientProjection/);
  assert.match(discoverySource, /pagesPerQuery/);
});

test("AI validation inserts selected usernames through existing CT bulk pipeline only", () => {
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  const targetsRoute = source("../../app/api/instagram-client/accounts/[accountId]/targets/route.ts");
  const targetsService = source("../instagram-dashboard/targets-service.ts");
  assert.match(wizardSource, /import_source: "ai_discovery"/);
  assert.match(wizardSource, /targets\/ai-search\/verify/);
  assert.match(wizardSource, /eligibleUsernames/);
  assert.match(targetsRoute, /addAccountTargetsBulk/);
  assert.match(targetsService, /tryEnqueueTargetVerificationJobs/);
  assert.doesNotMatch(wizardSource, /ig_targets/);
});

test("AI search verify route verifies selected usernames only", () => {
  const verifyRoute = source("../../app/api/instagram-client/accounts/[accountId]/targets/ai-search/verify/route.ts");
  assert.match(verifyRoute, /verifyTargetAiSessionUsernames/);
  assert.match(verifyRoute, /session_id/);
  assert.doesNotMatch(verifyRoute, /OPENAI_API_KEY/);
});

test("AI wizard shows only eligible and ineligible badges after analysis", () => {
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  assert.match(wizardSource, /ai-search\/verify/);
  assert.match(wizardSource, /validateSelection/);
  assert.match(wizardSource, /copy\.eligible/);
  assert.match(wizardSource, /copy\.ineligible/);
  assert.match(wizardSource, /analysisReady/);
  assert.doesNotMatch(wizardSource, /suggestedProfile/);
  assert.doesNotMatch(wizardSource, /verifySelection/);
});

test("SERP client projection marks obvious false positives as ineligible", async () => {
  const { evaluateSerpClientProjection } = await import("./target-ai-client-projection.ts");
  const locationLabel = "Johannesburg, City of Johannesburg Metropolitan Municipality, Gauteng, South Africa";
  const falsePositives = [
    {
      username: "notredameozanam",
      profileUrl: "https://www.instagram.com/notredameozanam/",
      title: "Centre scolaire Notre-Dame Ozanam Mâcon ...",
      snippet: "restaurant chinois ... De Johannesburg à Sydney",
      displayedLink: null,
      sourceQuery: '"johannesburg" "restaurant chinois" site:instagram.com',
      position: 1,
    },
    {
      username: "merakicoffeehouse_",
      profileUrl: "https://www.instagram.com/merakicoffeehouse_/",
      title: "Nice Halaal Restaurant in Cape Town",
      snippet: "Halaal Chinese Restaurant in Johannesburg",
      displayedLink: null,
      sourceQuery: '"johannesburg" "halaal chinese" instagram',
      position: 2,
    },
    {
      username: "eater_dc",
      profileUrl: "https://www.instagram.com/eater_dc/",
      title: "Eater DC (@eater_dc)",
      snippet: "Food news in Washington DC",
      displayedLink: null,
      sourceQuery: '"johannesburg" "restaurant chinois" instagram',
      position: 3,
    },
  ];
  for (const candidate of falsePositives) {
    const projection = evaluateSerpClientProjection({
      candidate,
      niche: "restaurant chinois",
      locationLabel,
    });
    assert.equal(projection.eligible, false);
    assert.equal(projection.needsProfileVerify, false);
    assert.equal(projection.verificationStatus, "found");
    assert.ok(["out_of_target", "out_of_location", "not_relevant"].includes(projection.reasonCode));
  }
});

test("Belgium location match accepts Brussels and national tokens for country search", async () => {
  const { hasTargetAiLocationHit, readTargetAiLocationMatchTerms } = await import("./target-ai-location-match.ts");
  const locationLabel = "België / Belgique / Belgien";
  const terms = readTargetAiLocationMatchTerms(locationLabel);
  assert.ok(terms.includes("brussels"));
  assert.ok(terms.includes("belgique"));
  assert.ok(hasTargetAiLocationHit({
    combined: "social media agency (@yourcommunicationsucks) · brussels",
    sourceQuery: '"Brussels" "agence social media" instagram',
    locationLabel,
  }));
  assert.ok(hasTargetAiLocationHit({
    combined: "clark influence (@clarkinfluence)",
    sourceQuery: '"Belgique" "social media agency" instagram',
    locationLabel,
  }));
});

test("Belgium SERP projection passes Brussels agencies to profile verification", async () => {
  const { evaluateSerpClientProjection } = await import("./target-ai-client-projection.ts");
  const locationLabel = "België / Belgique / Belgien";
  for (const candidate of [
    {
      username: "yourcommunicationsucks",
      profileUrl: "https://www.instagram.com/yourcommunicationsucks/",
      title: "Social Media Agency (@yourcommunicationsucks) · Brussels",
      snippet: "Agence social media",
      displayedLink: null,
      sourceQuery: '"Brussels" "agence social media" instagram',
      position: 1,
    },
    {
      username: "nuko.agency",
      profileUrl: "https://www.instagram.com/nuko.agency/",
      title: "Nuko Agency",
      snippet: "Digital agency Belgium",
      displayedLink: null,
      sourceQuery: '"Belgique" "digital agency" instagram',
      position: 2,
    },
    {
      username: "target4biz_agency",
      profileUrl: "https://www.instagram.com/target4biz_agency/",
      title: "Target4Biz Web Agency Brussels (@target4biz_agency)",
      snippet: "Brussels web agency",
      displayedLink: null,
      sourceQuery: '"Brussels" "digital agency" instagram',
      position: 3,
    },
  ]) {
    const projection = evaluateSerpClientProjection({
      candidate,
      niche: "agence social media",
      locationLabel,
    });
    assert.equal(projection.needsProfileVerify, true, candidate.username);
    assert.equal(projection.reasonCode, "pending_verification", candidate.username);
  }
});

test("provider errors map to unavailable not permanent rejection", async () => {
  const { evaluateAiTargetEligibility } = await import("./target-ai-eligibility.ts");
  assert.equal(
    evaluateAiTargetEligibility({ quality_status: "provider_error", verification_status: "rate_limited" }).reasonCode,
    "unavailable",
  );
  assert.equal(
    evaluateAiTargetEligibility({ quality_status: "provider_timeout", status: "rejected" }).reasonCode,
    "unavailable",
  );
});

test("google SERP discovery supports early stop and adaptive pages", () => {
  const discoverySource = source("./target-ai-google-serp-discovery.ts");
  assert.match(discoverySource, /earlyStopCandidateCount/);
  assert.match(discoverySource, /maxQueriesToExecute/);
  assert.match(discoverySource, /enough_candidates/);
  assert.match(discoverySource, /thirdPageMinCandidates/);
});

test("ai-search route rejects invalid location with 400 not 422", () => {
  const routeSource = source("../../app/api/instagram-client/accounts/[accountId]/targets/ai-search/route.ts");
  assert.match(routeSource, /buildTargetAiRuntimeQueryPlan/);
  assert.match(routeSource, /jsonTargetAiError\("invalid_location", 400\)/);
  assert.doesNotMatch(routeSource, /status: 422/);
});

test("wizard blocks launch when location text is not selected", () => {
  const wizardSource = source("../../app/instagram-client/ClientAiTargetSearchWizard.tsx");
  assert.match(wizardSource, /locationSelectionRequired/);
  assert.match(wizardSource, /locationTypedWithoutSelection/);
  assert.match(wizardSource, /canLaunchSearch/);
  assert.match(wizardSource, /locationQuery\.trim\(\)\.length >= 2 && !selectedLocation/);
});

test("SERP client projection keeps relevant restaurants pending profile verification", async () => {
  const { evaluateSerpClientProjection } = await import("./target-ai-client-projection.ts");
  const projection = evaluateSerpClientProjection({
    candidate: {
      username: "dumplingdza",
      profileUrl: "https://www.instagram.com/dumplingdza/",
      title: "DumplingD (@dumplingdza) · Johannesburg",
      snippet: "Dim sum dumplings in Johannesburg",
      displayedLink: null,
      sourceQuery: '"johannesburg" "dumplings" instagram',
      position: 1,
    },
    niche: "restaurant chinois",
    locationLabel: "Johannesburg, Gauteng, South Africa",
  });
  assert.equal(projection.needsProfileVerify, true);
  assert.equal(projection.reasonCode, "pending_verification");
});

test("verify concurrency is capped at 2 via env", async () => {
  const {
    readTargetAiProfileLookupConcurrency,
    readTargetAiVerifyConcurrency,
    readTargetAiVerifyLookupTimeoutMs,
    readTargetAiVerifyStaggerMs,
  } = await import("./target-ai-profile-verify.ts");
  assert.equal(readTargetAiProfileLookupConcurrency(8), 2);
  assert.equal(readTargetAiProfileLookupConcurrency(0), 1);
  const previous = process.env.TARGET_AI_VERIFY_CONCURRENCY;
  process.env.TARGET_AI_VERIFY_CONCURRENCY = "4";
  try {
    assert.equal(readTargetAiVerifyConcurrency(), 2);
  } finally {
    if (previous === undefined) delete process.env.TARGET_AI_VERIFY_CONCURRENCY;
    else process.env.TARGET_AI_VERIFY_CONCURRENCY = previous;
  }
  assert.ok(readTargetAiVerifyLookupTimeoutMs() >= 4000);
  assert.ok(readTargetAiVerifyLookupTimeoutMs() <= 10000);
  assert.equal(readTargetAiVerifyStaggerMs(2), 0);
});

test("verify batch uses bounded concurrency and session cache", () => {
  const serviceSource = source("./target-ai-search-v2-service.ts");
  assert.match(serviceSource, /readTargetAiVerifyConcurrency/);
  assert.match(serviceSource, /existingVerified/);
  assert.match(serviceSource, /duplicateSkipped/);
  assert.match(serviceSource, /concurrency: verifyConcurrency/);
});

test("profile lookup timeout returns unavailable not crash", async () => {
  const { lookupInstagramPublicProfile } = await import("../instagram-public-profile-lookup.ts");
  const envKeys = [
    "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER",
    "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL",
    "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY",
    "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MIN_INTERVAL_MS",
    "INSTAGRAM_PUBLIC_PROFILE_LOOKUP_CACHE_TTL_ERROR_SECONDS",
  ];
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER = "searchapi";
  process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL = "https://searchapi.example.test/api/v1/search";
  process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY = "test-provider-key";
  process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_MIN_INTERVAL_MS = "0";
  process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_CACHE_TTL_ERROR_SECONDS = "0";
  try {
    const result = await lookupInstagramPublicProfile("timeout_probe_user", {
      timeoutMs: 1,
      disableCache: true,
      fetcher: async (_url, init) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return new Response(JSON.stringify({}), { status: 200 });
      },
      now: () => new Date("2026-06-15T12:00:00.000Z"),
    });
    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "provider_timeout");
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("rate_limited verification_status stays unavailable not rejected", async () => {
  const { evaluateAiTargetEligibility } = await import("./target-ai-eligibility.ts");
  const unavailable = evaluateAiTargetEligibility({
    quality_status: "review_provider_unavailable",
    verification_status: "rate_limited",
    status: "rejected",
  });
  assert.equal(unavailable.reasonCode, "unavailable");
  assert.equal(unavailable.eligible, false);
});

test("local food niche uses 300 follower threshold in Target AI eligibility only", async () => {
  const {
    evaluateAiTargetEligibility,
    resolveTargetAiMinFollowers,
    isTargetAiLocalFoodNiche,
    TARGET_AI_LOCAL_FOOD_MIN_FOLLOWERS,
  } = await import("./target-ai-eligibility.ts");
  const { CT_QUALITY_MIN_FOLLOWERS } = await import("../instagram-target-quality.ts");

  assert.equal(TARGET_AI_LOCAL_FOOD_MIN_FOLLOWERS, 300);
  assert.equal(resolveTargetAiMinFollowers("restaurant chinois"), 300);
  assert.equal(resolveTargetAiMinFollowers("agence social media"), CT_QUALITY_MIN_FOLLOWERS);
  assert.equal(isTargetAiLocalFoodNiche("restaurant asiatique"), true);
  assert.equal(isTargetAiLocalFoodNiche("psychologue"), false);

  const restaurantBase = {
    niche: "restaurant chinois",
    locHit: true,
    nicheHit: true,
    quality_status: "rejected_low_followers",
    status: "rejected",
    verification_status: "found",
    is_verified: false,
    is_private: false,
  };

  assert.deepEqual(
    evaluateAiTargetEligibility({ ...restaurantBase, followers_count: 433 }),
    { eligible: true, reasonCode: null },
  );
  assert.deepEqual(
    evaluateAiTargetEligibility({ ...restaurantBase, followers_count: 356 }),
    { eligible: true, reasonCode: null },
  );
  assert.deepEqual(
    evaluateAiTargetEligibility({ ...restaurantBase, followers_count: 265 }),
    { eligible: false, reasonCode: "low_followers" },
  );
  assert.deepEqual(
    evaluateAiTargetEligibility({ ...restaurantBase, followers_count: 146 }),
    { eligible: false, reasonCode: "low_followers" },
  );

  assert.deepEqual(
    evaluateAiTargetEligibility({
      niche: "agence social media",
      locHit: true,
      nicheHit: true,
      quality_status: "rejected_low_followers",
      status: "rejected",
      verification_status: "found",
      followers_count: 433,
    }),
    { eligible: false, reasonCode: "low_followers" },
  );

  assert.deepEqual(
    evaluateAiTargetEligibility({
      ...restaurantBase,
      followers_count: 433,
      is_verified: true,
    }),
    { eligible: false, reasonCode: "verified" },
  );
  assert.deepEqual(
    evaluateAiTargetEligibility({
      ...restaurantBase,
      followers_count: 433,
      is_private: true,
    }),
    { eligible: false, reasonCode: "private" },
  );
  assert.deepEqual(
    evaluateAiTargetEligibility({
      ...restaurantBase,
      followers_count: 433,
      locHit: false,
    }),
    { eligible: false, reasonCode: "rejected" },
  );
  assert.deepEqual(
    evaluateAiTargetEligibility({
      ...restaurantBase,
      followers_count: 433,
      nicheHit: false,
    }),
    { eligible: false, reasonCode: "rejected" },
  );
  assert.deepEqual(
    evaluateAiTargetEligibility({
      ...restaurantBase,
      followers_count: 433,
      quality_status: "rejected_out_of_location",
    }),
    { eligible: false, reasonCode: "out_of_location" },
  );
  assert.deepEqual(
    evaluateAiTargetEligibility({
      ...restaurantBase,
      followers_count: 433,
      quality_status: "rejected_out_of_target",
    }),
    { eligible: false, reasonCode: "out_of_target" },
  );
});
