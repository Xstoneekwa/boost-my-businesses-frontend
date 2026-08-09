import {
  CANONICAL_INSTAGRAM_ACCOUNT_ONBOARDING_ENGINE,
  beginInstagramAccountOnboarding,
  loadLatestInstagramAccountOnboardingSession,
  previewInstagramAccountOnboarding,
  restartInstagramAccountOnboarding,
  saveInstagramAccountOnboardingProtectionLists,
  updateInstagramAccountOnboarding,
  type InstagramOnboardingActorContext,
  type InstagramOnboardingSourceContext,
} from "@/lib/instagram-onboarding/canonical-account-onboarding";
import { canAccessTenantPages } from "@/lib/restaurant-analytics/session";
import { parseLoginEmailInput } from "@/lib/instagram-dashboard/persist-account-login-email";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
} from "../../_utils";
import {
  compassRelayAuthFailureReason,
  readRelayKey,
  relayAuthStatus,
  verifyCompassRelayKey,
} from "../../compass/relay-auth";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPDATE_ACTIONS = new Set(["save_analysis", "save_protection_lists", "save_targeting", "open_targets", "complete", "abandon"]);

type CreateProfilePayload = {
  client_id?: unknown;
  idempotency_key?: unknown;
  restart_session_id?: unknown;
  session_id?: unknown;
  action?: unknown;
  value?: unknown;
  username?: unknown;
  password?: unknown;
  email?: unknown;
  dry_run?: unknown;
  device_id?: unknown;
  app_instance_id?: unknown;
  schedule_mode?: unknown;
  starts_at?: unknown;
  ends_at?: unknown;
};

function safeError(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = error instanceof Error ? error.message : "canonical_onboarding_failed";
  const rawStatus = Number(record.status);
  return {
    code,
    status: Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500,
    eligibleCount: Number(record.eligibleCount ?? 0),
    requiredCount: Number(record.requiredCount ?? 15),
    clientMessage: readString(record.clientMessage),
  };
}

async function resolveOperatorActor(request: Request): Promise<
  | { ok: true; actor: InstagramOnboardingActorContext }
  | { ok: false; response: ReturnType<typeof jsonError> }
> {
  const suppliedRelayKey = readRelayKey(request.headers);
  if (suppliedRelayKey) {
    const relayAuth = verifyCompassRelayKey(request.headers);
    if (!relayAuth.ok) {
      const reason = compassRelayAuthFailureReason(relayAuth);
      return {
        ok: false,
        response: jsonError("Add profile relay authentication failed.", relayAuthStatus(reason), { reason }),
      };
    }
    const operatorId = readString(process.env.INSTAGRAM_BOTAPP_OPERATOR_USER_ID);
    if (!UUID_PATTERN.test(operatorId)) {
      return {
        ok: false,
        response: jsonError("BotApp onboarding operator identity is not configured.", 503, {
          code: "botapp_operator_identity_unconfigured",
        }),
      };
    }
    return {
      ok: true,
      actor: { actorType: "botapp_operator", actorId: operatorId, source: "botapp" },
    };
  }

  const adminContext = await getInstagramAdminUserContext();
  if (!adminContext?.userId) {
    return { ok: false, response: jsonError("Authentication required.", 401) };
  }
  if (!canAccessTenantPages(adminContext)) {
    return { ok: false, response: jsonError("You are not authorized to create Instagram accounts.", 403) };
  }
  return {
    ok: true,
    actor: { actorType: "admin", actorId: adminContext.userId, source: "admin_dashboard" },
  };
}

function sourceContext(body: CreateProfilePayload): InstagramOnboardingSourceContext {
  const scheduleMode = readString(body.schedule_mode);
  return {
    deviceId: readString(body.device_id),
    appInstanceId: readString(body.app_instance_id),
    scheduleMode: scheduleMode === "scheduled" || scheduleMode === "manual_only" ? scheduleMode : undefined,
    startsAt: readString(body.starts_at),
    endsAt: readString(body.ends_at),
  };
}

function safeCanonicalResponse(onboarding: Awaited<ReturnType<typeof beginInstagramAccountOnboarding>>) {
  return {
    canonical_engine: CANONICAL_INSTAGRAM_ACCOUNT_ONBOARDING_ENGINE,
    onboarding,
    account: {
      id: onboarding.accountId,
      username: onboarding.requestedUsername,
      status: onboarding.status,
      onboarding_status: onboarding.currentStep,
    },
    package: {
      code: onboarding.packageCode,
      source: "client_account_entitlements",
      entitlement_id: onboarding.entitlementId,
    },
    credentials: {
      status: onboarding.accountId ? "stored_write_only" : "pending",
      credentials_status: onboarding.accountId ? "stored_write_only" : "pending",
      password_status: "write_only" as const,
      reauth_required: false,
    },
    credentials_configured: Boolean(onboarding.accountId),
    credential_save_status: onboarding.accountId ? "saved" : "pending",
    next_action: onboarding.status === "completed" ? "readiness" : "complete_protection_targeting_and_15_targets",
    runtime_activation_requested: false,
  };
}

