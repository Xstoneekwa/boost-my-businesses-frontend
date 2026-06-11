import { createSupabaseClient } from "@/lib/supabase";
import { defaultInstagramFilters, defaultInstagramSettings } from "@/lib/instagram-dashboard/defaults";
import {
  isPlausibleInstagramPublicUsername,
  lookupInstagramPublicProfile,
  normalizeInstagramPublicUsername,
  type InstagramPublicProfileLookupResult,
} from "@/lib/instagram-public-profile-lookup";
import { canAccessTenantPages } from "@/lib/restaurant-analytics/session";
import {
  defaultAddProfileCommercialPackage,
  isAddProfileAddonCode,
  isAddProfileCommercialPackage,
  resolveAddProfilePackagePreset,
  type AddProfileRuntimeMode,
} from "@/lib/instagram-dashboard/add-profile-packages";
import { resolveAddProfileAssignmentPolicy } from "@/lib/instagram-dashboard/add-profile-assignment-policy";
import { applyAddProfileRuntimeDefaults } from "@/lib/instagram-dashboard/add-profile-runtime-defaults";
import { ensureAddProfileOwnership } from "@/lib/instagram-dashboard/ensure-add-profile-ownership";
import { tryAutoAssignOnboardingSchedule } from "@/lib/instagram-dashboard/onboarding-schedule";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  type SupabaseRecord,
} from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

type CreateProfilePayload = {
  username?: unknown;
  password?: unknown;
  email?: unknown;
  display_name?: unknown;
  internal_label?: unknown;
  notes?: unknown;
  login_method?: unknown;
  clone_mode?: unknown;
  device_id?: unknown;
  app_instance_id?: unknown;
  device_name?: unknown;
  device_udid?: unknown;
  template_mode?: unknown;
  template_id?: unknown;
  runtime_mode?: unknown;
  commercial_package?: unknown;
  addons?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
  dry_run?: unknown;
  provisioning_enabled?: unknown;
  login_enabled?: unknown;
  start_run?: unknown;
};

type AddProfileCredentialsResponse = {
  request_id: string;
  account_id: string;
  provider: string;
  credentials_version: string;
  credentials_status: string;
  status: string;
  reauth_required: boolean;
  next_action: string;
  password_status: "write_only";
};

type AddProfileCredentialsInput = {
  accountId: string;
  expectedUsername: string;
  password: string;
  actorType: "admin";
  externalRequestId: string;
};

const credentialsTimeoutMs = 9000;
const activeAccountStatus = "active";
const supportRequiredStatus = "support_required";
const addProfileOperation = "add_profile";
const addProfileSourceSurface = "admin_dashboard";
const defaultWelcomeDmDayCap = 10;
const defaultOutreachDmDayCap = 30;
const defaultWelcomeDmSessionCap = 10;
const defaultOutreachDmSessionCap = 5;
const defaultTotalDmDayCap = defaultWelcomeDmDayCap + defaultOutreachDmDayCap;
const activeDashboardActionStatuses = ["pending", "acknowledged", "pending_verification"];
const loginMethods = new Set(["manual", "credentials"]);
const runtimeModes = new Set(["safe_setup", "follow_only_test", "full_cycle", "outreach_only"]);
const sensitivePayloadKeys = new Set([
  "password",
  "email",
  "device_udid",
  "app_package",
  "secret_ref",
  "vault_id",
  "vault_value",
  "token",
  "authorization",
  "service_role",
  "metadata",
  "metadata_safe",
  "raw_metadata",
  "raw_request_body",
]);
const sensitivePayloadFragments = ["password", "secret", "vault", "token", "authorization", "service_role"];

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return { mode: "relay_key" as const, userId: null };
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    const response = jsonError("Add profile relay authentication failed.", 403, { reason: relayAuth.reason });
    return { mode: "unauthorized" as const, response };
  }
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return { mode: "unauthorized" as const, response: unauthorizedResponse };
  const adminContext = await getInstagramAdminUserContext();
  if (adminContext && !canAccessTenantPages(adminContext)) {
    return { mode: "unauthorized" as const, response: jsonError("You are not authorized to access the Instagram dashboard.", 403) };
  }
  return { mode: "admin_session" as const, userId: adminContext?.userId ?? null };
}

function isRecord(value: unknown): value is Record<string, string | number | boolean> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readCreateBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  const normalized = readString(value, "").trim().toLowerCase();
  if (["true", "1", "yes", "enabled"].includes(normalized)) return true;
  if (["false", "0", "no", "disabled"].includes(normalized)) return false;
  return fallback;
}

function truncateSafe(value: string, maxLength = 120) {
  return value.trim().slice(0, maxLength);
}

function safeFailureReason(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_:-]/g, "_");
  return normalized.slice(0, 120) || "unknown";
}

function redactTemplatePayload(payload: Record<string, string | number | boolean>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([key]) => {
      const normalizedKey = key.toLowerCase();
      return !sensitivePayloadKeys.has(normalizedKey) && !sensitivePayloadFragments.some((fragment) => normalizedKey.includes(fragment));
    }),
  ) as Record<string, string | number | boolean>;
}

