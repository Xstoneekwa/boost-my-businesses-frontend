import { createHash } from "node:crypto";
import { createSupabaseClient } from "@/lib/supabase";
import {
  entitlementToAddProfileInput,
  getReservedEntitlementForClient,
} from "@/lib/commercial/entitlements";
import {
  isAddProfileCommercialPackage,
  type AddProfileCommercialPackage,
} from "@/lib/instagram-dashboard/add-profile-packages";
import { loadTargetEligibilityCountsForAccount } from "@/lib/instagram-dashboard/account-target-eligibility";
import { tryAutoAssignOnboardingSchedule } from "@/lib/instagram-dashboard/onboarding-schedule";
import { reconcilePackageRuntimeContract } from "@/lib/instagram-dashboard/package-runtime-contract";
import { lookupInstagramPublicProfile } from "@/lib/instagram-public-profile-lookup";
import { createClientInstagramAccount, projectClientPublicProfileLookup } from "./create-account";
import {
  CLIENT_ONBOARDING_TARGET_MINIMUM,
  hasClientOnboardingTargetMinimum,
} from "./client-account-onboarding-policy";
import { readString } from "./guards";
import {
  applyClientPublicAnalysisConfirmation,
  buildStoredPublicAnalysis,
  mergeReanalysisPreservingConfirmations,
  onboardingAvatarSource,
  projectClientPublicAnalysis,
  readStoredPublicAnalysis,
  withReanalysisState,
  withProfileAiAnalysis,
  type ClientPublicAnalysis,
} from "./profile-intelligence";
import {
  PROFILE_INTELLIGENCE_LEASE_MS,
  buildProfileIntelligencePromptSnapshot,
  callProfileIntelligenceOpenAi,
  profileAiModel,
  profileIntelligencePromptVersion,
  readStoredProfileAiAnalysis,
  resolveProfileAiOutputLanguage,
  type ProfileIntelligenceProviderResult,
} from "./profile-intelligence-ai";
import { evaluateProfileAiAnalysis } from "./profile-intelligence-ai-policy";
import { evaluateProfileReanalysis } from "./profile-reanalysis-policy";
import { isClientOnboardingResumeCandidate } from "./client-onboarding-render-contract";
import {
  normalizeProtectionUsernameEntries,
  readExpectedVersion,
} from "@/lib/instagram-dashboard/account-protection-list-contract";

type Row = Record<string, unknown>;
type Supabase = ReturnType<typeof createSupabaseClient>;

export { CLIENT_ONBOARDING_TARGET_MINIMUM, hasClientOnboardingTargetMinimum };

export type ClientOnboardingStep = "connection" | "analysis" | "protection_lists" | "targeting" | "targets" | "complete";
export type ClientOnboardingStatus =
  | "active"
  | "creating"
  | "completed"
  | "failed_retryable"
  | "expired"
  | "abandoned";

export type { ClientPublicAnalysis } from "./profile-intelligence";

export type ClientTargetingCriteria = {
  idealCustomer: string;
  geography: string;
  niche: string;
  businessDescription: string;
  language: string;
  themes: string[];
  keywords: string[];
};

export type ClientOnboardingSession = {
  id: string;
  idempotencyKey: string;
  accountId: string | null;
  entitlementId: string;
  requestedUsername: string;
  packageCode: AddProfileCommercialPackage;
  status: ClientOnboardingStatus;
  currentStep: ClientOnboardingStep;
  publicAnalysis: ClientPublicAnalysis | null;
  targetingCriteria: ClientTargetingCriteria | null;
  eligibleTargetCount: number;
  requiredTargetCount: number;
  lastErrorCode: string | null;
  completedAt: string | null;
  expiresAt: string;
  lastProgressAt: string;
  canRestart: boolean;
  updatedAt: string;
  assignmentStatus?: "assigned" | "pending_assignment";
  assignmentReason?: string;
  loginStatus?: "pending_login" | "unknown";
};