export async function GET(request: Request) {
  const auth = await resolveOperatorActor(request);
  if (!auth.ok) return auth.response;
  const clientId = new URL(request.url).searchParams.get("client_id")?.trim() ?? "";
  if (!UUID_PATTERN.test(clientId)) return jsonError("A valid client_id is required.", 400, { code: "client_id_invalid" });
  try {
    const onboarding = await loadLatestInstagramAccountOnboardingSession({ clientId, actor: auth.actor });
    return jsonOk({ canonical_engine: CANONICAL_INSTAGRAM_ACCOUNT_ONBOARDING_ENGINE, onboarding });
  } catch (error) {
    const safe = safeError(error);
    return jsonError("Could not load canonical onboarding.", safe.status, { code: safe.code });
  }
}

export async function POST(request: Request) {
  const auth = await resolveOperatorActor(request);
  if (!auth.ok) return auth.response;
  const body = await readJsonBody<CreateProfilePayload>(request);
  if (!body) return jsonError("Invalid request body.", 400, { code: "invalid_body" });

  const clientId = readString(body.client_id);
  const idempotencyKey = readString(body.idempotency_key);
  const restartSessionId = readString(body.restart_session_id);
  const username = readString(body.username);
  const password = readString(body.password);
  const email = parseLoginEmailInput(body.email);
  const dryRun = body.dry_run === true;

  if (!UUID_PATTERN.test(clientId)) return jsonError("A valid client_id is required.", 400, { code: "client_id_invalid" });
  if (!UUID_PATTERN.test(idempotencyKey)) return jsonError("A stable idempotency_key is required.", 400, { code: "idempotency_key_invalid" });
  if (email.present && email.invalid) return jsonError("Instagram login email is invalid.", 400, { code: "email_invalid" });

  if (restartSessionId) {
    if (!UUID_PATTERN.test(restartSessionId)) return jsonError("Invalid onboarding session.", 400, { code: "session_id_invalid" });
    try {
      const onboarding = await restartInstagramAccountOnboarding({
        clientId,
        actor: auth.actor,
        previousSessionId: restartSessionId,
        idempotencyKey,
      });
      return jsonOk(safeCanonicalResponse(onboarding));
    } catch (error) {
      const safe = safeError(error);
      return jsonError("Could not restart canonical onboarding.", safe.status, { code: safe.code });
    }
  }

  if (!username) return jsonError("Instagram username is required.", 400, { code: "username_required" });
  if (!dryRun && !password) return jsonError("Instagram password is required.", 400, { code: "password_required" });

  try {
    if (dryRun) {
      const preview = await previewInstagramAccountOnboarding({
        clientId,
        actor: auth.actor,
        username,
        email: email.email ?? "",
      });
      return jsonOk({
        canonical_engine: CANONICAL_INSTAGRAM_ACCOUNT_ONBOARDING_ENGINE,
        dry_run: true,
        account: preview.validation.account,
        package: {
          code: preview.selection.commercialPackage,
          source: "client_account_entitlements",
          entitlement_id: preview.entitlement.id,
        },
        runtime_activation_requested: false,
      });
    }

    const onboarding = await beginInstagramAccountOnboarding({
      clientId,
      actor: auth.actor,
      idempotencyKey,
      username,
      password,
      email: email.email ?? "",
      sourceContext: sourceContext(body),
    });
    return jsonOk(safeCanonicalResponse(onboarding), 201);
  } catch (error) {
    const safe = safeError(error);
    return jsonError(safe.clientMessage || "Could not start canonical onboarding.", safe.status, { code: safe.code });
  }
}

export async function PATCH(request: Request) {
  const auth = await resolveOperatorActor(request);
  if (!auth.ok) return auth.response;
  const body = await readJsonBody<CreateProfilePayload>(request);
  if (!body) return jsonError("Invalid request body.", 400, { code: "invalid_body" });

  const clientId = readString(body.client_id);
  const sessionId = readString(body.session_id);
  const action = readString(body.action);
  if (!UUID_PATTERN.test(clientId)) return jsonError("A valid client_id is required.", 400, { code: "client_id_invalid" });
  if (!UUID_PATTERN.test(sessionId)) return jsonError("Invalid onboarding session.", 400, { code: "session_id_invalid" });
  if (!UPDATE_ACTIONS.has(action)) return jsonError("Invalid onboarding action.", 400, { code: "onboarding_action_invalid" });

  try {
    const onboarding = action === "save_protection_lists"
      ? await saveInstagramAccountOnboardingProtectionLists({
        clientId,
        actor: auth.actor,
        sessionId,
        value: body.value,
      })
      : await updateInstagramAccountOnboarding({
        clientId,
        actor: auth.actor,
        sessionId,
        action: action as "save_analysis" | "save_targeting" | "open_targets" | "complete" | "abandon",
        value: body.value,
      });
    return jsonOk(safeCanonicalResponse(onboarding));
  } catch (error) {
    const safe = safeError(error);
    return jsonError(
      safe.code === "target_minimum_not_met"
        ? "At least 15 validated and eligible target accounts are required."
        : "Could not update canonical onboarding.",
      safe.status,
      { code: safe.code, eligible_count: safe.eligibleCount, required_count: safe.requiredCount },
    );
  }
}
