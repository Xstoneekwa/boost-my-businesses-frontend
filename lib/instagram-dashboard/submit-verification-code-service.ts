import { createSupabaseClient } from "@/lib/supabase";
import {
  createLoginEmailCodeResumeRunRequest,
  evaluateLoginChallengeRunEligibility,
} from "@/lib/instagram-dashboard/run-control";
import { readString } from "@/app/api/instagram-dashboard/_utils";

export const VERIFICATION_CODE_RE = /^[A-Za-z0-9-]{4,32}$/;

const EMAIL_CODE_ACTION = "enter_email_verification_code";
const ACTIVE_EMAIL_CODE_STATUSES = new Set([
  "pending",
  "acknowledged",
  "pending_verification",
  "code_submitted",
]);

export type SubmitVerificationCodeInput = {
  actionId: string;
  accountId: string;
  verificationCode: string;
  actorId: string;
  actorType: "admin" | "client" | "system";
  metadataSource: string;
  resumeActorType: "admin" | "system";
};

export type SubmitVerificationCodeResult =
  | {
      ok: true;
      action_id: string;
      account_id: string;
      status: string;
      submission_id: string | null;
      resume_queued: boolean;
      resume_already_queued: boolean;
      resume_request_id: string | null;
      resume_request_status: string | null;
      resume_queue_reason: string | null;
      message: string;
    }
  | {
      ok: false;
      status: number;
      message: string;
      code?: string;
    };

function mapRpcError(errorMessage: string): { status: number; message: string; code?: string } {
  const normalized = readString(errorMessage).toLowerCase();
  if (normalized.includes("verification_code_invalid") || normalized.includes("verification_code_expired")) {
    return { status: 400, message: "Invalid or expired verification code.", code: "verification_code_invalid" };
  }
  if (normalized.includes("verification_code_already_consumed")) {
    return { status: 409, message: "This verification code was already used.", code: "verification_code_already_consumed" };
  }
  if (normalized.includes("dashboard_action_not_found")) {
    return { status: 404, message: "Verification action not found.", code: "dashboard_action_not_found" };
  }
  if (normalized.includes("dashboard_action_type_invalid")) {
    return { status: 409, message: "This verification action does not accept a code.", code: "dashboard_action_type_invalid" };
  }
  return { status: 500, message: "Verification code submission failed.", code: "verification_code_submit_failed" };
}

export async function assertActiveEmailVerificationAction(input: {
  supabase: ReturnType<typeof createSupabaseClient>;
  actionId: string;
  accountId: string;
}) {
  const { data, error } = await input.supabase
    .from("account_dashboard_actions")
    .select("id,account_id,action_type,status")
    .eq("id", input.actionId)
    .eq("account_id", input.accountId)
    .eq("action_type", EMAIL_CODE_ACTION)
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false as const, status: 503, message: "Verification action unavailable.", code: "verification_action_unavailable" };
  }
  if (!data) {
    return { ok: false as const, status: 404, message: "Verification action not found.", code: "dashboard_action_not_found" };
  }
  const status = readString((data as Record<string, unknown>).status).toLowerCase();
  if (!ACTIVE_EMAIL_CODE_STATUSES.has(status)) {
    return { ok: false as const, status: 409, message: "Verification is no longer required for this account.", code: "verification_action_inactive" };
  }
  return { ok: true as const };
}