const ONBOARDING_SELECT = [
  "id", "client_id", "entitlement_id", "account_id", "idempotency_key",
  "requested_username", "package_code", "status", "current_step",
  "public_analysis", "targeting_criteria", "last_error_code", "failure_reason", "completed_at",
  "expires_at", "last_progress_at", "updated_at",
].join(",");

function readObject(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function readStringList(value: unknown, limit = 12) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => readString(item).slice(0, 80)).filter(Boolean))].slice(0, limit);
}

function optionalText(value: unknown, limit = 500) {
  const text = readString(value).slice(0, limit);
  return text || null;
}

async function loadClientPreferredLanguage(supabase: Supabase, clientId: string) {
  const { data, error } = await supabase
    .from("clients")
    .select("metadata")
    .eq("id", clientId)
    .limit(1)
    .maybeSingle<Row>();
  if (error || !data) return null;
  const preferredLanguage = readString(readObject(data.metadata).preferred_language);
  return preferredLanguage === "fr" || preferredLanguage === "en" ? preferredLanguage : null;
}

export function sanitizeTargetingCriteria(value: unknown): ClientTargetingCriteria {
  const row = readObject(value);
  return {
    idealCustomer: readString(row.idealCustomer).slice(0, 500),
    geography: readString(row.geography).slice(0, 200),
    niche: readString(row.niche).slice(0, 300),
    businessDescription: readString(row.businessDescription).slice(0, 1000),
    language: readString(row.language).slice(0, 80),
    themes: readStringList(row.themes),
    keywords: readStringList(row.keywords, 20),
  };
}

function mapAnalysis(value: unknown): ClientPublicAnalysis | null {
  return projectClientPublicAnalysis(value);
}

function mapCriteria(value: unknown): ClientTargetingCriteria | null {
  const row = readObject(value);
  return Object.keys(row).length ? sanitizeTargetingCriteria(row) : null;
}

async function projectSession(supabase: Supabase, row: Row): Promise<ClientOnboardingSession> {
  const accountId = readString(row.account_id) || null;
  const targetCounts = accountId
    ? await loadTargetEligibilityCountsForAccount(supabase, accountId)
    : { eligible: 0 };
  const packageCode = readString(row.package_code);
  if (!isAddProfileCommercialPackage(packageCode)) throw new Error("onboarding_package_invalid");
  const status = readString(row.status, "active") as ClientOnboardingStatus;
  return {
    id: readString(row.id),
    idempotencyKey: readString(row.idempotency_key),
    accountId,
    entitlementId: readString(row.entitlement_id),
    requestedUsername: readString(row.requested_username),
    packageCode,
    status,
    currentStep: readString(row.current_step, "connection") as ClientOnboardingStep,
    publicAnalysis: mapAnalysis(row.public_analysis),
    targetingCriteria: mapCriteria(row.targeting_criteria),
    eligibleTargetCount: targetCounts.eligible,
    requiredTargetCount: CLIENT_ONBOARDING_TARGET_MINIMUM,
    lastErrorCode: optionalText(row.last_error_code, 120),
    completedAt: optionalText(row.completed_at, 80),
    expiresAt: readString(row.expires_at),
    lastProgressAt: readString(row.last_progress_at),
    canRestart: status === "expired" || status === "abandoned",
    updatedAt: readString(row.updated_at),
  };
}

async function loadSessionRow(supabase: Supabase, clientId: string, sessionId: string) {
  const { data, error } = await supabase
    .from("client_instagram_onboarding_sessions")
    .select(ONBOARDING_SELECT)
    .eq("id", sessionId)
    .eq("client_id", clientId)
    .limit(1)
    .maybeSingle<Row>();
  if (error) throw new Error("onboarding_lookup_failed");
  return data?.id ? data : null;
}

async function loadSessionRowByIdempotency(supabase: Supabase, clientId: string, idempotencyKey: string) {
  const { data, error } = await supabase
    .from("client_instagram_onboarding_sessions")
    .select(ONBOARDING_SELECT)
    .eq("client_id", clientId)
    .eq("idempotency_key", idempotencyKey)
    .limit(1)
    .maybeSingle<Row>();
  if (error) throw new Error("onboarding_lookup_failed");
  return data?.id ? data : null;
}

