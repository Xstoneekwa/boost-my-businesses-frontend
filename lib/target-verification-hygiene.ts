import type { TargetQualityDecision } from "./instagram-target-quality.ts";
import type { TargetVerificationJobDecision } from "./instagram-target-verification-jobs.ts";
import { isRetryableTargetVerificationDecision } from "./instagram-target-verification-jobs.ts";
import {
  clearPeriodicSchedulePatch,
} from "./target-periodic-revalidation.ts";

export const TARGET_HYGIENE_ARCHIVE_REASON_ACCOUNT_NOT_FOUND = "account_not_found";
export const TARGET_HYGIENE_ARCHIVE_REASON_VERIFIED_INELIGIBLE = "verified_became_ineligible";

export type TargetHygieneExistingRow = {
  id?: string | null;
  account_id?: string | null;
  normalized_username?: string | null;
  target_username?: string | null;
  canonical_username?: string | null;
  input_username?: string | null;
  status?: string | null;
  quality_status?: string | null;
  verification_status?: string | null;
  metadata_safe?: Record<string, unknown> | null;
};

export type TargetVerificationHygieneResult = {
  shouldApplyTargetPatch: boolean;
  targetPatch: Record<string, unknown>;
  auditReason: string;
  hygieneAction:
    | "none"
    | "rename_confirmed"
    | "archive_not_found"
    | "archive_verified"
    | "apply_quality_decision";
  shouldReevaluateNeedsMoreTargets: boolean;
};

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function normalizeUsername(value: unknown) {
  return readString(value, "").replace(/^@+/, "").toLowerCase();
}

function readMetadataRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function readTargetStableIdentity(row: TargetHygieneExistingRow | Record<string, unknown>) {
  const meta = readMetadataRecord((row as TargetHygieneExistingRow).metadata_safe);
  return {
    instagram_user_id: readString((row as Record<string, unknown>).instagram_user_id, "")
      || readString(meta.instagram_user_id, "")
      || null,
    external_profile_id: readString((row as Record<string, unknown>).external_profile_id, "")
      || readString(meta.external_profile_id, "")
      || null,
  };
}

export function readProviderIdentityFromDecision(decision: TargetQualityDecision) {
  const meta = readMetadataRecord(decision.metadata_safe);
  return {
    instagram_user_id: readString(decision.instagram_user_id, "") || readString(meta.instagram_user_id, "") || null,
    external_profile_id: readString(decision.external_profile_id, "") || readString(meta.external_profile_id, "") || null,
    canonical_username: normalizeUsername(decision.canonical_username) || null,
  };
}

export function hasStableIdentityMatch(
  existing: { instagram_user_id: string | null; external_profile_id: string | null },
  provider: { instagram_user_id: string | null; external_profile_id: string | null },
) {
  if (existing.instagram_user_id && provider.instagram_user_id && existing.instagram_user_id === provider.instagram_user_id) {
    return true;
  }
  if (existing.external_profile_id && provider.external_profile_id && existing.external_profile_id === provider.external_profile_id) {
    return true;
  }
  return false;
}

function isUsernameRenameReview(decision: TargetQualityDecision) {
  return decision.quality_status === "review_username_changed"
    || decision.verification_reason === "username_changed";
}

function isConfirmedUsernameRename(
  existing: TargetHygieneExistingRow,
  decision: TargetQualityDecision,
  activeUsernames: string[],
) {
  const storedUsername = normalizeUsername(existing.normalized_username || existing.target_username);
  const canonicalUsername = normalizeUsername(decision.canonical_username);
  if (!storedUsername || !canonicalUsername || storedUsername === canonicalUsername) return false;

  const providerIdentity = readProviderIdentityFromDecision(decision);
  if (!providerIdentity.instagram_user_id && !providerIdentity.external_profile_id) return false;

  const existingIdentity = readTargetStableIdentity(existing);
  if (existingIdentity.instagram_user_id || existingIdentity.external_profile_id) {
    if (!hasStableIdentityMatch(existingIdentity, providerIdentity)) return false;
  }

  if (activeUsernames.includes(canonicalUsername)) return false;
  return true;
}

function enrichMetadataSafe(decision: TargetQualityDecision) {
  const providerIdentity = readProviderIdentityFromDecision(decision);
  return {
    ...(decision.metadata_safe ?? {}),
    ...(providerIdentity.instagram_user_id ? { instagram_user_id: providerIdentity.instagram_user_id } : {}),
    ...(providerIdentity.external_profile_id ? { external_profile_id: providerIdentity.external_profile_id } : {}),
  };
}

