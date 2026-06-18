#!/usr/bin/env node
import { buildTargetAiGoogleQueries, buildTargetAiManualBenchmarkQueries } from "../lib/instagram-client/target-ai-google-query-builder.ts";
import { runTargetAiGoogleSerpDiscovery } from "../lib/instagram-client/target-ai-google-serp-discovery.ts";
import { rankSerpProfileCandidates } from "../lib/instagram-client/target-ai-serp-score.ts";

const CASES = [
  {
    id: "A",
    niche: "restaurant chinois",
    locationLabel: "Johannesburg, Gauteng, South Africa",
  },
  {
    id: "B",
    niche: "restaurant asiatique",
    locationLabel: "Bordeaux, Gironde, France",
  },
  {
    id: "C",
    niche: "psychologue",
    locationLabel: "Johannesburg, Gauteng, South Africa",
  },
  {
    id: "D",
    niche: "agence social media",
    locationLabel: "Belgique",
  },
];

function printCandidate(candidate, index) {
  console.log(`  ${index + 1}. @${candidate.username} score=${candidate.serpScore ?? "n/a"} pos=${candidate.position}`);
  if (candidate.title) console.log(`     title: ${candidate.title.slice(0, 120)}`);
  if (candidate.snippet) console.log(`     snippet: ${candidate.snippet.slice(0, 140)}`);
}

async function runCase(testCase) {
  console.log(`\n=== ${testCase.id}. ${testCase.niche} + ${testCase.locationLabel} ===`);
  const engineQueries = buildTargetAiGoogleQueries({
    niche: testCase.niche,
    locationLabel: testCase.locationLabel,
    maxQueries: 12,
  });
  const manualQueries = buildTargetAiManualBenchmarkQueries({
    niche: testCase.niche,
    locationLabel: testCase.locationLabel,
  });

  console.log("\nEngine queries:");
  engineQueries.forEach((query, index) => console.log(`  ${index + 1}. ${query}`));
  console.log("\nManual benchmark queries:");
  manualQueries.forEach((query, index) => console.log(`  ${index + 1}. ${query}`));

  if (!process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY && !process.env.TARGET_AI_SEARCHAPI_KEY) {
    console.log("\nSearchAPI key missing — skipping live benchmark fetch.");
    return;
  }

  for (const label of ["engine", "manual"]) {
    const queries = label === "engine" ? engineQueries : manualQueries;
    const result = await runTargetAiGoogleSerpDiscovery({ queries, maxCandidates: 80 });
    const ranked = rankSerpProfileCandidates(result.candidates, testCase.niche, testCase.locationLabel);
    console.log(`\n${label.toUpperCase()} results:`);
    console.log(`  queries_executed=${result.queriesExecuted}`);
    console.log(`  organic_results_scanned=${result.organicResultsScanned}`);
    console.log(`  extracted_candidates=${result.extractedCandidatesCount}`);
    ranked.slice(0, 20).forEach((candidate, index) => printCandidate(candidate, index));
  }
}

for (const testCase of CASES) {
  await runCase(testCase);
}

console.log("\nDone.");