export async function submitAccountVerificationCode(input: SubmitVerificationCodeInput): Promise<SubmitVerificationCodeResult> {
  const actionId = readString(input.actionId);
  const accountId = readString(input.accountId);
  const verificationCode = readString(input.verificationCode);

  if (!actionId || !accountId || !verificationCode || !VERIFICATION_CODE_RE.test(verificationCode)) {
    return { ok: false, status: 400, message: "Invalid verification payload.", code: "verification_payload_invalid" };
  }

  const supabase = createSupabaseClient();
  const actionCheck = await assertActiveEmailVerificationAction({ supabase, actionId, accountId });
  if (!actionCheck.ok) {
    return { ok: false, status: actionCheck.status, message: actionCheck.message, code: actionCheck.code };
  }

  const { data, error } = await supabase.rpc("submit_account_verification_code", {
    p_action_id: actionId,
    p_account_id: accountId,
    p_verification_code: verificationCode,
    p_actor_type: input.actorType,
    p_actor_id: input.actorId,
    p_metadata: {
      source: input.metadataSource,
    },
  });

  if (error) {
    const mapped = mapRpcError(error.message);
    return { ok: false, ...mapped };
  }

  const submissionId = readString((data as Record<string, unknown> | null)?.submission_id, "");
  const actionStatus = readString((data as Record<string, unknown> | null)?.status, "code_submitted");

  let resumeQueued = false;
  let resumeAlreadyQueued = false;
  let resumeRequestId: string | null = null;
  let resumeRequestStatus: string | null = null;
  let resumeQueueReason: string | null = null;

  if (submissionId) {
    const eligibility = await evaluateLoginChallengeRunEligibility(accountId, "login_email_code_resume");
    if (eligibility.ok) {
      const resumeResult = await createLoginEmailCodeResumeRunRequest({
        accountId,
        actionId,
        submissionId,
        actorId: input.actorId,
        actorType: input.resumeActorType,
      });
      resumeQueued = resumeResult.queued;
      resumeAlreadyQueued = resumeResult.idempotent;
      resumeRequestId = resumeResult.requestId;
      resumeRequestStatus = resumeResult.requestStatus;
      resumeQueueReason = resumeResult.reason;

      if (resumeResult.requestId) {
        await supabase
          .from("account_dashboard_actions")
          .update({
            metadata: {
              resume_request_id: resumeResult.requestId,
              resume_status: resumeResult.requestStatus === "running" ? "running" : "queued",
              resume_submission_id: submissionId,
              source: "dashboard_code_submit",
            },
          })
          .eq("id", actionId)
          .eq("account_id", accountId)
          .eq("action_type", EMAIL_CODE_ACTION);
      }
    } else {
      resumeQueueReason = eligibility.reason;
    }
  }

  return {
    ok: true,
    action_id: actionId,
    account_id: accountId,
    status: actionStatus,
    submission_id: submissionId || null,
    resume_queued: resumeQueued,
    resume_already_queued: resumeAlreadyQueued,
    resume_request_id: resumeRequestId,
    resume_request_status: resumeRequestStatus,
    resume_queue_reason: resumeQueueReason,
    message: resumeQueued
      ? "Verification code stored securely. Login resume queued for the worker."
      : resumeAlreadyQueued
      ? "Verification code stored securely. Login resume was already queued."
      : "Verification code stored securely and ready for worker resume.",
  };
}

export function clientSafeVerificationSubmitMessage(lang: "fr" | "en", code?: string | null) {
  const fr: Record<string, string> = {
    verification_code_invalid: "Code invalide ou expiré.",
    verification_code_already_consumed: "Ce code a déjà été utilisé.",
    verification_action_inactive: "Aucune vérification active pour ce compte.",
    dashboard_action_not_found: "Action de vérification introuvable.",
    verification_payload_invalid: "Code de vérification invalide.",
    verification_code_submit_failed: "Impossible d'envoyer le code pour le moment.",
  };
  const en: Record<string, string> = {
    verification_code_invalid: "Invalid or expired code.",
    verification_code_already_consumed: "This code was already used.",
    verification_action_inactive: "No active verification for this account.",
    dashboard_action_not_found: "Verification action not found.",
    verification_payload_invalid: "Invalid verification code.",
    verification_code_submit_failed: "Could not submit the code right now.",
  };
  if (code && (fr[code] || en[code])) {
    return lang === "fr" ? fr[code] : en[code];
  }
  return lang === "fr" ? "Impossible d'envoyer le code pour le moment." : "Could not submit the code right now.";
}
