#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resetInstagramPublicProfileLookupGuardsForTests } from "../lib/instagram-public-profile-lookup.ts";
import { extractSerpProfileFromOrganicRow } from "../lib/instagram-client/target-ai-serp-extractor.ts";
import {
  extractInstagramUsernameFromUrl,
  extractInstagramUsernamesFromSearchResult,
} from "../lib/instagram-client/target-ai-instagram-url.ts";
import { rankSerpProfileCandidates } from "../lib/instagram-client/target-ai-serp-score.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const NICHE_CASES = {
  johannesburg_chinese: {
    id: "A",
    key: "johannesburg_chinese",
    niche: "restaurant chinois",
    locationLabel: "Johannesburg, Gauteng, South Africa",
    strictQueries: [
      '"johannesburg" "restaurant" "chinois" "site internet" site:instagram.com -inurl:/p/ -inurl:explore',
      '"johannesburg" "restaurant chinois" site:instagram.com -inurl:/p/ -inurl:explore',
      '"johannesburg" "chinese restaurant" site:instagram.com -inurl:/p/ -inurl:explore',
      '"johannesburg" "chinese food" site:instagram.com -inurl:/p/ -inurl:explore',
    ],
    looseQueries: [
      '"johannesburg" "chinese restaurant" instagram',
      '"johannesburg" "chinese takeaway" instagram',
      '"sandton" "chinese restaurant" instagram',
      '"rosebank" "chinese restaurant" instagram',
    ],
  },
  bordeaux_asian: {
    id: "B",
    key: "bordeaux_asian",
    niche: "restaurant asiatique",
    locationLabel: "Bordeaux, Gironde, France",
    strictQueries: [
      '"bordeaux" "restaurant" "asiatique" "site internet" site:instagram.com -inurl:/p/ -inurl:explore',
      '"bordeaux" "restaurant asiatique" site:instagram.com -inurl:/p/ -inurl:explore',
      '"bordeaux" "restaurant chinois" site:instagram.com -inurl:/p/ -inurl:explore',
      '"bordeaux" "ramen" site:instagram.com -inurl:/p/ -inurl:explore',
    ],
    looseQueries: [
      '"bordeaux" "restaurant asiatique" instagram',
      '"bordeaux" "restaurant japonais" instagram',
      '"merignac" "restaurant asiatique" instagram',
      '"pessac" "restaurant asiatique" instagram',
    ],
  },
  johannesburg_psy: {
    id: "C",
    key: "johannesburg_psy",
    niche: "psychologue",
    locationLabel: "Johannesburg, Gauteng, South Africa",
    strictQueries: [
      '"johannesburg" "psychologist" "site internet" site:instagram.com -inurl:/p/ -inurl:explore',
      '"johannesburg" "clinical psychologist" site:instagram.com -inurl:/p/ -inurl:explore',
      '"johannesburg" "therapy" site:instagram.com -inurl:/p/ -inurl:explore',
      '"johannesburg" "counselling" site:instagram.com -inurl:/p/ -inurl:explore',
    ],
    looseQueries: [
      '"johannesburg" "psychologist" instagram',
      '"sandton" "psychologist" instagram',
      '"rosebank" "psychologist" instagram',
      '"randburg" "therapy" instagram',
    ],
  },
  belgium_smma: {
    id: "D",
    key: "belgium_smma",
    niche: "agence social media",
    locationLabel: "Belgique",
    strictQueries: [
      '"belgique" "agence social media" site:instagram.com -inurl:/p/ -inurl:explore',
      '"belgium" "social media agency" site:instagram.com -inurl:/p/ -inurl:explore',
      '"bruxelles" "agence social media" site:instagram.com -inurl:/p/ -inurl:explore',
      '"brussels" "social media agency" site:instagram.com -inurl:/p/ -inurl:explore',
    ],
    looseQueries: [
      '"belgique" "agence social media" instagram',
      '"bruxelles" "social media agency" instagram',
      '"antwerp" "social media agency" instagram',
      '"gent" "marketing agency" instagram',
    ],
  },
};

const PROVIDER_ENV = {
  searchapi: {
    keys: ["INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY", "TARGET_AI_SEARCHAPI_KEY"],
    label: "SearchAPI Google",
  },
  serper: {
    keys: ["SERPER_API_KEY", "TARGET_AI_SERPER_API_KEY"],
    label: "Serper.dev",
  },
  serpapi: {
    keys: ["SERPAPI_API_KEY", "TARGET_AI_SERPAPI_KEY"],
    label: "SerpApi",
  },
  bing: {
    keys: ["BING_SEARCH_API_KEY", "AZURE_BING_SEARCH_KEY", "TARGET_AI_BING_API_KEY"],
    label: "Bing Web Search",
  },
};

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(ROOT, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // ignore missing env file
  }
}

