export type TargetAiUiDiscoveryProfile = {
  earlyStopCandidateCount: number;
  minDisplayedTarget: number;
  maxQueriesToExecute: number;
  pagesPerQuery: number;
  thirdPageMinCandidates: number;
  discoveryMaxMs: number;
  maxSerpCandidates: number;
};

function normalizeNiche(niche: string) {
  return niche.trim().toLowerCase();
}

export function resolveTargetAiUiDiscoveryProfile(input: {
  niche: string;
  locationLabel?: string | null;
}): TargetAiUiDiscoveryProfile {
  const niche = normalizeNiche(input.niche);

  if (niche.includes("psycholog")) {
    return {
      earlyStopCandidateCount: 42,
      minDisplayedTarget: 35,
      maxQueriesToExecute: 14,
      pagesPerQuery: 2,
      thirdPageMinCandidates: 32,
      discoveryMaxMs: 58_000,
      maxSerpCandidates: 50,
    };
  }

  if (niche.includes("social media") || niche.includes("agence")) {
    return {
      earlyStopCandidateCount: 42,
      minDisplayedTarget: 35,
      maxQueriesToExecute: 12,
      pagesPerQuery: 2,
      thirdPageMinCandidates: 30,
      discoveryMaxMs: 58_000,
      maxSerpCandidates: 50,
    };
  }

  return {
    earlyStopCandidateCount: 36,
    minDisplayedTarget: 25,
    maxQueriesToExecute: 16,
    pagesPerQuery: 2,
    thirdPageMinCandidates: 20,
    discoveryMaxMs: 58_000,
    maxSerpCandidates: 45,
  };
}