function buildQualityDecisionPatch(decision: TargetQualityDecision) {
  return {
    status: decision.status,
    verification_status: decision.verification_status,
    verification_reason: decision.verification_reason,
    quality_status: decision.quality_status,
    canonical_username: decision.canonical_username,
    avatar_url: decision.avatar_url,
    followers_count: decision.followers_count,
    is_verified: decision.is_verified,
    is_private: decision.is_private,
    provider_checked_at: decision.provider_checked_at,
    rejected_reason: decision.rejected_reason,
    metadata_safe: enrichMetadataSafe(decision),
  };
}

function buildArchivePatch(
  decision: TargetQualityDecision,
  archiveReason: string,
  nowIso: string,
) {
  return {
    ...buildQualityDecisionPatch(decision),
    ...clearPeriodicSchedulePatch(),
    status: "archived",
    archived_at: nowIso,
    archive_reason: archiveReason,
    auto_archived_at: nowIso,
  };
}

function buildRenamePatch(
  existing: TargetHygieneExistingRow,
  decision: TargetQualityDecision,
  nowIso: string,
) {
  const canonicalUsername = normalizeUsername(decision.canonical_username);
  const previousUsername = normalizeUsername(existing.normalized_username || existing.target_username);
  const providerIdentity = readProviderIdentityFromDecision(decision);

  return {
    input_username: readString(existing.input_username, previousUsername) || previousUsername,
    normalized_username: canonicalUsername,
    target_username: canonicalUsername,
    canonical_username: canonicalUsername,
    status: "valid",
    verification_status: "found",
    verification_reason: "username_rename_confirmed",
    quality_status: "eligible",
    rejected_reason: null,
    avatar_url: decision.avatar_url,
    followers_count: decision.followers_count,
    is_verified: decision.is_verified,
    is_private: decision.is_private,
    provider_checked_at: decision.provider_checked_at,
    metadata_safe: {
      ...enrichMetadataSafe(decision),
      previous_username: previousUsername,
      username_renamed_at: nowIso,
    },
  };
}

export function resolveTargetVerificationHygiene(input: {
  existingTarget: TargetHygieneExistingRow;
  jobDecision: TargetVerificationJobDecision;
  decision: TargetQualityDecision;
  now: Date;
  activeUsernames?: string[];
}): TargetVerificationHygieneResult {
  const nowIso = input.now.toISOString();
  const activeUsernames = input.activeUsernames ?? [];
  const none: TargetVerificationHygieneResult = {
    shouldApplyTargetPatch: false,
    targetPatch: {},
    auditReason: "verification_no_target_mutation",
    hygieneAction: "none",
    shouldReevaluateNeedsMoreTargets: false,
  };

  if (input.jobDecision.jobStatus === "retry_scheduled" || isRetryableTargetVerificationDecision(input.decision)) {
    return {
      ...none,
      auditReason: "verification_transient_no_target_mutation",
    };
  }

  if (input.decision.quality_status === "review_provider_unavailable") {
    return {
      ...none,
      auditReason: "verification_ambiguous_no_target_mutation",
    };
  }

  if (isUsernameRenameReview(input.decision)) {
    if (isConfirmedUsernameRename(input.existingTarget, input.decision, activeUsernames)) {
      return {
        shouldApplyTargetPatch: true,
        targetPatch: buildRenamePatch(input.existingTarget, input.decision, nowIso),
        auditReason: "username_rename_confirmed",
        hygieneAction: "rename_confirmed",
        shouldReevaluateNeedsMoreTargets: true,
      };
    }
    return {
      ...none,
      auditReason: "username_rename_unconfirmed",
    };
  }

  if (input.decision.quality_status === "rejected_not_found") {
    return {
      shouldApplyTargetPatch: true,
      targetPatch: buildArchivePatch(
        input.decision,
        TARGET_HYGIENE_ARCHIVE_REASON_ACCOUNT_NOT_FOUND,
        nowIso,
      ),
      auditReason: TARGET_HYGIENE_ARCHIVE_REASON_ACCOUNT_NOT_FOUND,
      hygieneAction: "archive_not_found",
      shouldReevaluateNeedsMoreTargets: true,
    };
  }

  if (input.decision.quality_status === "rejected_verified") {
    return {
      shouldApplyTargetPatch: true,
      targetPatch: buildArchivePatch(
        input.decision,
        TARGET_HYGIENE_ARCHIVE_REASON_VERIFIED_INELIGIBLE,
        nowIso,
      ),
      auditReason: TARGET_HYGIENE_ARCHIVE_REASON_VERIFIED_INELIGIBLE,
      hygieneAction: "archive_verified",
      shouldReevaluateNeedsMoreTargets: true,
    };
  }

  return {
    shouldApplyTargetPatch: true,
    targetPatch: buildQualityDecisionPatch(input.decision),
    auditReason: input.decision.verification_reason,
    hygieneAction: "apply_quality_decision",
    shouldReevaluateNeedsMoreTargets: true,
  };
}