function parseArgs(argv) {
  const options = {
    provider: "searchapi",
    pages: 2,
    json: null,
    niche: null,
    delayMs: 450,
    verbose: true,
  };
  for (const arg of argv) {
    if (arg.startsWith("--provider=")) options.provider = arg.slice("--provider=".length).trim().toLowerCase();
    else if (arg.startsWith("--pages=")) options.pages = Math.max(1, Number.parseInt(arg.slice("--pages=".length), 10) || 1);
    else if (arg.startsWith("--json=")) options.json = arg.slice("--json=".length).trim();
    else if (arg.startsWith("--niche=")) options.niche = arg.slice("--niche=".length).trim();
    else if (arg.startsWith("--delay-ms=")) options.delayMs = Math.max(0, Number.parseInt(arg.slice("--delay-ms=".length), 10) || 450);
    else if (arg === "--quiet") options.verbose = false;
  }
  return options;
}

function readProviderApiKey(provider) {
  const config = PROVIDER_ENV[provider];
  if (!config) return null;
  for (const key of config.keys) {
    const value = process.env[key]?.trim();
    if (value) return { keyName: key, value };
  }
  return null;
}

function readOrganicResults(payload, provider) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const record = payload;
  const buckets = [
    record.organic_results,
    record.results,
    record.items,
    record.webPages?.value,
    record.organic,
  ];
  for (const entry of buckets) {
    if (!Array.isArray(entry)) continue;
    return entry.filter((row) => row && typeof row === "object").map((row) => normalizeOrganicRow(row, provider));
  }
  return [];
}

function normalizeOrganicRow(row, provider) {
  if (provider === "bing") {
    return {
      link: row.url ?? row.link ?? "",
      displayed_link: row.displayUrl ?? row.displayed_link ?? "",
      title: row.name ?? row.title ?? "",
      snippet: row.snippet ?? "",
    };
  }
  if (provider === "serper") {
    return {
      link: row.link ?? "",
      displayed_link: row.link ?? "",
      title: row.title ?? "",
      snippet: row.snippet ?? "",
    };
  }
  return {
    link: row.link ?? row.url ?? "",
    displayed_link: row.displayed_link ?? row.displayedLink ?? row.displayUrl ?? "",
    title: row.title ?? row.name ?? "",
    snippet: row.snippet ?? row.description ?? "",
  };
}

function isInstagramUrl(value) {
  return /instagram\.com/i.test(value || "");
}

function isProfileInstagramUrl(value) {
  return Boolean(extractInstagramUsernameFromUrl(String(value || "")));
}

function analyzeRow(row, sourceQuery) {
  const link = row.link ?? "";
  const displayed = row.displayed_link ?? "";
  const title = row.title ?? "";
  const snippet = row.snippet ?? "";
  const combined = `${link} ${displayed} ${title} ${snippet}`;
  const hasInstagram = isInstagramUrl(combined);
  const profileFromStrict = extractSerpProfileFromOrganicRow({ row, sourceQuery, position: 0 });
  const looseUsernames = extractInstagramUsernamesFromSearchResult(row);
  let rejectionReason = null;
  if (!hasInstagram) rejectionReason = "no_instagram_url";
  else if (!profileFromStrict && looseUsernames.length === 0) rejectionReason = "instagram_non_profile_url";
  else if (!profileFromStrict && looseUsernames.length > 0) rejectionReason = "strict_extractor_rejected_loose_found";
  return {
    link,
    title,
    snippet,
    hasInstagram,
    isProfileUrl: isProfileInstagramUrl(link) || isProfileInstagramUrl(displayed),
    strictProfile: profileFromStrict,
    looseUsernames,
    rejectionReason,
  };
}