async function finalizeCompletedOnboardingAssignment(
  supabase: Supabase,
  row: Row,
): Promise<Pick<ClientOnboardingSession, "assignmentStatus" | "assignmentReason" | "loginStatus">> {
  const accountId = readString(row.account_id);
  if (!accountId) throw Object.assign(new Error("account_not_created"), { status: 409 });

  const assignment = await tryAutoAssignOnboardingSchedule(accountId);
  const assignmentReason = readString(
    assignment.reason,
    assignment.assigned ? "onboarding_auto_assigned" : "pending_assignment",
  );
  if (!assignment.assigned) {
    return {
      assignmentStatus: "pending_assignment",
      assignmentReason,
      loginStatus: "unknown",
    };
  }

  const contract = await reconcilePackageRuntimeContract(supabase, accountId, "client_onboarding_finalize");
  if (!contract.ok) {
    throw Object.assign(new Error(contract.reason), { status: 409 });
  }

  const { error } = await supabase
    .from("client_instagram_accounts")
    .update({
      onboarding_status: "configured",
      provisioning_status: "login_pending",
      login_status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", readString(row.client_id))
    .eq("account_id", accountId);
  if (error) throw Object.assign(new Error("onboarding_login_pending_projection_failed"), { status: 500 });

  return {
    assignmentStatus: "assigned",
    assignmentReason,
    loginStatus: "pending_login",
  };
}

function rpcFailure(data: unknown, fallback: string) {
  const result = readObject(data);
  const reason = readString(result.reason, fallback);
  const status = reason === "client_access_denied" || reason === "entitlement_required" ? 403
    : reason === "onboarding_not_found" ? 404
      : reason === "creation_lease_active" ? 409
        : 400;
  return Object.assign(new Error(reason), {
    status,
    eligibleCount: Number(result.eligible_count ?? 0),
    requiredCount: Number(result.required_count ?? CLIENT_ONBOARDING_TARGET_MINIMUM),
  });
}

export async function loadLatestClientOnboardingSession(clientId: string, userId: string) {
  const supabase = createSupabaseClient();
  const expiry = await supabase.rpc("expire_client_instagram_onboarding_sessions", {
    p_client_id: clientId,
    p_actor_id: userId,
  });
  if (expiry.error) throw new Error("onboarding_expiry_failed");
  const { data, error } = await supabase
    .from("client_instagram_onboarding_sessions")
    .select(ONBOARDING_SELECT)
    .eq("client_id", clientId)
    .neq("status", "completed")
    .order("updated_at", { ascending: false })
    .limit(20)
    .returns<Row[]>();
  if (error) throw new Error("onboarding_lookup_failed");
  const row = (Array.isArray(data) ? data : []).find(isClientOnboardingResumeCandidate);
  return row?.id ? projectSession(supabase, row) : null;
}

export async function beginClientInstagramOnboarding(input: {
  clientId: string;
  userId: string;
  idempotencyKey: string;
  username: string;
  password: string;
  email?: string;
}) {
  const supabase = createSupabaseClient();
  const existing = await loadSessionRowByIdempotency(supabase, input.clientId, input.idempotencyKey);
  if (existing && ["active", "completed"].includes(readString(existing.status))) {
    return projectSession(supabase, existing);
  }

  const entitlement = await getReservedEntitlementForClient(supabase, input.clientId);
  if (!entitlement?.id) throw Object.assign(new Error("entitlement_required"), { status: 403 });
  const selection = entitlementToAddProfileInput(entitlement);
  if (!isAddProfileCommercialPackage(selection.commercialPackage)) {
    throw Object.assign(new Error("entitlement_package_invalid"), { status: 409 });
  }

  const validation = await createClientInstagramAccount({
    clientId: input.clientId,
    userId: input.userId,
    username: input.username,
    password: "",
    email: input.email,
    dryRun: true,
    flowMode: "targeting_setup",
  });
  if (!validation.ok) {
    throw Object.assign(new Error(validation.code ?? "account_validation_failed"), {
      status: validation.status,
      clientMessage: validation.error,
    });
  }
  if (validation.commercialPackage !== selection.commercialPackage) {
    throw Object.assign(new Error("entitlement_package_mismatch"), { status: 409 });
  }

  const analysis = buildStoredPublicAnalysis(validation.publicProfile);
  const attemptId = crypto.randomUUID();
  const { data, error } = await supabase.rpc("begin_client_instagram_onboarding", {
    p_client_id: input.clientId,
    p_actor_id: input.userId,
    p_entitlement_id: entitlement.id,
    p_idempotency_key: input.idempotencyKey,
    p_attempt_id: attemptId,
    p_lease_owner: `client-onboarding:${input.userId}`,
    p_requested_username: validation.publicProfile.username,
    p_login_email: input.email ?? "",
    p_password: input.password,
    p_public_analysis: analysis,
  });
  if (error) throw Object.assign(new Error("onboarding_atomic_create_failed"), { status: 500 });
  const result = readObject(data);
  if (result.ok !== true) throw rpcFailure(result, "onboarding_atomic_create_failed");
  const row = await loadSessionRow(supabase, input.clientId, readString(result.session_id));
  if (!row) throw Object.assign(new Error("onboarding_lookup_failed"), { status: 500 });
  return projectSession(supabase, row);
}

export async function restartClientInstagramOnboarding(input: {
  clientId: string;
  userId: string;
  previousSessionId: string;
  idempotencyKey: string;
}) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase.rpc("restart_client_instagram_onboarding", {
    p_previous_session_id: input.previousSessionId,
    p_client_id: input.clientId,
    p_actor_id: input.userId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw Object.assign(new Error("onboarding_restart_failed"), { status: 500 });
  const result = readObject(data);
  if (result.ok !== true) throw rpcFailure(result, "onboarding_restart_failed");
  const row = await loadSessionRow(supabase, input.clientId, readString(result.session_id));
  if (!row) throw Object.assign(new Error("onboarding_lookup_failed"), { status: 500 });
  return projectSession(supabase, row);
}

export async function updateClientInstagramOnboarding(input: {
  clientId: string;
  userId: string;
  sessionId: string;
  action: "save_analysis" | "save_protection_lists" | "save_targeting" | "open_targets" | "complete" | "abandon";
  value?: unknown;
}) {
  const supabase = createSupabaseClient();
  const row = await loadSessionRow(supabase, input.clientId, input.sessionId);
  if (!row) throw Object.assign(new Error("onboarding_not_found"), { status: 404 });
  if (readString(row.status) === "completed") {
    const assignment = await finalizeCompletedOnboardingAssignment(supabase, row);
    return { ...await projectSession(supabase, row), ...assignment };
  }

  const value = input.action === "save_analysis"
    ? applyClientPublicAnalysisConfirmation(input.value, row.public_analysis)
    : input.action === "save_targeting"
      ? sanitizeTargetingCriteria(input.value)
      : {};
  const { data, error } = await supabase.rpc("advance_client_instagram_onboarding", {
    p_session_id: input.sessionId,
    p_client_id: input.clientId,
    p_actor_id: input.userId,
    p_action: input.action,
    p_value: value,
  });
  if (error) throw Object.assign(new Error("onboarding_update_failed"), { status: 500 });
  const result = readObject(data);
  if (result.ok !== true) throw rpcFailure(result, "onboarding_update_failed");
  const updated = await loadSessionRow(supabase, input.clientId, input.sessionId);
  if (!updated) throw Object.assign(new Error("onboarding_not_found"), { status: 404 });
  const projected = await projectSession(supabase, updated);
  if (input.action !== "complete" || projected.status !== "completed") return projected;
  const assignment = await finalizeCompletedOnboardingAssignment(supabase, updated);
  return { ...projected, ...assignment };
}

export async function saveClientInstagramOnboardingProtectionLists(input: {
  clientId: string;
  userId: string;
  sessionId: string;
  value: unknown;
}) {
  const supabase = createSupabaseClient();
  const row = await loadSessionRow(supabase, input.clientId, input.sessionId);
  if (!row) throw Object.assign(new Error("onboarding_not_found"), { status: 404 });
  const accountId = readString(row.account_id);
  if (!accountId) throw Object.assign(new Error("account_not_created"), { status: 409 });
  const value = readObject(input.value);
  const mode = readString(value.mode);
  const requestKey = readString(value.request_key);
  if (!["save", "skip"].includes(mode)) {
    throw Object.assign(new Error("protection_lists_mode_invalid"), { status: 400 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw Object.assign(new Error("protection_lists_request_key_invalid"), { status: 400 });
  }

  let whitelistItems: string[] = [];
  let blacklistItems: string[] = [];
  let whitelistVersion = 0;
  let blacklistVersion = 0;
  if (mode === "save") {
    const whitelist = readObject(value.unfollow_whitelist);
    const blacklist = readObject(value.interaction_blacklist);
    const normalizedWhitelist = normalizeProtectionUsernameEntries(whitelist.items, "items");
    const normalizedBlacklist = normalizeProtectionUsernameEntries(blacklist.items, "items");
    if (normalizedWhitelist.errors.length || normalizedBlacklist.errors.length) {
      throw Object.assign(new Error("invalid_entries"), { status: 422 });
    }
    const whitelistExpected = readExpectedVersion(readString(whitelist.if_match), accountId, "unfollow_whitelist");
    const blacklistExpected = readExpectedVersion(readString(blacklist.if_match), accountId, "interaction_blacklist");
    if (!whitelistExpected.ok || !blacklistExpected.ok) {
      const failure = !whitelistExpected.ok ? whitelistExpected : blacklistExpected;
      throw Object.assign(new Error(failure.error), { status: failure.status });
    }
    whitelistItems = normalizedWhitelist.items;
    blacklistItems = normalizedBlacklist.items;
    whitelistVersion = whitelistExpected.version;
    blacklistVersion = blacklistExpected.version;
  }

  const fingerprint = (kind: string, items: string[]) => createHash("sha256")
    .update(JSON.stringify({ accountId, kind, operation: "replace", items, sourceSurface: "client_onboarding" }))
    .digest("hex");
  const { data, error } = await supabase.rpc("save_client_instagram_onboarding_protection_lists", {
    p_session_id: input.sessionId,
    p_client_id: input.clientId,
    p_actor_id: input.userId,
    p_mode: mode,
    p_unfollow_items: whitelistItems,
    p_blacklist_items: blacklistItems,
    p_unfollow_expected_version: whitelistVersion,
    p_blacklist_expected_version: blacklistVersion,
    p_request_id: crypto.randomUUID(),
    p_idempotency_key: requestKey,
    p_unfollow_fingerprint: fingerprint("unfollow_whitelist", whitelistItems),
    p_blacklist_fingerprint: fingerprint("interaction_blacklist", blacklistItems),
  });
  if (error) throw Object.assign(new Error("protection_lists_transaction_failed"), { status: 503 });
  const result = readObject(data);
  if (result.ok !== true) {
    const code = readString(result.error, "protection_lists_transaction_failed");
    const status = ["version_conflict", "idempotency_conflict"].includes(code) ? 409 : 400;
    throw Object.assign(new Error(code), { status });
  }
  const updated = await loadSessionRow(supabase, input.clientId, input.sessionId);
  if (!updated) throw Object.assign(new Error("onboarding_not_found"), { status: 404 });
  return projectSession(supabase, updated);
}

function reanalysisError(code: string, status: number) {
  return Object.assign(new Error(code), { status });
}

async function markReanalysisFailed(
  supabase: Supabase,
  row: Row,
  clientId: string,
  requestKey: string,
  errorCode: string,
) {
  const claimedAnalysis = readStoredPublicAnalysis(row.public_analysis);
  const startedAt = claimedAnalysis?.reanalysis?.started_at || new Date().toISOString();
  const failed = withReanalysisState(row.public_analysis, {
    request_key: requestKey,
    status: "failed",
    attempt_count: claimedAnalysis?.reanalysis?.attempt_count ?? 1,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    error_code: errorCode,
  });
  await supabase
    .from("client_instagram_onboarding_sessions")
    .update({ public_analysis: failed, updated_at: new Date().toISOString() })
    .eq("id", readString(row.id))
    .eq("client_id", clientId)
    .eq("updated_at", readString(row.updated_at));
}

export async function reanalyzeClientInstagramOnboarding(input: {
  clientId: string;
  userId: string;
  sessionId: string;
  requestKey: string;
}) {
  const supabase = createSupabaseClient();
  const row = await loadSessionRow(supabase, input.clientId, input.sessionId);
  if (!row) throw reanalysisError("onboarding_not_found", 404);
  const analysis = readStoredPublicAnalysis(row.public_analysis);
  if (!analysis) throw reanalysisError("public_analysis_required", 409);
  const decision = evaluateProfileReanalysis({
    status: readString(row.status),
    currentStep: readString(row.current_step),
    expiresAt: readString(row.expires_at),
    analysis,
    requestKey: input.requestKey,
  });
  if (decision.action === "return_existing") return projectSession(supabase, row);
  if (decision.action === "reject") throw reanalysisError(decision.code, decision.status);

  const attemptCount = (analysis.reanalysis?.attempt_count ?? 0) + 1;
  const startedAt = new Date().toISOString();
  const claimedAnalysis = withReanalysisState(row.public_analysis, {
    request_key: input.requestKey,
    status: "running",
    attempt_count: attemptCount,
    started_at: startedAt,
    completed_at: null,
    error_code: null,
  });
  const claimUpdatedAt = new Date().toISOString();
  const claim = await supabase
    .from("client_instagram_onboarding_sessions")
    .update({ public_analysis: claimedAnalysis, updated_at: claimUpdatedAt })
    .eq("id", input.sessionId)
    .eq("client_id", input.clientId)
    .eq("updated_at", readString(row.updated_at))
    .select(ONBOARDING_SELECT)
    .maybeSingle<Row>();
  if (claim.error) throw reanalysisError("profile_reanalysis_claim_failed", 503);
  if (!claim.data?.id) {
    const concurrent = await loadSessionRow(supabase, input.clientId, input.sessionId);
    if (concurrent) {
      const concurrentAnalysis = readStoredPublicAnalysis(concurrent.public_analysis);
      if (concurrentAnalysis?.reanalysis?.request_key === input.requestKey) {
        return projectSession(supabase, concurrent);
      }
    }
    throw reanalysisError("profile_reanalysis_in_progress", 409);
  }

  const lookup = await lookupInstagramPublicProfile(analysis.username, { disableCache: true });
  if (lookup.status !== "found") {
    await markReanalysisFailed(supabase, claim.data, input.clientId, input.requestKey, lookup.reason || lookup.status);
    if (lookup.status === "not_found") throw reanalysisError("profile_reanalysis_not_found", 404);
    if (lookup.status === "rate_limited") throw reanalysisError("profile_reanalysis_rate_limited", 429);
    if (lookup.reason === "provider_invalid_response") throw reanalysisError("profile_reanalysis_invalid_response", 503);
    throw reanalysisError("profile_reanalysis_provider_unavailable", 503);
  }

  const canonicalUsername = lookup.canonical_username || analysis.username;
  if (canonicalUsername !== analysis.username) {
    await markReanalysisFailed(supabase, claim.data, input.clientId, input.requestKey, "canonical_username_changed");
    throw reanalysisError("profile_reanalysis_identity_mismatch", 409);
  }
  const fresh = buildStoredPublicAnalysis(projectClientPublicProfileLookup(lookup, canonicalUsername));
  const completedAt = new Date().toISOString();
  const merged = withReanalysisState(
    mergeReanalysisPreservingConfirmations(fresh, analysis),
    {
      request_key: input.requestKey,
      status: "completed",
      attempt_count: attemptCount,
      started_at: startedAt,
      completed_at: completedAt,
      error_code: null,
    },
  );
  const completed = await supabase
    .from("client_instagram_onboarding_sessions")
    .update({
      public_analysis: merged,
      last_progress_at: completedAt,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: completedAt,
    })
    .eq("id", input.sessionId)
    .eq("client_id", input.clientId)
    .eq("updated_at", readString(claim.data.updated_at))
    .select(ONBOARDING_SELECT)
    .maybeSingle<Row>();
  if (completed.error) throw reanalysisError("profile_reanalysis_save_failed", 503);
  if (!completed.data?.id) throw reanalysisError("profile_reanalysis_conflict", 409);
  return projectSession(supabase, completed.data);
}

export async function analyzeClientInstagramProfileWithAi(input: {
  clientId: string;
  userId: string;
  sessionId: string;
  requestKey: string;
  provider?: (snapshot: ReturnType<typeof buildProfileIntelligencePromptSnapshot>) => Promise<ProfileIntelligenceProviderResult>;
}) {
  const supabase = createSupabaseClient();
  const row = await loadSessionRow(supabase, input.clientId, input.sessionId);
  if (!row) throw reanalysisError("onboarding_not_found", 404);
  const publicAnalysis = readStoredPublicAnalysis(row.public_analysis);
  if (!publicAnalysis) throw reanalysisError("public_analysis_required", 409);
  const currentAiAnalysis = readStoredProfileAiAnalysis(publicAnalysis.ai_analysis);
  const decision = evaluateProfileAiAnalysis({
    sessionStatus: readString(row.status),
    currentStep: readString(row.current_step),
    expiresAt: readString(row.expires_at),
    requestKey: input.requestKey,
    aiAnalysis: currentAiAnalysis,
  });
  if (decision.action === "return_existing") return projectSession(supabase, row);
  if (decision.action === "reject") throw reanalysisError(decision.code, decision.status);

  const preferredLanguage = await loadClientPreferredLanguage(supabase, input.clientId);
  const outputLanguage = resolveProfileAiOutputLanguage(preferredLanguage, publicAnalysis.language);
  const requestedAt = new Date().toISOString();
  const claimAnalysis = withProfileAiAnalysis(publicAnalysis, {
    ...currentAiAnalysis,
    status: "running",
    request_key: input.requestKey,
    model: profileAiModel(),
    prompt_version: profileIntelligencePromptVersion(outputLanguage),
    output_language: outputLanguage,
    requested_at: requestedAt,
    completed_at: null,
    failed_at: null,
    lease_expires_at: new Date(Date.now() + PROFILE_INTELLIGENCE_LEASE_MS).toISOString(),
    error_code: null,
  });
  const claimUpdatedAt = new Date().toISOString();
  const claim = await supabase
    .from("client_instagram_onboarding_sessions")
    .update({ public_analysis: claimAnalysis, updated_at: claimUpdatedAt })
    .eq("id", input.sessionId)
    .eq("client_id", input.clientId)
    .eq("status", "active")
    .eq("current_step", "analysis")
    .eq("updated_at", readString(row.updated_at))
    .select(ONBOARDING_SELECT)
    .maybeSingle<Row>();
  if (claim.error) throw reanalysisError("profile_ai_claim_failed", 503);
  if (!claim.data?.id) {
    const concurrent = await loadSessionRow(supabase, input.clientId, input.sessionId);
    if (concurrent) {
      const concurrentAnalysis = readStoredPublicAnalysis(concurrent.public_analysis);
      if (concurrentAnalysis?.ai_analysis?.request_key === input.requestKey) return projectSession(supabase, concurrent);
    }
    throw reanalysisError("profile_ai_in_progress", 409);
  }

  const claimedPublicAnalysis = readStoredPublicAnalysis(claim.data.public_analysis);
  if (!claimedPublicAnalysis) throw reanalysisError("public_analysis_required", 409);
  const snapshot = buildProfileIntelligencePromptSnapshot({ ...claimedPublicAnalysis, outputLanguage });
  const providerResult = await (input.provider
    ? input.provider(snapshot)
    : callProfileIntelligenceOpenAi({ snapshot }));
  const finishedAt = new Date().toISOString();
  const targetingQualityFailure = providerResult.errorCode === "output_targeting_quality_insufficient";
  const previousAiAnalysis = readStoredProfileAiAnalysis(claimedPublicAnalysis.ai_analysis);
  const finishedAiAnalysis = {
    ...previousAiAnalysis,
    status: providerResult.ok ? "completed" as const : "failed_retryable" as const,
    model: providerResult.model,
    completed_at: providerResult.ok ? finishedAt : null,
    failed_at: providerResult.ok ? null : finishedAt,
    lease_expires_at: null,
    error_code: providerResult.errorCode,
    suggestions: providerResult.ok ? providerResult.suggestions : targetingQualityFailure ? null : previousAiAnalysis.suggestions,
    confirmation_status: providerResult.ok || targetingQualityFailure ? "pending" as const : previousAiAnalysis.confirmation_status,
    confirmed_at: providerResult.ok || targetingQualityFailure ? null : previousAiAnalysis.confirmed_at,
    confirmed_values: providerResult.ok || targetingQualityFailure ? null : previousAiAnalysis.confirmed_values,
    field_quality: providerResult.fieldQuality ?? previousAiAnalysis.field_quality,
    targeting_quality_valid: providerResult.businessOutputValid
      ? providerResult.targetingQualityValid
      : previousAiAnalysis.targeting_quality_valid,
    metrics: providerResult.metrics,
  };
  const finishedPublicAnalysis = withProfileAiAnalysis(claimedPublicAnalysis, finishedAiAnalysis);
  const completed = await supabase
    .from("client_instagram_onboarding_sessions")
    .update({
      public_analysis: finishedPublicAnalysis,
      last_progress_at: finishedAt,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      updated_at: finishedAt,
    })
    .eq("id", input.sessionId)
    .eq("client_id", input.clientId)
    .eq("status", "active")
    .eq("current_step", "analysis")
    .eq("updated_at", readString(claim.data.updated_at))
    .select(ONBOARDING_SELECT)
    .maybeSingle<Row>();
  if (completed.error) throw reanalysisError("profile_ai_save_failed", 503);
  if (!completed.data?.id) throw reanalysisError("profile_ai_conflict", 409);
  console.info("[Profile Intelligence V2]", {
    event: providerResult.ok ? "analysis_completed" : "analysis_failed_retryable",
    model: providerResult.model,
    provider_call_attempted: providerResult.providerCallAttempted,
    output_language: providerResult.outputLanguage,
    schema_valid: providerResult.schemaValid,
    business_output_valid: providerResult.businessOutputValid,
    no_geo_valid: providerResult.noGeoValid,
    targeting_quality_valid: providerResult.targetingQualityValid,
    field_quality: providerResult.fieldQuality,
    targeting_quality_reasons: providerResult.targetingQualityValidation?.reasons ?? [],
    error_code: providerResult.errorCode,
    provider_http_status: providerResult.diagnostic.http_status,
    provider_error_type: providerResult.diagnostic.error_type,
    provider_error_code: providerResult.diagnostic.error_code,
    provider_error_param: providerResult.diagnostic.error_param,
    provider_request_id: providerResult.diagnostic.request_id,
    provider_error_category: providerResult.diagnostic.category,
    ...providerResult.metrics,
  });
  return projectSession(supabase, completed.data);
}

export async function loadClientOnboardingAvatarSource(clientId: string, sessionId: string) {
  const supabase = createSupabaseClient();
  const row = await loadSessionRow(supabase, clientId, sessionId);
  if (!row || !readString(row.account_id)) return null;
  const source = onboardingAvatarSource(row.public_analysis);
  if (!source?.username || !source.avatarUrl) return null;
  return source;
}
