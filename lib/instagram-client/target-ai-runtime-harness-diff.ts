import { readTargetAiHarnessLooseQueries } from "./target-ai-harness-loose-queries.ts";
import { buildTargetAiGoogleQueries } from "./target-ai-google-query-builder.ts";
import type { SerpProfileCandidate } from "./target-ai-serp-extractor.ts";

export type TargetAiRuntimeHarnessDiff = {
  runtime_queries: string[];
  harness_equivalent_queries: string[];
  missing_from_runtime: string[];
  extra_in_runtime: string[];
  organic_results_scanned: number;
  usernames_extracted: number;
  usernames_before_scoring: string[];
  usernames_after_scoring: string[];
  usernames_displayed: string[];
  top_30: Array<{ username: string; sourceQuery: string | null; score: number | null }>;
  harness_targets_missing: string[];
};

export function buildTargetAiRuntimeHarnessDiff(input: {
  niche: string;
  locationLabel?: string | null;
  runtimeQueries: string[];
  organicResultsScanned: number;
  extractedCandidates: SerpProfileCandidate[];
  rankedUsernames: string[];
  displayedUsernames: string[];
  scoredCandidates: Array<{ username: string; serpScore: number; sourceQuery: string | null }>;
  harnessTargetUsernames?: string[];
}) {
  const harnessLoose = readTargetAiHarnessLooseQueries({
    niche: input.niche,
    locationLabel: input.locationLabel,
  });
  const harnessEquivalent = harnessLoose
    ?? buildTargetAiGoogleQueries({
      niche: input.niche,
      locationLabel: input.locationLabel,
      maxQueries: input.runtimeQueries.length,
    });

  const runtimeSet = new Set(input.runtimeQueries.map((query) => query.toLowerCase()));
  const harnessSet = new Set(harnessEquivalent.map((query) => query.toLowerCase()));

  const extractedSet = new Set(input.extractedCandidates.map((row) => row.username.toLowerCase()));
  const harnessTargets = (input.harnessTargetUsernames ?? [
    "lovemesojhb",
    "dumplingdza",
    "dimsumjoburg_halaal",
    "asian_herbivore",
    "pron.restaurant",
    "tea_and_antique",
    "dumplingdarlingsa",
    "tang_sandton",
    "chunky_chau_restaurant",
    "nezes_den",
  ]).map((username) => username.toLowerCase());

  const scoreByUsername = new Map(
    input.scoredCandidates.map((row) => [row.username.toLowerCase(), row]),
  );

  return {
    runtime_queries: input.runtimeQueries,
    harness_equivalent_queries: harnessEquivalent,
    missing_from_runtime: harnessEquivalent.filter((query) => !runtimeSet.has(query.toLowerCase())),
    extra_in_runtime: input.runtimeQueries.filter((query) => !harnessSet.has(query.toLowerCase())),
    organic_results_scanned: input.organicResultsScanned,
    usernames_extracted: input.extractedCandidates.length,
    usernames_before_scoring: input.extractedCandidates.map((row) => row.username),
    usernames_after_scoring: input.rankedUsernames,
    usernames_displayed: input.displayedUsernames,
    top_30: input.rankedUsernames.slice(0, 30).map((username) => {
      const scored = scoreByUsername.get(username.toLowerCase());
      return {
        username,
        sourceQuery: scored?.sourceQuery ?? null,
        score: scored?.serpScore ?? null,
      };
    }),
    harness_targets_missing: harnessTargets.filter((username) => !extractedSet.has(username)),
  } satisfies TargetAiRuntimeHarnessDiff;
}
