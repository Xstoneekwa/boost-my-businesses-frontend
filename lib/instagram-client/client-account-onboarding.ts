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
import { createClientInstagramAccount, type ClientPublicProfileProjection } from "./create-account";
import {
  CLIENT_ONBOARDING_TARGET_MINIMUM,
  hasClientOnboardingTargetMinimum,
} from "./client-account-onboarding-policy";
import { readString } from "./guards";

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

export type ClientPublicAnalysis = ClientPublicProfileProjection & {
  category: string | null;
  language: string | null;
  location: string | null;
  niche: string | null;
  themes: string[];
  probableAudience: string | null;
  sources: Record<string, "public" | "suggested" | "user_confirmed" | "not_detected">;
};

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

export function sanitizePublicAnalysis(value: unknown, base?: ClientPublicAnalysis | null): ClientPublicAnalysis {
  const row = readObject(value);
  const current = base ?? {
    lookupStatus: "unknown",
    username: "",
    displayName: null,
    biography: null,
    avatarUrl: null,
    followersCount: null,
    isPrivate: null,
    isVerified: null,
    checkedAt: new Date(0).toISOString(),
    category: null,
    language: null,
    location: null,
    niche: null,
    themes: [],
    probableAudience: null,
    sources: {},
  };
  const editableKeys = ["displayName", "biography", "category", "language", "location", "niche", "probableAudience"] as const;
  const sources = { ...current.sources };
  for (const key of editableKeys) {
    const next = optionalText(row[key], key === "biography" ? 2000 : 500);
    sources[key] = next
      ? next === current[key] ? current.sources[key] ?? "public" : "user_confirmed"
      : "not_detected";
  }
  const themes = readStringList(row.themes);
  sources.themes = themes.length
    ? JSON.stringify(themes) === JSON.stringify(current.themes)
      ? current.sources.themes ?? "suggested"
      : "user_confirmed"
    : "not_detected";
  return {
    ...current,
    displayName: optionalText(row.displayName),
    biography: optionalText(row.biography, 2000),
    category: optionalText(row.category),
    language: optionalText(row.language),
    location: optionalText(row.location),
    niche: optionalText(row.niche),
    themes,
    probableAudience: optionalText(row.probableAudience),
    sources,
  };
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

function publicAnalysisFromProfile(profile: ClientPublicProfileProjection): ClientPublicAnalysis {
  return {
    ...profile,
    category: null,
    language: null,
    location: null,
    niche: null,
    themes: [],
    probableAudience: null,
    sources: {
      username: "public",
      displayName: profile.displayName ? "public" : "not_detected",
      biography: profile.biography ? "public" : "not_detected",
      avatarUrl: profile.avatarUrl ? "public" : "not_detected",
      followersCount: profile.followersCount != null ? "public" : "not_detected",
      category: "not_detected",
      language: "not_detected",
      location: "not_detected",
      niche: "not_detected",
      themes: "not_detected",
      probableAudience: "not_detected",
    },
  };
}

function mapAnalysis(value: unknown): ClientPublicAnalysis | null {
  const row = readObject(value);
  if (!readString(row.username)) return null;
  return {
    lookupStatus: readString(row.lookupStatus, "unknown"),
    username: readString(row.username),
    displayName: optionalText(row.displayName),
    biography: optionalText(row.biography, 2000),
    avatarUrl: optionalText(row.avatarUrl, 2000),
    followersCount: Number.isFinite(Number(row.followersCount)) ? Number(row.followersCount) : null,
    isPrivate: typeof row.isPrivate === "boolean" ? row.isPrivate : null,
    isVerified: typeof row.isVerified === "boolean" ? row.isVerified : null,
    checkedAt: readString(row.checkedAt),
    category: optionalText(row.category),
    language: optionalText(row.language),
    location: optionalText(row.location),
    niche: optionalText(row.niche),
    themes: readStringList(row.themes),
    probableAudience: optionalText(row.probableAudience),
    sources: readObject(row.sources) as ClientPublicAnalysis["sources"],
  };
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

  const analysis = publicAnalysisFromProfile(validation.publicProfile);
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
    ? sanitizePublicAnalysis(input.value, mapAnalysis(row.public_analysis))
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
