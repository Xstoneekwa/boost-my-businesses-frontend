import type { AiTargetEligibilityReasonCode } from "./target-ai-eligibility.ts";
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
  "washington",
  "washington dc",
  "mâcon",
  "macon",
  "rennes",
  "paris",
  "marseille",
  "lyon",
  "geneve",
  "genève",
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

function normalizeText(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function includesAny(haystack: string, terms: string[]) {
  return terms.some((term) => haystack.includes(term));
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
      locHit: scored.locHit,
      nicheHit: scored.nicheHit,
    };
  }

  if (includesAny(title, OFF_ZONE_TITLE_MARKERS)) {
    return reject("out_of_location", "rejected_out_of_location");
  }

  if (includesAny(combined, OFF_TARGET_TITLE_MARKERS)) {
    return reject("out_of_target", "rejected_out_of_target");
  }

  if (includesAny(username, WEAK_PROFILE_USERNAME_MARKERS)) {
    return reject("not_relevant", "rejected_not_relevant");
  }

  if (scored.score < 18) {
    return reject("not_relevant", "rejected_not_relevant");
  }

  if (!scored.nicheHit && scored.score < 32) {
    return reject("out_of_target", "rejected_out_of_target");
  }

  if (!scored.locHit && !scored.nicheHit) {
    return reject("not_relevant", "rejected_not_relevant");
  }

  if (!scored.locHit && scored.score < 28) {
    return reject("out_of_location", "rejected_out_of_location");
  }

  return {
    eligible: false,
    reasonCode: "pending_verification",
    verificationStatus: "pending",
    qualityStatus: "pending_verification",
    needsProfileVerify: true,
    serpScore: scored.score,
    locHit: scored.locHit,
    nicheHit: scored.nicheHit,
  };
}

export function needsTargetAiProfileVerification(projection: Pick<SerpClientProjection, "needsProfileVerify" | "verificationStatus">) {
  return projection.needsProfileVerify && projection.verificationStatus === "pending";
}
