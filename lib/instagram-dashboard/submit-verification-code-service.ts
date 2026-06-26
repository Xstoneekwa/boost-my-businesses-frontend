import { createSupabaseClient } from "@/lib/supabase";
import {
  createLoginEmailCodeResumeRunRequest,
  evaluateLoginChallengeRunEligibility,
  isActiveResumeRequestStatus,
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
      code_persisted: boolean;
      resume_queued: boolean;
      resume_already_queued: boolean;
      resume_active: boolean;
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
      code_persisted?: boolean;
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
    .select("id,account_id,action_type,status,metadata")
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
  return { ok: true as const, row: data as Record<string, unknown> };
}

async function readExistingSubmissionId(
  supabase: ReturnType<typeof createSupabaseClient>,
  actionId: string,
  accountId: string,
  actionRow?: Record<string, unknown> | null,
) {
  const metadata = actionRow?.metadata && typeof actionRow.metadata === "object" && !Array.isArray(actionRow.metadata)
    ? actionRow.metadata as Record<string, unknown>
    : {};
  const metadataSubmissionId = readString(metadata.verification_submission_id, "");
  if (metadataSubmissionId) return metadataSubmissionId;

  const { data } = await supabase
    .from("account_verification_code_submissions")
    .select("id")
    .eq("action_id", actionId)
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return readString((data as Record<string, unknown> | null)?.id, "");
}

async function mergeActionResumeMetadata(
  supabase: ReturnType<typeof createSupabaseClient>,
  input: {
    actionId: string;
    accountId: string;
    submissionId: string;
    resumeRequestId: string;
    resumeRequestStatus: string;
  },
) {
  const { data: actionRow } = await supabase
    .from("account_dashboard_actions")
    .select("metadata")
    .eq("id", input.actionId)
    .eq("account_id", input.accountId)
    .eq("action_type", EMAIL_CODE_ACTION)
    .limit(1)
    .maybeSingle();

  const existingMetadata = actionRow?.metadata && typeof actionRow.metadata === "object" && !Array.isArray(actionRow.metadata)
    ? actionRow.metadata as Record<string, unknown>
    : {};

  await supabase
    .from("account_dashboard_actions")
    .update({
      metadata: {
        ...existingMetadata,
        resume_request_id: input.resumeRequestId,
        resume_status: isActiveResumeRequestStatus(input.resumeRequestStatus) ? input.resumeRequestStatus : "queued",
        resume_submission_id: input.submissionId,
        source: "dashboard_code_submit",
      },
    })
    .eq("id", input.actionId)
    .eq("account_id", input.accountId)
    .eq("action_type", EMAIL_CODE_ACTION);
}

async function enqueueVerificationResume(input: {
  accountId: string;
  actionId: string;
  submissionId: string;
  actorId: string;
  resumeActorType: "admin" | "system";
}) {
  try {
    const eligibility = await evaluateLoginChallengeRunEligibility(input.accountId, "login_email_code_resume");
    if (!eligibility.ok) {
      return {
        resumeQueued: false,
        resumeAlreadyQueued: false,
        resumeActive: false,
        resumeRequestId: null as string | null,
        resumeRequestStatus: null as string | null,
        resumeQueueReason: eligibility.reason,
      };
    }

    const resumeResult = await createLoginEmailCodeResumeRunRequest({
      accountId: input.accountId,
      actionId: input.actionId,
      submissionId: input.submissionId,
      actorId: input.actorId,
      actorType: input.resumeActorType,
    });

    const resumeActive = Boolean(
      resumeResult.requestId
      && (resumeResult.queued || isActiveResumeRequestStatus(resumeResult.requestStatus)),
    );

    return {
      resumeQueued: resumeResult.queued,
      resumeAlreadyQueued: resumeResult.idempotent && resumeActive,
      resumeActive,
      resumeRequestId: resumeResult.requestId,
      resumeRequestStatus: resumeResult.requestStatus,
      resumeQueueReason: resumeResult.reason,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "resume_enqueue_failed";
    return {
      resumeQueued: false,
      resumeAlreadyQueued: false,
      resumeActive: false,
      resumeRequestId: null as string | null,
      resumeRequestStatus: null as string | null,
      resumeQueueReason: message,
    };
  }
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

  const actionStatus = readString(actionCheck.row.status, "").toLowerCase();
  let submissionId = "";
  let persistedStatus = actionStatus;

  if (actionStatus === "code_submitted") {
    submissionId = await readExistingSubmissionId(supabase, actionId, accountId, actionCheck.row);
  }

  if (!submissionId) {
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
      if (mapped.code === "verification_code_already_consumed") {
        submissionId = await readExistingSubmissionId(supabase, actionId, accountId, actionCheck.row);
        if (!submissionId) {
          return { ok: false, ...mapped };
        }
        persistedStatus = "code_submitted";
      } else {
        return { ok: false, ...mapped };
      }
    } else {
      submissionId = readString((data as Record<string, unknown> | null)?.submission_id, "");
      persistedStatus = readString((data as Record<string, unknown> | null)?.status, "code_submitted");
    }
  }

  if (!submissionId) {
    return {
      ok: false,
      status: 500,
      message: "Verification code submission failed.",
      code: "verification_code_submit_failed",
    };
  }

  const resume = await enqueueVerificationResume({
    accountId,
    actionId,
    submissionId,
    actorId: input.actorId,
    resumeActorType: input.resumeActorType,
  });

  if (resume.resumeActive && resume.resumeRequestId) {
    await mergeActionResumeMetadata(supabase, {
      actionId,
      accountId,
      submissionId,
      resumeRequestId: resume.resumeRequestId,
      resumeRequestStatus: resume.resumeRequestStatus || "queued",
    });
  }

  return {
    ok: true,
    action_id: actionId,
    account_id: accountId,
    status: persistedStatus || "code_submitted",
    submission_id: submissionId,
    code_persisted: true,
    resume_queued: resume.resumeQueued,
    resume_already_queued: resume.resumeAlreadyQueued,
    resume_active: resume.resumeActive,
    resume_request_id: resume.resumeRequestId,
    resume_request_status: resume.resumeRequestStatus,
    resume_queue_reason: resume.resumeQueueReason,
    message: resume.resumeActive
      ? "Verification code stored securely. Login resume queued for the worker."
      : resume.resumeAlreadyQueued
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
    verification_resume_unavailable: "Code enregistré, mais la reprise automatique n'a pas pu démarrer.",
  };
  const en: Record<string, string> = {
    verification_code_invalid: "Invalid or expired code.",
    verification_code_already_consumed: "This code was already used.",
    verification_action_inactive: "No active verification for this account.",
    dashboard_action_not_found: "Verification action not found.",
    verification_payload_invalid: "Invalid verification code.",
    verification_code_submit_failed: "Could not submit the code right now.",
    verification_resume_unavailable: "Code saved, but automatic resume could not start.",
  };
  if (code && (fr[code] || en[code])) {
    return lang === "fr" ? fr[code] : en[code];
  }
  return lang === "fr" ? "Impossible d'envoyer le code pour le moment." : "Could not submit the code right now.";
}