function credentialsConfig() {
  const url = process.env.INSTAGRAM_CREDENTIALS_API_URL?.trim();
  const token = process.env.INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

function safeCredentialString(value: unknown, fallback = "") {
  return readString(value, fallback).trim();
}

function safeCredentialBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function safeCredentialsResponse(value: unknown): AddProfileCredentialsResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("credentials_invalid_response");
  }

  const row = value as SupabaseRecord;
  return {
    request_id: safeCredentialString(row.request_id),
    account_id: safeCredentialString(row.account_id),
    provider: safeCredentialString(row.provider),
    credentials_version: safeCredentialString(row.credentials_version),
    credentials_status: safeCredentialString(row.credentials_status, "unknown"),
    status: safeCredentialString(row.status, "unknown"),
    reauth_required: safeCredentialBoolean(row.reauth_required, false),
    next_action: safeCredentialString(row.next_action, "unknown"),
    password_status: "write_only",
  };
}

function isActiveCredentials(credentials: AddProfileCredentialsResponse) {
  return credentials.credentials_status === "active" && credentials.status === "active";
}

function isDuplicateAccountError(error: { code?: string; message?: string; details?: string } | null) {
  const combined = `${error?.code ?? ""} ${error?.message ?? ""} ${error?.details ?? ""}`.toLowerCase();
  return combined.includes("23505") || combined.includes("ig_accounts_username_lower_unique");
}

function verificationStatusForLookup(lookup: InstagramPublicProfileLookupResult) {
  if (lookup.status === "found") return "verified";
  if (lookup.status === "username_invalid") return "invalid_format";
  if (lookup.status === "provider_error" || lookup.status === "rate_limited") return "provider_error";
  return "verification_unavailable";
}

function verificationReasonForLookup(lookup: InstagramPublicProfileLookupResult) {
  if (lookup.status === "found") return "found";
  if (lookup.status === "provider_not_configured") return "provider_not_configured";
  if (lookup.status === "rate_limited") return "rate_limited";
  return lookup.reason || lookup.status;
}

function publicProfileMetadataForLookup(lookup: InstagramPublicProfileLookupResult) {
  const metadata: Record<string, string | number | boolean | null> = {
    source: addProfileOperation,
    source_surface: addProfileSourceSurface,
    provider_status: lookup.status,
    reason: verificationReasonForLookup(lookup),
    input_username: lookup.input_username,
  };
  if (lookup.canonical_username) metadata.canonical_username = lookup.canonical_username;
  for (const [key, value] of Object.entries(lookup.metadata)) {
    metadata[`provider_${key}`] = value;
  }
  return metadata;
}

function profileVerificationPayload(lookup: InstagramPublicProfileLookupResult) {
  const verified = lookup.status === "found";
  return {
    username_verification_status: verificationStatusForLookup(lookup),
    username_verified_at: verified ? lookup.checked_at : null,
    username_verification_reason: verificationReasonForLookup(lookup),
    instagram_user_id: lookup.instagram_user_id,
    external_profile_id: lookup.external_profile_id,
    is_private: lookup.is_private,
    is_verified: lookup.is_verified,
    followers_count: lookup.followers_count,
    avatar_url: lookup.avatar_url,
    avatar_checked_at: lookup.avatar_url ? lookup.checked_at : null,
    public_profile_metadata: publicProfileMetadataForLookup(lookup),
  };
}

async function callSubmitAddProfileCredentials(input: AddProfileCredentialsInput) {
  const config = credentialsConfig();
  if (!config) {
    throw new Error("credentials_api_not_configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), credentialsTimeoutMs);

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "submit_add_profile_credentials",
        account_id: input.accountId,
        expected_username: input.expectedUsername,
        password: input.password,
        actor_type: input.actorType,
        metadata_safe: {
          flow: "add_profile",
          external_request_id: input.externalRequestId,
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error("credentials_ingestion_failed");
    }

    const payload = await response.json() as { ok?: unknown; data?: unknown } & SupabaseRecord;
    if (payload.ok !== true) {
      throw new Error("credentials_ingestion_failed");
    }

    return safeCredentialsResponse(payload.data ?? payload);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("credentials_ingestion_timeout");
    }
    if (error instanceof Error && error.message === "credentials_api_not_configured") {
      throw error;
    }
    if (error instanceof Error && error.message === "credentials_invalid_response") {
      throw error;
    }
    throw new Error("credentials_ingestion_failed");
  } finally {
    clearTimeout(timeout);
  }
}

async function markCredentialFailure(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  await Promise.all([
    supabase
      .from("ig_accounts")
      .update({ status: supportRequiredStatus })
      .eq("id", accountId),
    supabase
      .from("ig_account_settings")
      .update({ account_status: supportRequiredStatus, password: "" })
      .eq("account_id", accountId),
  ]);
}

async function createCredentialSupportAction(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  reason: string,
  externalRequestId: string,
  actorId: string | null,
) {
  await supabase.rpc("upsert_account_dashboard_action", {
    p_account_id: accountId,
    p_client_id: null,
    p_incident_id: null,
    p_action_type: "review_credentials",
    p_status: "pending",
    p_title: "Review Instagram credentials",
    p_dedupe_key: `account:${accountId}:dashboard_action:review_credentials`,
    p_safe_client_message: "Instagram credentials need review before this profile can run.",
    p_admin_message: "Add Profile credential ingestion did not complete.",
    p_assistant_message: null,
    p_action_label: "Review",
    p_action_deep_link: "/instagram-dashboard/credentials-actions",
    p_severity: "warning",
    p_audience: "admin",
    p_requires_client_action: false,
    p_blocking_campaign: true,
    p_metadata: {
      source: addProfileOperation,
      phase: "credentials_ingestion",
      reason: safeFailureReason(reason),
      source_surface: addProfileSourceSurface,
      external_request_id: truncateSafe(externalRequestId),
      ...(actorId ? { actor_type: "admin", actor_id: actorId } : {}),
    },
  });
}

