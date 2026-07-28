import type { CtExclusionReasonCode, CtProposalCandidate } from "./types.ts";

const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/;

export type CtUsernameNormalizationResult =
  | { ok: true; normalized: string; deduplicationKey: string }
  | { ok: false; normalized: null; reason: "invalid_username" };

export function normalizeInstagramUsername(value: unknown): CtUsernameNormalizationResult {
  if (typeof value !== "string") return { ok: false, normalized: null, reason: "invalid_username" };
  const normalized = value.trim().replace(/^@+/, "").toLowerCase();
  if (!normalized || !USERNAME_PATTERN.test(normalized)) {
    return { ok: false, normalized: null, reason: "invalid_username" };
  }
  return { ok: true, normalized, deduplicationKey: normalized };
}

export interface CtDeduplicationContext {
  activeTargetUsernames: readonly string[];
  activeProposalUsernames: readonly string[];
  blacklistUsernames: readonly string[];
}

export interface CtDeduplicationResult {
  accepted: ReadonlyArray<{ candidate: CtProposalCandidate; normalizedUsername: string }>;
  excluded: ReadonlyArray<{ username: string; normalizedUsername: string | null; reasons: readonly CtExclusionReasonCode[] }>;
}

function normalizedSet(values: readonly string[]) {
  return new Set(values.flatMap((value) => {
    const result = normalizeInstagramUsername(value);
    return result.ok ? [result.normalized] : [];
  }));
}

export function deduplicateCandidates(
  candidates: readonly CtProposalCandidate[],
  context: CtDeduplicationContext,
): CtDeduplicationResult {
  const activeTargets = normalizedSet(context.activeTargetUsernames);
  const activeProposals = normalizedSet(context.activeProposalUsernames);
  const blacklist = normalizedSet(context.blacklistUsernames);
  const seen = new Set<string>();
  const accepted: Array<{ candidate: CtProposalCandidate; normalizedUsername: string }> = [];
  const excluded: Array<{ username: string; normalizedUsername: string | null; reasons: CtExclusionReasonCode[] }> = [];

  for (const candidate of candidates) {
    const result = normalizeInstagramUsername(candidate.username);
    if (!result.ok) {
      excluded.push({ username: candidate.username, normalizedUsername: null, reasons: [result.reason] });
      continue;
    }
    const reasons: CtExclusionReasonCode[] = [];
    if (seen.has(result.normalized)) reasons.push("duplicate_in_batch");
    if (activeTargets.has(result.normalized)) reasons.push("duplicate_active_target");
    if (activeProposals.has(result.normalized)) reasons.push("duplicate_active_proposal");
    if (blacklist.has(result.normalized)) reasons.push("blacklisted");
    if (!candidate.biography && candidate.followersCount == null) reasons.push("missing_profile_data");
    if (candidate.isEligible === false) reasons.push("profile_not_eligible");
    seen.add(result.normalized);
    if (reasons.length) excluded.push({ username: candidate.username, normalizedUsername: result.normalized, reasons });
    else accepted.push({ candidate, normalizedUsername: result.normalized });
  }
  return { accepted, excluded };
}
