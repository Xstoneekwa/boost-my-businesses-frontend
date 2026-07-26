import { jsonError, jsonOk, readJsonBody } from "@/app/api/instagram-dashboard/_utils";
import {
  analyzeClientInstagramProfileWithAi,
  beginClientInstagramOnboarding,
  loadLatestClientOnboardingSession,
  reanalyzeClientInstagramOnboarding,
  restartClientInstagramOnboarding,
  updateClientInstagramOnboarding,
} from "@/lib/instagram-client/client-account-onboarding";
import {
  readString,
  rejectTechnicalClientFields,
  requireClientInstagramSession,
} from "@/lib/instagram-client/_utils";
import { parseLoginEmailInput } from "@/lib/instagram-dashboard/persist-account-login-email";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UPDATE_ACTIONS = new Set(["save_analysis", "save_targeting", "open_targets", "complete", "abandon", "reanalyze_public", "analyze_ai"]);

type StartBody = {
  idempotency_key?: unknown;
  restart_session_id?: unknown;
  username?: unknown;
  password?: unknown;
  email?: unknown;
};

type UpdateBody = {
  session_id?: unknown;
  action?: unknown;
  request_key?: unknown;
  value?: unknown;
};

function safeError(error: unknown) {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = error instanceof Error ? error.message : "onboarding_failed";
  const status = Number(record.status);
  return {
    code,
    status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500,
    eligibleCount: Number(record.eligibleCount ?? 0),
    requiredCount: Number(record.requiredCount ?? 15),
    clientMessage: readString(record.clientMessage),
  };
}

export async function GET() {
  const auth = await requireClientInstagramSession();
  if (!auth.ok) return jsonError(auth.error, auth.status);
  try {
    const onboarding = await loadLatestClientOnboardingSession(auth.clientId, auth.userId);
    return jsonOk({ onboarding });
  } catch {
    return jsonError("Could not load Instagram onboarding.", 503, { code: "onboarding_lookup_failed" });
  }
}

export async function POST(request: Request) {
  const auth = await requireClientInstagramSession();
  if (!auth.ok) return jsonError(auth.error, auth.status);
  const body = await readJsonBody<StartBody>(request);
  if (!body) return jsonError("Invalid request body.", 400, { code: "invalid_body" });
  const technicalError = rejectTechnicalClientFields(body as Record<string, unknown>);
  if (technicalError) return jsonError(technicalError, 400, { code: "technical_fields_forbidden" });

  const idempotencyKey = readString(body.idempotency_key);
  const restartSessionId = readString(body.restart_session_id);
  const username = readString(body.username);
  const password = readString(body.password);
  const email = parseLoginEmailInput(body.email);
  if (!UUID_PATTERN.test(idempotencyKey)) return jsonError("Invalid onboarding request.", 400, { code: "idempotency_key_invalid" });
  if (restartSessionId) {
    if (!UUID_PATTERN.test(restartSessionId)) return jsonError("Invalid onboarding session.", 400, { code: "session_id_invalid" });
    try {
      const onboarding = await restartClientInstagramOnboarding({
        clientId: auth.clientId,
        userId: auth.userId,
        previousSessionId: restartSessionId,
        idempotencyKey,
      });
      return jsonOk({ onboarding });
    } catch (error) {
      const safe = safeError(error);
      return jsonError("Could not restart Instagram onboarding.", safe.status, { code: safe.code });
    }
  }
  if (!username) return jsonError("Instagram username is required.", 400, { code: "username_required" });
  if (!password) return jsonError("Instagram password is required.", 400, { code: "password_required" });
  if (email.present && email.invalid) return jsonError("Instagram login email is invalid.", 400, { code: "email_invalid" });

  try {
    const onboarding = await beginClientInstagramOnboarding({
      clientId: auth.clientId,
      userId: auth.userId,
      idempotencyKey,
      username,
      password,
      email: email.email ?? "",
    });
    return jsonOk({ onboarding });
  } catch (error) {
    const safe = safeError(error);
    return jsonError(safe.clientMessage || "Could not start Instagram onboarding.", safe.status, { code: safe.code });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireClientInstagramSession();
  if (!auth.ok) return jsonError(auth.error, auth.status);
  const body = await readJsonBody<UpdateBody>(request);
  if (!body) return jsonError("Invalid request body.", 400, { code: "invalid_body" });
  const technicalError = rejectTechnicalClientFields(body as Record<string, unknown>);
  if (technicalError) return jsonError(technicalError, 400, { code: "technical_fields_forbidden" });

  const sessionId = readString(body.session_id);
  const action = readString(body.action);
  if (!UUID_PATTERN.test(sessionId)) return jsonError("Invalid onboarding session.", 400, { code: "session_id_invalid" });
  if (!UPDATE_ACTIONS.has(action)) return jsonError("Invalid onboarding action.", 400, { code: "onboarding_action_invalid" });

  if (action === "reanalyze_public") {
    const requestKey = readString(body.request_key);
    if (!UUID_PATTERN.test(requestKey)) return jsonError("Invalid reanalysis request.", 400, { code: "reanalysis_key_invalid" });
    try {
      const onboarding = await reanalyzeClientInstagramOnboarding({
        clientId: auth.clientId,
        userId: auth.userId,
        sessionId,
        requestKey,
      });
      return jsonOk({ onboarding });
    } catch (error) {
      const safe = safeError(error);
      return jsonError(
        safe.code === "profile_reanalysis_cooldown"
          ? "Public profile data was refreshed recently."
          : safe.code === "profile_reanalysis_in_progress"
            ? "Public profile analysis is already running."
            : safe.code === "profile_reanalysis_not_found"
              ? "Instagram username was not found."
              : safe.code === "profile_reanalysis_rate_limited"
                ? "Public profile provider is temporarily rate limited."
                : safe.code === "profile_reanalysis_invalid_response"
                  ? "Public profile provider returned an invalid response."
            : "Could not refresh public profile data.",
        safe.status,
        { code: safe.code },
      );
    }
  }

  if (action === "analyze_ai") {
    const requestKey = readString(body.request_key);
    if (!UUID_PATTERN.test(requestKey)) return jsonError("Invalid AI analysis request.", 400, { code: "profile_ai_key_invalid" });
    try {
      const onboarding = await analyzeClientInstagramProfileWithAi({
        clientId: auth.clientId,
        userId: auth.userId,
        sessionId,
        requestKey,
      });
      return jsonOk({ onboarding });
    } catch (error) {
      const safe = safeError(error);
      return jsonError(
        safe.code === "profile_ai_cooldown"
          ? "AI analysis was run recently."
          : safe.code === "profile_ai_in_progress"
            ? "AI analysis is already running."
            : "AI analysis is temporarily unavailable.",
        safe.status,
        { code: safe.code },
      );
    }
  }

  try {
    const onboarding = await updateClientInstagramOnboarding({
      clientId: auth.clientId,
      userId: auth.userId,
      sessionId,
      action: action as "save_analysis" | "save_targeting" | "open_targets" | "complete" | "abandon",
      value: body.value,
    });
    return jsonOk({ onboarding });
  } catch (error) {
    const safe = safeError(error);
    return jsonError(
      safe.code === "target_minimum_not_met"
        ? "At least 15 validated and eligible target accounts are required."
        : safe.code === "onboarding_login_pending_projection_failed"
          ? "Instagram onboarding was completed, but login preparation is still pending. Refresh to resume."
        : "Could not update Instagram onboarding.",
      safe.status,
      {
        code: safe.code,
        eligible_count: safe.eligibleCount,
        required_count: safe.requiredCount,
      },
    );
  }
}