async function markCredentialFailureWithSupportAction(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  reason: string,
  externalRequestId: string,
  actorId: string | null,
) {
  await markCredentialFailure(supabase, accountId);
  try {
    await createCredentialSupportAction(supabase, accountId, reason, externalRequestId, actorId);
  } catch {
    // Status is the safety boundary; support action creation is best-effort.
  }
}

function readAddonCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => readString(entry, ""))
    .filter((entry) => isAddProfileAddonCode(entry));
}

function readCommercialPackage(value: unknown) {
  const normalized = readString(value, defaultAddProfileCommercialPackage());
  return isAddProfileCommercialPackage(normalized) ? normalized : defaultAddProfileCommercialPackage();
}

function addProfilePartialMeta(input: {
  accountId: string;
  accountCreated: boolean;
  credentialsSaved: boolean;
  assignmentFailed?: boolean;
  reason?: string;
  repairPossible?: boolean;
}) {
  return {
    partial: {
      account_created: input.accountCreated,
      account_id: input.accountId,
      credentials_saved: input.credentialsSaved,
      assignment_failed: input.assignmentFailed ?? false,
      reason: input.reason ?? null,
      repair_possible: input.repairPossible ?? false,
    },
  };
}

async function loadRepairableAddProfileAccount(
  supabase: ReturnType<typeof createSupabaseClient>,
  username: string,
) {
  const { data: account, error } = await supabase
    .from("ig_accounts")
    .select("*")
    .eq("username", username)
    .maybeSingle<SupabaseRecord>();

  if (error || !account) return { kind: "new" as const };
  if (readString(account.status, "") === activeAccountStatus) {
    return { kind: "duplicate_active" as const, account };
  }

  const { count } = await supabase
    .from("account_assignments")
    .select("id", { count: "exact", head: true })
    .eq("account_id", readString(account.id, ""))
    .in("status", ["reserved", "active"]);

  if ((count ?? 0) > 0) {
    return { kind: "duplicate_assigned" as const, account };
  }

  if (readString(account.status, "") !== supportRequiredStatus) {
    return { kind: "duplicate_active" as const, account };
  }

  return { kind: "repair" as const, account };
}

async function compensateNewProfile(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const { error } = await supabase
    .from("ig_accounts")
    .delete()
    .eq("id", accountId);
  return !error;
}

async function finalizeActiveProfile(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
) {
  const [accountResult, settingsResult] = await Promise.all([
    supabase
      .from("ig_accounts")
      .update({ status: activeAccountStatus })
      .eq("id", accountId),
    supabase
      .from("ig_account_settings")
      .update({ account_status: activeAccountStatus, password: "" })
      .eq("account_id", accountId),
  ]);

  return !accountResult.error && !settingsResult.error;
}

async function resolveCredentialDashboardActions(
  supabase: ReturnType<typeof createSupabaseClient>,
  accountId: string,
  externalRequestId: string,
  actorId: string | null,
) {
  const { data } = await supabase
    .from("account_dashboard_actions")
    .select("id")
    .eq("account_id", accountId)
    .in("action_type", ["submit_instagram_credentials", "review_credentials"])
    .in("status", activeDashboardActionStatuses);

  const rows = Array.isArray(data) ? data : [];
  await Promise.all(rows.map((row) => {
    const actionId = readString((row as SupabaseRecord).id, "");
    if (!actionId) return Promise.resolve();
    return supabase.rpc("transition_account_dashboard_action", {
      p_action_id: actionId,
      p_new_status: "resolved",
      p_actor_type: "admin",
      p_actor_id: actorId || null,
      p_reason: "add_profile_success",
      p_metadata: {
        source: addProfileOperation,
        phase: "finalize_active",
        source_surface: addProfileSourceSurface,
        external_request_id: truncateSafe(externalRequestId),
      },
    });
  }));
}

async function recordAddProfileAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    accountId?: string | null;
    username: string;
    externalRequestId: string;
    credentialRequestId?: string | null;
    actorId?: string | null;
    resultStatus: "success" | "failed" | "compensated" | "duplicate";
    failureReason?: string | null;
    metadataSafe?: Record<string, string | number | boolean | null>;
  },
) {
  await supabase.from("add_profile_audit_events").insert({
    account_id: input.accountId || null,
    username: truncateSafe(input.username.toLowerCase(), 120),
    request_id: truncateSafe(input.externalRequestId, 120),
    credential_request_id: input.credentialRequestId ? truncateSafe(input.credentialRequestId, 120) : null,
    source_surface: addProfileSourceSurface,
    operation: addProfileOperation,
    result_status: input.resultStatus,
    failure_reason: input.failureReason ? safeFailureReason(input.failureReason) : null,
    actor_type: "admin",
    actor_id: input.actorId || null,
    metadata_safe: {
      source: addProfileOperation,
      source_surface: addProfileSourceSurface,
      result_status: input.resultStatus,
      ...(input.failureReason ? { failure_reason: safeFailureReason(input.failureReason) } : {}),
      ...(input.metadataSafe ?? {}),
    },
  });
}

