#!/usr/bin/env node
/**
 * Local UI-path validation for Target AI V2.1 (prod fan-out, no UI patch).
 * Calls searchTargetAccountsWithAiV2 — same entrypoint as POST .../targets/ai-search.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTargetAiRuntimeQueryPlan } from "../lib/instagram-client/target-ai-query-plan.ts";
import { resetTargetAiDiscoverySessionsForTests } from "../lib/instagram-client/target-ai-discovery-session.ts";
import { resetInstagramPublicProfileLookupGuardsForTests } from "../lib/instagram-public-profile-lookup.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ACCOUNT_ID = "83de9cc9-5c37-42d1-9edc-c924352b17b1";

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
    // ignore
  }
}

const CASES = [
  { id: "A", niche: "restaurant asiatique", locationLabel: "Bordeaux, Nouvelle-Aquitaine, France métropolitaine, France" },
  { id: "B", niche: "restaurant chinois", locationLabel: "Johannesburg, City of Johannesburg Metropolitan Municipality, Gauteng, South Africa" },
  { id: "C", niche: "psychologue", locationLabel: "Johannesburg, City of Johannesburg Metropolitan Municipality, Gauteng, South Africa" },
  { id: "D", niche: "agence social media", locationLabel: "België / Belgique / Belgien" },
];

function splitQueryModes(niche, locationLabel, maxQueries) {
  const plan = buildTargetAiRuntimeQueryPlan({ niche, locationLabel, maxQueries });
  return {
    loose_queries_count: plan.loose_queries_count,
    strict_queries_count: plan.strict_queries_count,
    total_queries_planned: plan.total_queries_count,
    location_kind: plan.locationKind,
    location_tokens: plan.locationTokens,
    queries: plan.queries,
    query_plan: plan,
  };
}

function manualRelevanceEstimate(niche, candidates) {
  const top10 = candidates.slice(0, 10);
  const nicheLower = niche.toLowerCase();
  const psych = /psycholog|therapy|therapist|counsel|mental|psycho/i;
  const food = /restaurant|chinese|asian|ramen|sushi|kitchen|food|bistro|izakaya|thai/i;
  const smma = /social media|marketing|agency|agence|digital|community/i;
  let relevant = 0;
  for (const row of top10) {
    const blob = `${row.username} ${row.serpTitle || ""} ${row.serpSnippet || ""}`.toLowerCase();
    if (nicheLower.includes("psycholog") && psych.test(blob)) relevant += 1;
    else if (nicheLower.includes("restaurant") && food.test(blob)) relevant += 1;
    else if (nicheLower.includes("social media") && smma.test(blob)) relevant += 1;
    else if (blob.includes(nicheLower.split(" ")[0])) relevant += 1;
  }
  return { top10_relevant_estimate: relevant, top10_total: top10.length };
}

async function runCase(testCase, searchFn) {
  resetTargetAiDiscoverySessionsForTests();
  resetInstagramPublicProfileLookupGuardsForTests();

  const queryInfo = splitQueryModes(testCase.niche, testCase.locationLabel, 24);
  const started = Date.now();

  const result = await searchFn({
    accountId: ACCOUNT_ID,
    niche: testCase.niche,
    location: { label: testCase.locationLabel, lat: 0, lon: 0 },
  });

  const latencyMs = Date.now() - started;
  const candidates = result.candidates ?? [];
  const top20 = candidates.slice(0, 20).map((row) => ({
    username: row.username,
    score: row.relevanceScore,
    title: row.serpTitle,
    verificationStatus: row.verificationStatus,
    eligible: row.eligible,
    ineligibleReasonCode: row.ineligibleReasonCode,
  }));
  const eligibleCandidates = candidates.filter((row) => row.eligible);
  const ineligibleCandidates = candidates.filter((row) => row.verificationStatus === "found" && !row.eligible);
  const pendingCandidates = candidates.filter((row) => row.verificationStatus === "pending");

  const scores = candidates.map((row) => row.relevanceScore ?? 0);
  const looseExtracted = candidates.filter((row) => !String(row.serpSourceQuery || "").includes("site:instagram.com")).length;
  const strictExtracted = candidates.filter((row) => String(row.serpSourceQuery || "").includes("site:instagram.com")).length;

  const report = {
    case_id: testCase.id,
    niche: testCase.niche,
    locationLabel: testCase.locationLabel,
    mode: result.mode,
    status: result.status,
    query_plan: queryInfo.query_plan,
    location_kind: queryInfo.location_kind,
    location_tokens: queryInfo.location_tokens,
    strict_queries_count: queryInfo.strict_queries_count,
    total_queries_planned: queryInfo.total_queries_planned,
    total_queries_executed: result.debug?.searchapi_discovery_queries_count ?? null,
    pages_per_query: Number(process.env.TARGET_AI_V2_SERP_PAGES || 3),
    organic_results_scanned: null,
    extracted_usernames_count: result.suggested_count ?? result.debug?.extracted_usernames_count,
    displayed_count: result.candidates?.length ?? result.debug?.displayed_count,
    session_candidates_count: result.suggested_count,
    session_id: result.session_id,
    auto_verified_count: result.verified_count ?? 0,
    latency_ms: result.debug?.latency_ms ?? latencyMs,
    stopped_reason: result.debug?.stopped_reason,
    loose_extracted_usernames_count: looseExtracted,
    strict_extracted_usernames_count: strictExtracted,
    score_top: scores.length ? Math.max(...scores) : null,
    score_bottom: scores.length ? Math.min(...scores) : null,
    top20,
    eligible_count: eligibleCandidates.length,
    ineligible_count: ineligibleCandidates.length,
    pending_count: pendingCandidates.length,
    top10_eligible: eligibleCandidates.slice(0, 10).map((row) => row.username),
    ineligible_examples: ineligibleCandidates.slice(0, 10).map((row) => ({
      username: row.username,
      reason: row.ineligibleReasonCode,
      title: row.serpTitle,
    })),
    manual_relevance: manualRelevanceEstimate(testCase.niche, candidates),
    search_completed: {
      event: "search_completed",
      mode: result.mode,
      session_id: result.session_id,
      serp_candidates: result.suggested_count,
      displayed_count: candidates.length,
      auto_verified_count: result.verified_count ?? 0,
      auto_verify_attempted: result.debug?.max_searchapi_checks ?? 0,
      profile_found_count: result.debug?.profile_found_count ?? 0,
      profile_rate_limited_count: result.debug?.profile_rate_limited_count ?? 0,
      latency_ms: result.debug?.latency_ms ?? latencyMs,
      stopped_reason: result.debug?.stopped_reason,
    },
  };

  console.log("\n[Target AI search V2] search_completed", JSON.stringify(report.search_completed, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return report;
}

async function main() {
  loadEnvLocal();
  const caseArg = process.argv.find((arg) => arg.startsWith("--case="))?.slice("--case=".length)?.toUpperCase();
  if (!process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY && !process.env.TARGET_AI_SEARCHAPI_KEY) {
    console.error("SearchAPI key missing — cannot validate.");
    process.exit(1);
  }

  const { searchTargetAccountsWithAiV2 } = await import("../lib/instagram-client/target-ai-search-v2-service.ts");
  const selectedCases = caseArg ? CASES.filter((row) => row.id === caseArg) : CASES;
  if (selectedCases.length === 0) {
    console.error(`Unknown case ${caseArg}. Use A, B, C, or D.`);
    process.exit(1);
  }
  const reports = [];

  for (const testCase of selectedCases) {
    console.log(`\n${"=".repeat(72)}\nVALIDATING ${testCase.id}: ${testCase.niche} + ${testCase.locationLabel}\n${"=".repeat(72)}`);
    reports.push(await runCase(testCase, searchTargetAccountsWithAiV2));
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const outDir = join(ROOT, "runs");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `target-ai-v21-ui-validation-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}.json`);
  writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), account_id: ACCOUNT_ID, reports }, null, 2));
  console.log(`\nSaved: ${outPath}`);
}

await main();
