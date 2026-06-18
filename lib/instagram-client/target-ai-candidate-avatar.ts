export function clientAiCandidateAvatarProxyPath(accountId: string, username: string) {
  const normalizedAccountId = accountId.trim();
  const normalizedUsername = username.trim().replace(/^@+/, "").toLowerCase();
  if (!normalizedAccountId || !normalizedUsername) return null;
  return `/api/instagram-client/accounts/${encodeURIComponent(normalizedAccountId)}/targets/ai-candidate/avatar?username=${encodeURIComponent(normalizedUsername)}`;
}

export function serializeTargetAiCandidateForClient(
  accountId: string,
  candidate: {
    username: string;
    followersCount: number | null;
    avatarUrl: string | null;
    avatarAvailable: boolean;
    eligible: boolean;
    ineligibleReasonCode: string | null;
    profileUrl: string;
    isVerified: boolean | null;
    isPrivate: boolean | null;
    verificationStatus: string;
    qualityStatus: string;
    relevanceScore?: number;
    serpTitle?: string | null;
    serpSnippet?: string | null;
    serpSourceQuery?: string | null;
    serpPosition?: number | null;
  },
) {
  const avatarProxyUrl = candidate.avatarAvailable
    ? clientAiCandidateAvatarProxyPath(accountId, candidate.username)
    : null;
  return {
    username: candidate.username,
    followersCount: candidate.followersCount,
    avatarUrl: avatarProxyUrl,
    avatarAvailable: candidate.avatarAvailable,
    avatarProxyUrl,
    eligible: candidate.eligible,
    ineligibleReasonCode: candidate.ineligibleReasonCode,
    profileUrl: candidate.profileUrl,
    isVerified: candidate.isVerified,
    isPrivate: candidate.isPrivate,
    verificationStatus: candidate.verificationStatus,
    qualityStatus: candidate.qualityStatus,
    relevanceScore: candidate.relevanceScore ?? null,
    serpTitle: candidate.serpTitle ?? null,
    serpSnippet: candidate.serpSnippet ?? null,
    serpSourceQuery: candidate.serpSourceQuery ?? null,
    serpPosition: candidate.serpPosition ?? null,
  };
}