async function tryRecordAddProfileAudit(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: Parameters<typeof recordAddProfileAudit>[1],
) {
  try {
    await recordAddProfileAudit(supabase, input);
  } catch {
    // Audit must never leak or change the user-facing Add Profile error path.
  }
}

async function fetchTemplate(
  supabase: ReturnType<typeof createSupabaseClient>,
  templateMode: string,
  templateId: string,
) {
  if (templateMode === "scratch") return null;

  const query = supabase.from("ig_account_templates").select("*");
  const result = templateMode === "selected" && templateId
    ? await query.eq("id", templateId).maybeSingle<SupabaseRecord>()
    : await query.eq("is_default", true).maybeSingle<SupabaseRecord>();

  return result.data ?? null;
}

async function fetchOnboardingTarget(
  supabase: ReturnType<typeof createSupabaseClient>,
  deviceId: string,
  appInstanceId: string,
) {
  if (!isUuid(deviceId) || !isUuid(appInstanceId)) {
    throw new Error("manual_target_required");
  }

  const [{ data: phone, error: phoneError }, { data: appInstance, error: appError }] = await Promise.all([
    supabase
      .from("phone_devices")
      .select("id,name,device_name,adb_serial,status,pool_type,timezone")
      .eq("id", deviceId)
      .limit(1)
      .maybeSingle<SupabaseRecord>(),
    supabase
      .from("phone_app_instances")
      .select("id,device_id,instance_type,instance_index,visible_label,package_name,status,current_account_id,usable_for_auto_login,is_launchable")
      .eq("id", appInstanceId)
      .limit(1)
      .maybeSingle<SupabaseRecord>(),
  ]);

  if (phoneError || !phone) throw new Error("device_unavailable");
  if (appError || !appInstance) throw new Error("app_instance_unavailable");
  if (readString(appInstance.device_id, "") !== deviceId) throw new Error("app_instance_device_mismatch");
  if (readString(appInstance.status, "") !== "available" || readString(appInstance.current_account_id, "")) {
    throw new Error("app_instance_occupied");
  }
  if (appInstance.usable_for_auto_login !== true || appInstance.is_launchable !== true) {
    throw new Error("app_instance_not_launchable");
  }

  return {
    phone,
    appInstance,
    deviceName: readString(phone.name, readString(phone.device_name, "Unknown phone")),
    packageName: readString(appInstance.package_name, ""),
    appInstanceLabel: readString(appInstance.visible_label, `Clone ${readString(appInstance.instance_index, "")}`),
    appInstanceIndex: Number(appInstance.instance_index ?? 0),
  };
}

function safeCreateResponse(
  account: SupabaseRecord,
  credentials: AddProfileCredentialsResponse | null,
  scheduleMeta?: {
    onboarding_schedule_assigned?: boolean;
    onboarding_schedule_reason?: string;
    assignment?: SupabaseRecord;
    package_name?: string;
    runtime_defaults_applied?: boolean;
    runtime_defaults_reason?: string | null;
  },
  source = "admin_dashboard",
) {
  return {
    source,
    account: {
      id: readString(account.id, ""),
      username: readString(account.username, ""),
      display_name: readString(account.display_name, ""),
      status: readString(account.status, "active"),
    },
    settings: {
      status: "created",
      password_status: credentials ? "write_only" : "not_submitted",
      device_assignment: readString(account.device_name, "pending source"),
      onboarding_schedule_assigned: scheduleMeta?.onboarding_schedule_assigned ?? false,
      onboarding_schedule_reason: scheduleMeta?.onboarding_schedule_reason ?? "not_attempted",
    },
    credentials: credentials
      ? {
        request_id: credentials.request_id,
        account_id: credentials.account_id,
        provider: credentials.provider,
        credentials_version: credentials.credentials_version,
        credentials_status: credentials.credentials_status,
        status: credentials.status,
        reauth_required: credentials.reauth_required,
        next_action: credentials.next_action,
        password_status: "write_only",
      }
      : {
        credentials_status: "not_submitted",
        status: "manual_login_pending",
        password_status: "not_submitted",
      },
    assignment: {
      status: scheduleMeta?.onboarding_schedule_assigned ? "reserved" : "not_created",
      reason: scheduleMeta?.onboarding_schedule_reason ?? "not_attempted",
      package_name: scheduleMeta?.package_name ?? null,
    },
    filters: { status: "created" },
    template: { status: "applied_server_side" },
    automation: {
      provisioning_started: false,
      login_started: false,
      run_started: false,
      runtime_defaults_applied: scheduleMeta?.runtime_defaults_applied ?? false,
      runtime_defaults_reason: scheduleMeta?.runtime_defaults_reason ?? null,
    },
  };
}