async function fetchSearchApiPage(query, page) {
  const endpoint = process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_URL?.trim()
    || process.env.TARGET_AI_DISCOVERY_SEARCH_URL?.trim()
    || "https://www.searchapi.io/api/v1/search";
  const apiKey = readProviderApiKey("searchapi")?.value ?? "";
  if (!apiKey) return { ok: false, reason: "missing_api_key", payload: null };
  const url = new URL(endpoint);
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  if (page > 1) url.searchParams.set("page", String(page));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url.toString(), { method: "GET", cache: "no-store", signal: controller.signal });
    if (response.status === 429) return { ok: false, status: 429, payload: null, reason: "rate_limited" };
    if (!response.ok) return { ok: false, status: response.status, payload: null, reason: `provider_http_${response.status}` };
    return { ok: true, status: response.status, payload: await response.json(), reason: "ok" };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_error";
    return { ok: false, status: 0, payload: null, reason };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSerperPage(query, page, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({ q: query, page }),
      signal: controller.signal,
    });
    if (response.status === 429) return { ok: false, status: 429, payload: null, reason: "rate_limited" };
    if (!response.ok) return { ok: false, status: response.status, payload: null, reason: `provider_http_${response.status}` };
    return { ok: true, status: response.status, payload: await response.json(), reason: "ok" };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_error";
    return { ok: false, status: 0, payload: null, reason };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSerpApiPage(query, page, apiKey) {
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", apiKey);
  if (page > 1) url.searchParams.set("start", String((page - 1) * 10));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (response.status === 429) return { ok: false, status: 429, payload: null, reason: "rate_limited" };
    if (!response.ok) return { ok: false, status: response.status, payload: null, reason: `provider_http_${response.status}` };
    return { ok: true, status: response.status, payload: await response.json(), reason: "ok" };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_error";
    return { ok: false, status: 0, payload: null, reason };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBingPage(query, page, apiKey) {
  const url = new URL("https://api.bing.microsoft.com/v7.0/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", "10");
  if (page > 1) url.searchParams.set("offset", String((page - 1) * 10));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url.toString(), {
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
      signal: controller.signal,
    });
    if (response.status === 429) return { ok: false, status: 429, payload: null, reason: "rate_limited" };
    if (!response.ok) return { ok: false, status: response.status, payload: null, reason: `provider_http_${response.status}` };
    return { ok: true, status: response.status, payload: await response.json(), reason: "ok" };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "provider_timeout" : "provider_error";
    return { ok: false, status: 0, payload: null, reason };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchProviderPage(provider, query, page) {
  if (provider === "searchapi") return fetchSearchApiPage(query, page);
  const apiKey = readProviderApiKey(provider)?.value;
  if (!apiKey) return { ok: false, reason: "missing_api_key", payload: null };
  if (provider === "serper") return fetchSerperPage(query, page, apiKey);
  if (provider === "serpapi") return fetchSerpApiPage(query, page, apiKey);
  if (provider === "bing") return fetchBingPage(query, page, apiKey);
  return { ok: false, reason: "unknown_provider", payload: null };
}

async function fetchQueryPaginated(provider, query, pages) {
  const organicByLink = new Map();
  const pageResults = [];
  let lastReason = null;
  let throttled = 0;
  let errors = 0;

  for (let page = 1; page <= pages; page += 1) {
    const response = await fetchProviderPage(provider, query, page);
    pageResults.push({
      page,
      ok: response.ok,
      reason: response.reason ?? null,
      organic_count: response.ok ? readOrganicResults(response.payload, provider).length : 0,
    });
    if (!response.ok) {
      lastReason = response.reason || `http_${response.status}`;
      if (lastReason.includes("thrott") || lastReason.includes("rate")) throttled += 1;
      else errors += 1;
      break;
    }
    for (const row of readOrganicResults(response.payload, provider)) {
      const key = (row.link || row.title || "").trim().toLowerCase();
      if (!key || organicByLink.has(key)) continue;
      organicByLink.set(key, row);
    }
    if (page < pages) await sleep(450);
  }

  return {
    ok: organicByLink.size > 0 || pageResults.every((entry) => entry.ok),
    reason: organicByLink.size > 0 ? null : lastReason,
    organic: [...organicByLink.values()],
    pages: pageResults,
    throttled,
    errors,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function benchmarkOrganicRows(rows, query, niche, locationLabel, queryMode) {
  const seen = new Set();
  const extracted = [];
  const rejectionsByReason = {};
  let instagramUrls = 0;
  let profileUrls = 0;
  let rejectedNonProfile = 0;

  rows.forEach((row, index) => {
    const analysis = analyzeRow(row, query);
    if (analysis.hasInstagram) instagramUrls += 1;
    if (analysis.isProfileUrl) profileUrls += 1;
    if (analysis.strictProfile) {
      if (!seen.has(analysis.strictProfile.username)) {
        seen.add(analysis.strictProfile.username);
        extracted.push({
          username: analysis.strictProfile.username,
          profileUrl: analysis.strictProfile.profileUrl,
          title: analysis.strictProfile.title,
          snippet: analysis.strictProfile.snippet,
          sourceQuery: query,
          position: index + 1,
          mode: "strict",
        });
      }
    } else if (analysis.looseUsernames.length > 0) {
      for (const username of analysis.looseUsernames) {
        if (seen.has(username)) continue;
        seen.add(username);
        extracted.push({
          username,
          profileUrl: `https://www.instagram.com/${username}/`,
          title: row.title ?? null,
          snippet: row.snippet ?? null,
          sourceQuery: query,
          position: index + 1,
          mode: "loose",
        });
      }
    } else if (analysis.hasInstagram) {
      rejectedNonProfile += 1;
      const reason = analysis.rejectionReason || "unknown";
      rejectionsByReason[reason] = (rejectionsByReason[reason] || 0) + 1;
    }
  });

  const ranked = rankSerpProfileCandidates(
    extracted.map((row) => ({
      username: row.username,
      profileUrl: row.profileUrl,
      title: row.title,
      snippet: row.snippet,
      displayedLink: null,
      sourceQuery: row.sourceQuery,
      position: row.position,
    })),
    niche,
    locationLabel,
  ).map((row) => ({
    username: row.username,
    profileUrl: row.profileUrl,
    title: row.title,
    snippet: row.snippet,
    score: row.serpScore,
    locHit: row.locHit,
    nicheHit: row.nicheHit,
    relevant: Boolean(row.locHit && row.nicheHit),
    sourceQuery: row.sourceQuery,
    mode: extracted.find((entry) => entry.username === row.username)?.mode ?? "unknown",
  }));

  return {
    query,
    queryMode,
    organic_results_count: rows.length,
    instagram_urls_count: instagramUrls,
    profile_urls_count: profileUrls,
    rejected_non_profile_count: rejectedNonProfile,
    extracted_usernames_count: ranked.length,
    relevant_usernames_count: ranked.filter((row) => row.relevant).length,
    duplicate_count: Math.max(extracted.length - seen.size, 0),
    rejections_by_reason: rejectionsByReason,
    top20: ranked.slice(0, 20),
  };
}

async function benchmarkQuery(provider, query, queryMode, niche, locationLabel, pages) {
  const started = Date.now();
  const fetched = await fetchQueryPaginated(provider, query, pages);
  const durationMs = Date.now() - started;
  if (!fetched.ok && fetched.organic.length === 0) {
    return {
      query,
      queryMode,
      ok: false,
      reason: fetched.reason,
      duration_ms: durationMs,
      pages_fetched: fetched.pages,
      throttled_pages: fetched.throttled,
      organic_results_count: 0,
      instagram_urls_count: 0,
      profile_urls_count: 0,
      rejected_non_profile_count: 0,
      extracted_usernames_count: 0,
      relevant_usernames_count: 0,
      duplicate_count: 0,
      rejections_by_reason: {},
      top20: [],
    };
  }
  const metrics = benchmarkOrganicRows(fetched.organic, query, niche, locationLabel, queryMode);
  return {
    ...metrics,
    ok: true,
    reason: fetched.reason,
    duration_ms: durationMs,
    pages_fetched: fetched.pages,
    throttled_pages: fetched.throttled,
  };
}

function summarizeQueryResults(results) {
  const totals = results.reduce((acc, row) => {
    acc.organic += row.organic_results_count || 0;
    acc.instagram += row.instagram_urls_count || 0;
    acc.profile += row.profile_urls_count || 0;
    acc.rejected += row.rejected_non_profile_count || 0;
    acc.extracted += row.extracted_usernames_count || 0;
    acc.relevant += row.relevant_usernames_count || 0;
    acc.failed += row.ok ? 0 : 1;
    acc.duration += row.duration_ms || 0;
    acc.throttled += row.throttled_pages || 0;
    for (const [reason, count] of Object.entries(row.rejections_by_reason || {})) {
      acc.rejections[reason] = (acc.rejections[reason] || 0) + count;
    }
    return acc;
  }, {
    organic: 0,
    instagram: 0,
    profile: 0,
    rejected: 0,
    extracted: 0,
    relevant: 0,
    failed: 0,
    duration: 0,
    throttled: 0,
    rejections: {},
  });

  const byUsername = new Map();
  for (const row of results) {
    for (const candidate of row.top20 ?? []) {
      const existing = byUsername.get(candidate.username);
      if (!existing || candidate.score > existing.score) byUsername.set(candidate.username, candidate);
    }
  }
  const ranked = [...byUsername.values()].sort((left, right) => right.score - left.score);

  return {
    query_count: results.length,
    failed_queries: totals.failed,
    throttled_pages: totals.throttled,
    duration_ms: totals.duration,
    organic_results_count: totals.organic,
    instagram_urls_count: totals.instagram,
    profile_urls_count: totals.profile,
    rejected_non_profile_count: totals.rejected,
    extracted_usernames_unique: ranked.length,
    relevant_usernames_unique: ranked.filter((row) => row.relevant).length,
    rejections_by_reason: totals.rejections,
    top20: ranked.slice(0, 20),
    per_query: results,
  };
}

async function runNicheCase(provider, testCase, pages, delayMs) {
  const strictResults = [];
  for (const query of testCase.strictQueries) {
    strictResults.push(await benchmarkQuery(provider, query, "strict", testCase.niche, testCase.locationLabel, pages));
    await sleep(delayMs);
  }
  const looseResults = [];
  for (const query of testCase.looseQueries) {
    looseResults.push(await benchmarkQuery(provider, query, "loose", testCase.niche, testCase.locationLabel, pages));
    await sleep(delayMs);
  }
  return {
    id: testCase.id,
    key: testCase.key,
    niche: testCase.niche,
    locationLabel: testCase.locationLabel,
    strict: summarizeQueryResults(strictResults),
    loose: summarizeQueryResults(looseResults),
  };
}

function printNicheReport(report, provider, pages) {
  console.log(`\n${"=".repeat(80)}`);
  console.log(`NICHE ${report.key} (${report.niche} + ${report.locationLabel})`);
  console.log(`provider=${provider} pages=${pages}`);
  console.log("=".repeat(80));
  for (const mode of ["strict", "loose"]) {
    const block = report[mode];
    console.log(`\n--- ${mode.toUpperCase()} ---`);
    console.log(`queries=${block.query_count} failed=${block.failed_queries} throttled_pages=${block.throttled_pages} duration_ms=${block.duration_ms}`);
    console.log(`organic=${block.organic_results_count} ig_urls=${block.instagram_urls_count} profile_urls=${block.profile_urls_count}`);
    console.log(`rejected=${block.rejected_non_profile_count} extracted_unique=${block.extracted_usernames_unique} relevant_unique=${block.relevant_usernames_unique}`);
    console.log(`rejections=${JSON.stringify(block.rejections_by_reason)}`);
    console.log("top20:");
    for (const [index, candidate] of block.top20.entries()) {
      console.log(`  ${index + 1}. @${candidate.username} score=${candidate.score} loc=${candidate.locHit} niche=${candidate.nicheHit} mode=${candidate.mode}`);
      if (candidate.title) console.log(`     title: ${String(candidate.title).slice(0, 100)}`);
    }
  }
  const strictRel = report.strict.relevant_usernames_unique;
  const looseRel = report.loose.relevant_usernames_unique;
  console.log(`\ncomparison: loose relevant > strict relevant => ${looseRel > strictRel ? "YES" : "NO"} (${looseRel} vs ${strictRel})`);
}

async function main() {
  loadEnvLocal();
  const options = parseArgs(process.argv.slice(2));
  const provider = options.provider;
  if (!PROVIDER_ENV[provider]) {
    console.error(`Unknown provider: ${provider}`);
    process.exit(1);
  }

  const apiKeyInfo = readProviderApiKey(provider);
  if (!apiKeyInfo) {
    console.error(`Missing API key for provider ${provider}. Expected one of: ${PROVIDER_ENV[provider].keys.join(", ")}`);
    process.exit(1);
  }

  resetInstagramPublicProfileLookupGuardsForTests();

  const selectedCases = options.niche
    ? [NICHE_CASES[options.niche]].filter(Boolean)
    : Object.values(NICHE_CASES);

  if (selectedCases.length === 0) {
    console.error(`Unknown niche key: ${options.niche}. Available: ${Object.keys(NICHE_CASES).join(", ")}`);
    process.exit(1);
  }

  const startedAt = Date.now();
  const reports = [];
  for (const testCase of selectedCases) {
    reports.push(await runNicheCase(provider, testCase, options.pages, options.delayMs));
    if (options.verbose) printNicheReport(reports[reports.length - 1], provider, options.pages);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    provider,
    provider_label: PROVIDER_ENV[provider].label,
    pages: options.pages,
    duration_ms: Date.now() - startedAt,
    api_key_env: apiKeyInfo.keyName,
    missing_providers: Object.fromEntries(
      Object.entries(PROVIDER_ENV)
        .filter(([name]) => name !== provider)
        .map(([name, config]) => [name, readProviderApiKey(name) ? "available" : `missing (${config.keys.join(" | ")})`]),
    ),
    reports,
  };

  const outDir = join(ROOT, "runs");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, options.json || `target-ai-benchmark-${provider}-p${options.pages}-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.json`);
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`\nSaved: ${outPath}`);
  console.log(`Total duration: ${payload.duration_ms}ms`);
}

await main();
