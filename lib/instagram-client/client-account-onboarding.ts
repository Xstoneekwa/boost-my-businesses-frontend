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
  type ClientPublicAnalysis,
} from "./profile-intelligence";
import { evaluateProfileReanalysis } from "./profile-reanalysis-policy";

type Row = Record<string, unknown>;
type Supabase = ReturnType<typeof createSupabaseClient>;

export { CLIENT_ONBOARDING_TARGET_MINIMUM, hasClientOnboardingTargetMinimum };

export type ClientOnboardingStep = "connection" | "analysis" | "targeting" | "targets" | "complete";
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
};

const ONBOARDING_SELECT = [
  "id", "client_id", "entitlement_id", "account_id", "idempotency_key",
  "requested_username", "package_code", "status", "current_step",
  "public_analysis", "targeting_criteria", "last_error_code", "completed_at",
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
    .limit(1)
    .maybeSingle<Row>();
  if (error) throw new Error("onboarding_lookup_failed");
  return data?.id ? projectSession(supabase, data) : null;
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
  action: "save_analysis" | "save_targeting" | "open_targets" | "complete" | "abandon";
  value?: unknown;
}) {
  const supabase = createSupabaseClient();
  const row = await loadSessionRow(supabase, input.clientId, input.sessionId);
  if (!row) throw Object.assign(new Error("onboarding_not_found"), { status: 404 });
  if (readString(row.status) === "completed") return projectSession(supabase, row);

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
  const startedAt = readString(readObject(readObject(row.public_analysis).reanalysis).started_at) || new Date().toISOString();
  const failed = withReanalysisState(row.public_analysis, {
    request_key: requestKey,
    status: "failed",
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

  const startedAt = new Date().toISOString();
  const claimedAnalysis = withReanalysisState(row.public_analysis, {
    request_key: input.requestKey,
    status: "running",
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

export async function loadClientOnboardingAvatarSource(clientId: string, sessionId: string) {
  const supabase = createSupabaseClient();
  const row = await loadSessionRow(supabase, clientId, sessionId);
  if (!row || !readString(row.account_id)) return null;
  const source = onboardingAvatarSource(row.public_analysis);
  if (!source?.username || !source.avatarUrl) return null;
  return source;
}