export async function POST(request: Request) {
  try {
    const auth = await requireRelayOrAdmin(request);
    if (auth.mode === "unauthorized") return auth.response;
    const actorId = auth.userId;

    const body = await readJsonBody<CreateProfilePayload>(request);
    if (!body) return jsonError("Invalid profile payload.", 400);
    const dryRun = body.dry_run === true || readString(body.dry_run, "").toLowerCase() === "true";
    const botAppNoAutomationCreate =
      auth.mode === "relay_key" &&
      !dryRun &&
      readCreateBoolean(body.provisioning_enabled, true) === false &&
      readCreateBoolean(body.login_enabled, true) === false &&
      readCreateBoolean(body.start_run, true) === false;

    const username = normalizeInstagramPublicUsername(readString(body.username, ""));
    if (!username) return jsonError("Instagram username is required.", 400);
    if (!isPlausibleInstagramPublicUsername(username)) return jsonError("username_verification_failed", 400);
    const loginMethod = readString(body.login_method, "manual").trim();
    if (!loginMethods.has(loginMethod)) return jsonError("Invalid login method.", 400);
    const password = readString(body.password, "");

    const externalRequestId = crypto.randomUUID();
    const supabase = createSupabaseClient();
    const profileLookup = await lookupInstagramPublicProfile(username);
    if (profileLookup.status === "username_invalid") {
      await tryRecordAddProfileAudit(supabase, {
        username,
        externalRequestId,
        actorId,
        resultStatus: "failed",
        failureReason: "username_verification_failed",
      });
      return jsonError("username_verification_failed", 400);
    }
    if (profileLookup.status === "not_found") {
      await tryRecordAddProfileAudit(supabase, {
        username,
        externalRequestId,
        actorId,
        resultStatus: "failed",
        failureReason: "username_not_found",
      });
      return jsonError("username_not_found", 400);
    }

    const accountUsername = profileLookup.status === "found" &&
      profileLookup.canonical_username &&
      isPlausibleInstagramPublicUsername(profileLookup.canonical_username)
      ? profileLookup.canonical_username
      : username;

    const earlyRepairState = await loadRepairableAddProfileAccount(supabase, accountUsername);
    let repairCredentialsAlreadySaved = false;
    if (earlyRepairState.kind === "repair") {
      const repairAccountId = readString(earlyRepairState.account.id, "");
      const { data: repairCredentials } = await supabase
        .from("account_credentials")
        .select("id")
        .eq("account_id", repairAccountId)
        .eq("status", "active")
        .limit(1)
        .maybeSingle<SupabaseRecord>();
      repairCredentialsAlreadySaved = Boolean(repairCredentials?.id);
    }

    if (loginMethod === "credentials" && !password && !repairCredentialsAlreadySaved) {
      return jsonError("Instagram password is required for secure credential setup.", 400);
    }
    if (!dryRun && loginMethod === "credentials" && password && !credentialsConfig()) {
      return jsonError("credentials_api_not_configured", 500);
    }
    if (!dryRun && loginMethod === "credentials" && !password && repairCredentialsAlreadySaved && !credentialsConfig()) {
      return jsonError("credentials_api_not_configured", 500);
    }

    const displayName = readString(body.display_name, "").trim();
    const deviceId = readString(body.device_id, "").trim();
    const appInstanceId = readString(body.app_instance_id, "").trim();
    const cloneMode = readString(body.clone_mode, "off").trim();
    const templateMode = readString(body.template_mode, "default").trim();
    const templateId = readString(body.template_id, "").trim();
    const runtimeMode = readString(body.runtime_mode, "safe_setup").trim();
    if (!runtimeModes.has(runtimeMode)) return jsonError("Invalid runtime mode.", 400);
    const commercialPackage = readCommercialPackage(body.commercial_package);
    const selectedAddons = readAddonCodes(body.addons);
    const packagePreset = resolveAddProfilePackagePreset({
      commercialPackage,
      runtimeMode: runtimeMode as AddProfileRuntimeMode,
      addons: selectedAddons,
    });
    const startsAt = readString(body.starts_at, "").trim();
    const endsAt = readString(body.ends_at, "").trim();
    const assignmentPolicy = resolveAddProfileAssignmentPolicy({
      runtimeMode: runtimeMode as AddProfileRuntimeMode,
      deviceId,
      appInstanceId,
      startsAt,
      endsAt,
      allowScheduledWait: false,
    });
    if (!assignmentPolicy.shouldAssignNow) return jsonError(assignmentPolicy.reason, 409);
    if (!startsAt || !endsAt) return jsonError("Schedule slot is required.", 400);
    const targetResult = await fetchOnboardingTarget(supabase, deviceId, appInstanceId)
      .then((target) => ({ ok: true as const, target }))
      .catch((error) => ({
        ok: false as const,
        reason: error instanceof Error ? error.message : "manual_target_invalid",
      }));
    if (!targetResult.ok) return jsonError(targetResult.reason, 409);
    const target = targetResult.target;
    const deviceName = target.deviceName;
    const template = await fetchTemplate(supabase, templateMode, templateId);
    const deviceUdid = "";
    const settingsPayload = isRecord(template?.settings_payload) ? redactTemplatePayload(template.settings_payload) : {};
    const filtersPayload = isRecord(template?.filters_payload) ? redactTemplatePayload(template.filters_payload) : {};

    if (dryRun) {
      return jsonOk({
        dry_run: true,
        would_create: earlyRepairState.kind === "repair" ? "repair_existing_support_required_account" : "new_account",
        account: {
          account_id: earlyRepairState.kind === "repair" ? readString(earlyRepairState.account.id, "") : null,
          username: accountUsername,
          status: supportRequiredStatus,
          credential_status: loginMethod === "credentials" ? "would_submit_write_only" : "not_submitted",
          assignment_status: "would_assign",
        },
        assignment: {
          device_id: deviceId,
          app_instance_id: appInstanceId,
          starts_at: startsAt,
          ends_at: endsAt,
          device_name: deviceName,
        },
        settings: {
          defaults: "would_apply_server_defaults",
          template: template ? "would_apply_server_template" : "default_template",
          dry_run_enabled: true,
        },
        automation: {
          provisioning_started: false,
          login_started: false,
          run_started: false,
        },
        source: auth.mode === "relay_key" ? "botapp_relay" : "admin_dashboard",
        sensitive_values_excluded: true,
      });
    }

    const accountPayload = {
      username: accountUsername,
      display_name: displayName,
      status: supportRequiredStatus,
      // ig_accounts.device_id FK still points at legacy ig_devices; phone placement uses assign_account_slot.
      device_id: null,
      device_name: deviceName,
      device_udid: deviceUdid,
      clone_mode: cloneMode,
      login_method: loginMethod,
      internal_label: readString(body.internal_label, "").trim() || null,
      notes: readString(body.notes, "").trim() || null,
      ...profileVerificationPayload(profileLookup),
    };

    const repairState = earlyRepairState;
    if (repairState.kind === "duplicate_active" || repairState.kind === "duplicate_assigned") {
      await tryRecordAddProfileAudit(supabase, {
        username: accountUsername,
        externalRequestId,
        actorId,
        resultStatus: "duplicate",
        failureReason: "account_already_exists",
      });
      return jsonError("account_already_exists", 409);
    }

    let account: SupabaseRecord;
    let accountCreated = false;
    if (repairState.kind === "repair") {
      account = repairState.account;
    } else {
      const { data: insertedAccount, error: accountError } = await supabase
        .from("ig_accounts")
        .insert(accountPayload)
        .select("*")
        .single<SupabaseRecord>();

      if (accountError) {
        if (isDuplicateAccountError(accountError)) {
          const duplicateRepair = await loadRepairableAddProfileAccount(supabase, accountUsername);
          if (duplicateRepair.kind !== "repair") {
            await tryRecordAddProfileAudit(supabase, {
              username: accountUsername,
              externalRequestId,
              actorId,
              resultStatus: "duplicate",
              failureReason: "account_already_exists",
            });
            return jsonError("account_already_exists", 409);
          }
          account = duplicateRepair.account;
        } else {
          await tryRecordAddProfileAudit(supabase, {
            username: accountUsername,
            externalRequestId,
            actorId,
            resultStatus: "failed",
            failureReason: "account_create_failed",
          });
          return jsonError("account_create_failed", 500);
        }
      } else {
        account = insertedAccount;
        accountCreated = true;
      }
    }

    const accountId = readString(account.id, "");
    const settings = {
      ...defaultInstagramSettings,
      ...settingsPayload,
      account_id: accountId,
      username: accountUsername,
      display_name: displayName,
      device_name: deviceName,
      device_udid: deviceUdid,
      email: readString(body.email, "").trim(),
      password: "",
      account_status: supportRequiredStatus,
      cloned_app_mode: cloneMode !== "off",
      dry_run_enabled: true,
    };
    const filters = {
      ...defaultInstagramFilters,
      ...filtersPayload,
      account_id: accountId,
    };

    const { data: existingSettings } = await supabase
      .from("ig_account_settings")
      .select("account_id")
      .eq("account_id", accountId)
      .maybeSingle<SupabaseRecord>();

    const settingsResult = existingSettings
      ? { data: existingSettings, error: null }
      : await supabase
        .from("ig_account_settings")
        .insert(settings)
        .select("*")
        .single<SupabaseRecord>();

    if (settingsResult.error) {
      const compensated = await compensateNewProfile(supabase, accountId);
      await tryRecordAddProfileAudit(supabase, {
        accountId,
        username: accountUsername,
        externalRequestId,
        actorId,
        resultStatus: compensated ? "compensated" : "failed",
        failureReason: compensated ? "profile_settings_create_failed" : "profile_settings_compensation_failed",
      });
      if (!compensated) {
        await markCredentialFailureWithSupportAction(supabase, accountId, "profile_settings_compensation_failed", externalRequestId, actorId);
      }
      return jsonError("profile_setup_failed", 500);
    }

    const { data: existingFilters } = await supabase
      .from("ig_account_filters")
      .select("account_id")
      .eq("account_id", accountId)
      .maybeSingle<SupabaseRecord>();

    const filtersResult = existingFilters
      ? { data: existingFilters, error: null }
      : await supabase
        .from("ig_account_filters")
        .insert(filters)
        .select("*")
        .single<SupabaseRecord>();

    if (filtersResult.error) {
      const compensated = await compensateNewProfile(supabase, accountId);
      await tryRecordAddProfileAudit(supabase, {
        accountId,
        username: accountUsername,
        externalRequestId,
        actorId,
        resultStatus: compensated ? "compensated" : "failed",
        failureReason: compensated ? "profile_filters_create_failed" : "profile_filters_compensation_failed",
      });
      if (!compensated) {
        await markCredentialFailureWithSupportAction(supabase, accountId, "profile_filters_compensation_failed", externalRequestId, actorId);
      }
      return jsonError("profile_setup_failed", 500);
    }

    const { data: existingDmSettings } = await supabase
      .from("ig_account_dm_settings")
      .select("account_id")
      .eq("account_id", accountId)
      .maybeSingle<SupabaseRecord>();

    const dmSettingsResult = existingDmSettings
      ? { error: null }
      : await supabase
        .from("ig_account_dm_settings")
        .insert({
          account_id: accountId,
          welcome_enabled: false,
          outreach_enabled: false,
          welcome_per_session_limit: defaultWelcomeDmSessionCap,
          welcome_per_day_limit: defaultWelcomeDmDayCap,
          outreach_per_session_limit: defaultOutreachDmSessionCap,
          outreach_per_day_limit: defaultOutreachDmDayCap,
          total_dm_per_day_limit: defaultTotalDmDayCap,
        });

    if (dmSettingsResult.error) {
      const compensated = await compensateNewProfile(supabase, accountId);
      await tryRecordAddProfileAudit(supabase, {
        accountId,
        username: accountUsername,
        externalRequestId,
        actorId,
        resultStatus: compensated ? "compensated" : "failed",
        failureReason: compensated ? "profile_dm_settings_create_failed" : "profile_dm_settings_compensation_failed",
      });
      if (!compensated) {
        await markCredentialFailureWithSupportAction(supabase, accountId, "profile_dm_settings_compensation_failed", externalRequestId, actorId);
      }
      return jsonError("profile_setup_failed", 500);
    }

    let credentials: AddProfileCredentialsResponse | null = null;
    const { data: existingCredentials } = await supabase
      .from("account_credentials")
      .select("id,status")
      .eq("account_id", accountId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle<SupabaseRecord>();
    const credentialsAlreadySaved = Boolean(existingCredentials?.id);

    if (loginMethod === "credentials") {
      if (credentialsAlreadySaved) {
        credentials = null;
      } else if (!password) {
        await tryRecordAddProfileAudit(supabase, {
          accountId,
          username: accountUsername,
          externalRequestId,
          actorId,
          resultStatus: "failed",
          failureReason: "credentials_required_for_repair",
        });
        return jsonError("credentials_required_for_repair", 400, addProfilePartialMeta({
          accountId,
          accountCreated: accountCreated || Boolean(accountId),
          credentialsSaved: false,
          repairPossible: true,
        }));
      }
    }

    if (loginMethod === "credentials" && !credentialsAlreadySaved) {
      try {
        credentials = await callSubmitAddProfileCredentials({
          accountId,
          expectedUsername: accountUsername,
          password,
          actorType: "admin",
          externalRequestId,
        });
      } catch (credentialsError) {
        const reason = credentialsError instanceof Error && credentialsError.message === "credentials_ingestion_timeout"
          ? "credentials_ingestion_timeout"
          : "credentials_ingestion_failed";
        await markCredentialFailureWithSupportAction(supabase, accountId, reason, externalRequestId, actorId);
        await tryRecordAddProfileAudit(supabase, {
          accountId,
          username: accountUsername,
          externalRequestId,
          actorId,
          resultStatus: "failed",
          failureReason: reason,
        });
        return jsonError(reason, 502);
      }

      if (!isActiveCredentials(credentials)) {
        await markCredentialFailureWithSupportAction(supabase, accountId, "credentials_not_active", externalRequestId, actorId);
        await tryRecordAddProfileAudit(supabase, {
          accountId,
          username: accountUsername,
          externalRequestId,
          credentialRequestId: credentials.request_id,
          actorId,
          resultStatus: "failed",
          failureReason: "credentials_not_active",
        });
        return jsonError("credentials_ingestion_failed", 502);
      }
    }

    const ownership = await ensureAddProfileOwnership(supabase, {
      accountId,
      accountUsername,
      commercialPackage,
      addons: selectedAddons,
      runtimeMode,
    });
    if (!ownership.ok) {
      await tryRecordAddProfileAudit(supabase, {
        accountId,
        username: accountUsername,
        externalRequestId,
        credentialRequestId: credentials?.request_id,
        actorId,
        resultStatus: "failed",
        failureReason: ownership.reason,
        metadataSafe: {
          commercial_package: commercialPackage,
          runtime_mode: runtimeMode,
          addons_selected: selectedAddons.join(","),
        },
      });
      return jsonError(`ownership_failed:${ownership.reason}`, 409, addProfilePartialMeta({
        accountId,
        accountCreated: accountCreated || Boolean(accountId),
        credentialsSaved: credentialsAlreadySaved || Boolean(credentials),
        assignmentFailed: true,
        reason: ownership.reason,
        repairPossible: true,
      }));
    }

    const runtimeDefaults = await applyAddProfileRuntimeDefaults(supabase, {
      accountId,
      username: accountUsername,
      appPackageName: target.packageName,
      preset: packagePreset,
    });
    if (!runtimeDefaults.ok) {
      await tryRecordAddProfileAudit(supabase, {
        accountId,
        username: accountUsername,
        externalRequestId,
        credentialRequestId: credentials?.request_id,
        actorId,
        resultStatus: "failed",
        failureReason: runtimeDefaults.reason,
        metadataSafe: {
          commercial_package: commercialPackage,
          runtime_mode: runtimeMode,
          addons_selected: selectedAddons.join(","),
          phase: "runtime_defaults",
        },
      });
      return jsonError(`runtime_defaults_failed:${runtimeDefaults.reason}`, 409, addProfilePartialMeta({
        accountId,
        accountCreated: accountCreated || Boolean(accountId),
        credentialsSaved: credentialsAlreadySaved || Boolean(credentials),
        reason: runtimeDefaults.reason,
        repairPossible: true,
      }));
    }

    if (botAppNoAutomationCreate) {
      await tryRecordAddProfileAudit(supabase, {
        accountId,
        username: accountUsername,
        externalRequestId,
        credentialRequestId: credentials?.request_id,
        actorId,
        resultStatus: "success",
        metadataSafe: {
          onboarding_schedule_assigned: false,
          onboarding_schedule_reason: "botapp_no_automation_create",
          package_name: target.packageName,
          runtime_mode: runtimeMode,
          commercial_package: commercialPackage,
          commercial_package_code: ownership.commercialPackageCode,
          addons_selected: selectedAddons.join(","),
          runtime_defaults_applied: runtimeDefaults.ok,
          welcome_enabled: runtimeDefaults.welcome_enabled,
          outreach_enabled: runtimeDefaults.outreach_enabled,
          follow_enabled: runtimeDefaults.follow_enabled,
          unfollow_enabled: runtimeDefaults.unfollow_enabled,
          starts_at: startsAt,
          ends_at: endsAt,
          login_method: loginMethod,
          provisioning_started: false,
          login_started: false,
          run_started: false,
        },
      });
      return jsonOk(
        safeCreateResponse(
          { ...account, status: supportRequiredStatus },
          credentials,
          {
            onboarding_schedule_assigned: false,
            onboarding_schedule_reason: "botapp_no_automation_create",
            assignment: {},
            package_name: target.packageName,
            runtime_defaults_applied: true,
            runtime_defaults_reason: null,
          },
          "botapp_relay",
        ),
        accountCreated ? 201 : 200,
      );
    }

    const onboardingSchedule = await tryAutoAssignOnboardingSchedule(accountId, {
      deviceId,
      appInstanceId,
      startsAt,
      endsAt,
    }).catch((error) => ({
      assigned: false,
      reason: error instanceof Error ? error.message : "onboarding_schedule_failed",
      assignment: {},
    }));
    if (!onboardingSchedule.assigned) {
      await tryRecordAddProfileAudit(supabase, {
        accountId,
        username: accountUsername,
        externalRequestId,
        credentialRequestId: credentials?.request_id,
        actorId,
        resultStatus: "failed",
        failureReason: onboardingSchedule.reason,
        metadataSafe: {
          package_name: target.packageName,
          runtime_mode: runtimeMode,
          starts_at: startsAt,
          ends_at: endsAt,
        },
      });
      return jsonError(`assignment_failed:${onboardingSchedule.reason}`, 409, addProfilePartialMeta({
        accountId,
        accountCreated: accountCreated || Boolean(accountId),
        credentialsSaved: credentialsAlreadySaved || Boolean(credentials),
        assignmentFailed: true,
        reason: onboardingSchedule.reason,
        repairPossible: true,
      }));
    }

    const finalized = await finalizeActiveProfile(supabase, accountId);
    if (!finalized) {
      await markCredentialFailureWithSupportAction(supabase, accountId, "profile_status_finalize_failed", externalRequestId, actorId);
      await tryRecordAddProfileAudit(supabase, {
        accountId,
        username: accountUsername,
        externalRequestId,
        credentialRequestId: credentials?.request_id,
        actorId,
        resultStatus: "failed",
        failureReason: "profile_status_finalize_failed",
      });
      return jsonError("profile_status_finalize_failed", 502);
    }

    if (credentials) {
      try {
        await resolveCredentialDashboardActions(supabase, accountId, externalRequestId, actorId);
      } catch {
        // Credential state is authoritative; dashboard actions can be reconciled later.
      }
    }

    await tryRecordAddProfileAudit(supabase, {
      accountId,
      username: accountUsername,
      externalRequestId,
      credentialRequestId: credentials?.request_id,
      actorId,
      resultStatus: "success",
      metadataSafe: {
        onboarding_schedule_assigned: onboardingSchedule.assigned,
        onboarding_schedule_reason: onboardingSchedule.reason,
        package_name: target.packageName,
        runtime_mode: runtimeMode,
        commercial_package: commercialPackage,
        commercial_package_code: ownership.commercialPackageCode,
        addons_selected: selectedAddons.join(","),
        runtime_defaults_applied: runtimeDefaults.ok,
        welcome_enabled: runtimeDefaults.welcome_enabled,
        outreach_enabled: runtimeDefaults.outreach_enabled,
        follow_enabled: runtimeDefaults.follow_enabled,
        unfollow_enabled: runtimeDefaults.unfollow_enabled,
        starts_at: startsAt,
        ends_at: endsAt,
        login_method: loginMethod,
        provisioning_started: false,
        run_started: false,
      },
    });
    return jsonOk(
      safeCreateResponse(
        { ...account, status: activeAccountStatus },
        credentials,
        {
          onboarding_schedule_assigned: onboardingSchedule.assigned,
          onboarding_schedule_reason: onboardingSchedule.reason,
          assignment: onboardingSchedule.assignment,
          package_name: target.packageName,
          runtime_defaults_applied: true,
          runtime_defaults_reason: null,
        },
        auth.mode === "relay_key" ? "botapp_relay" : "admin_dashboard",
      ),
      201,
    );
  } catch {
    return jsonError("Could not create profile.", 500);
  }
}
