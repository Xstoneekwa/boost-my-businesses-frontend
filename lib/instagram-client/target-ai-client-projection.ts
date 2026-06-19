import type { AiTargetEligibilityReasonCode } from "./target-ai-eligibility.ts";
import {
  hasTargetAiLocationHit,
  isCountryLevelTargetAiSearch,
} from "./target-ai-location-match.ts";
import type { SerpProfileCandidate } from "./target-ai-serp-extractor.ts";
import { scoreSerpProfileCandidate } from "./target-ai-serp-score.ts";

export type SerpClientProjection = {
  eligible: boolean;
  reasonCode: AiTargetEligibilityReasonCode;
  verificationStatus: "pending" | "found" | "not_found" | "rate_limited";
  qualityStatus: string;
  needsProfileVerify: boolean;
  serpScore: number;
  locHit: boolean;
  nicheHit: boolean;
};

const OFF_ZONE_TITLE_MARKERS = [
  "cape town",
  "lilongwe",
  "malawi",
  "adelaide",
  "washington dc",
  "mâcon",
  "macon",
  "rennes",
];

const OFF_ZONE_TITLE_MARKERS_CITY = [
  ...OFF_ZONE_TITLE_MARKERS,
  "washington",
  "paris",
  "marseille",
  "lyon",
  "geneve",
  "genève",
  "bordeaux",
];

const OFF_TARGET_TITLE_MARKERS = [
  "centre scolaire",
  "notre-dame",
  "notre dame",
  "notredame",
  "school",
  "university",
  "gallery",
  "galerie",
  "museum",
  "musée",
  "fondation",
  "foundation",
  "magazine",
  "newspaper",
  "journal",
  "diplo",
];

const WEAK_PROFILE_USERNAME_MARKERS = [
  "basically",
  "foodguide",
  "food_guide",
  "noms",
  "eater",
  "guide",
  "magazine",
  "news",
  "media",
  "coffeehouse",
  "coffee",
];

const SMMA_SIGNAL_TERMS = [
  "social media",
  "marketing agency",
  "digital agency",
  "community management",
  "agence social media",
  "agence marketing",
  "agence digitale",
  "marketing digital",
  "social media agency",
  "content agency",
  "communication agency",
  "community manager",
];

function normalizeText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function includesAny(haystack: string, terms: readonly string[]) {
  return terms.some((term) => haystack.includes(term));
}

function hasSmmaSignal(combined: string) {
  return includesAny(combined, SMMA_SIGNAL_TERMS) || combined.includes("agency");
}

export function evaluateSerpClientProjection(input: {
  candidate: SerpProfileCandidate & { serpScore?: number; locHit?: boolean; nicheHit?: boolean };
  niche: string;
  locationLabel?: string | null;
}): SerpClientProjection {
  const scored = scoreSerpProfileCandidate({
    candidate: input.candidate,
    niche: input.niche,
    locationLabel: input.locationLabel,
  });
  const title = normalizeText(input.candidate.title);
  const username = normalizeText(input.candidate.username);
  const combined = normalizeText([
    input.candidate.title,
    input.candidate.snippet,
    input.candidate.username,
    input.candidate.sourceQuery,
  ].filter(Boolean).join(" "));
  const isCountrySearch = isCountryLevelTargetAiSearch(input.locationLabel);
  const locHit = hasTargetAiLocationHit({
    combined,
    sourceQuery: input.candidate.sourceQuery,
    locationLabel: input.locationLabel,
  }) || scored.locHit;
  const nicheHit = scored.nicheHit || (isCountrySearch && hasSmmaSignal(combined));

  function reject(
    reasonCode: AiTargetEligibilityReasonCode,
    qualityStatus: string,
  ): SerpClientProjection {
    return {
      eligible: false,
      reasonCode,
      verificationStatus: "found",
      qualityStatus,
      needsProfileVerify: false,
      serpScore: scored.score,
      locHit,
      nicheHit,
    };
  }

  const offZoneMarkers = isCountrySearch ? OFF_ZONE_TITLE_MARKERS : OFF_ZONE_TITLE_MARKERS_CITY;
  if (includesAny(title, offZoneMarkers)) {
    return reject("out_of_location", "rejected_out_of_location");
  }

  if (includesAny(combined, OFF_TARGET_TITLE_MARKERS)) {
    return reject("out_of_target", "rejected_out_of_target");
  }

  if (includesAny(username, WEAK_PROFILE_USERNAME_MARKERS)) {
    return reject("not_relevant", "rejected_not_relevant");
  }

  const minScore = isCountrySearch ? 12 : 18;
  if (scored.score < minScore && !locHit) {
    return reject("not_relevant", "rejected_not_relevant");
  }

  if (!nicheHit && scored.score < (isCountrySearch ? 24 : 32)) {
    if (!(isCountrySearch && locHit && hasSmmaSignal(combined) && scored.score >= 14)) {
      return reject("out_of_target", "rejected_out_of_target");
    }
  }

  if (!locHit && !nicheHit) {
    return reject("not_relevant", "rejected_not_relevant");
  }

  const minLocScore = isCountrySearch ? 14 : 28;
  if (!locHit && scored.score < minLocScore) {
    return reject("out_of_location", "rejected_out_of_location");
  }

  return {
    eligible: false,
    reasonCode: "pending_verification",
    verificationStatus: "pending",
    qualityStatus: "pending_verification",
    needsProfileVerify: true,
    serpScore: scored.score,
    locHit,
    nicheHit,
  };
}

export function needsTargetAiProfileVerification(projection: Pick<SerpClientProjection, "needsProfileVerify" | "verificationStatus">) {
  return projection.needsProfileVerify && projection.verificationStatus === "pending";
}
