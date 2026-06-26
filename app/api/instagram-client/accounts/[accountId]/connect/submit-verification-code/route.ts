import { readString } from "@/app/api/instagram-dashboard/_utils";
import {
  clientSafeVerificationSubmitMessage,
  submitAccountVerificationCode,
} from "@/lib/instagram-dashboard/submit-verification-code-service";
import { isActiveResumeRequestStatus } from "@/lib/instagram-dashboard/run-control";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Body = {
  action_id?: unknown;
  verification_code?: unknown;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const lang = request.headers.get("accept-language")?.toLowerCase().startsWith("en") ? "en" : "fr";
  try {
    const session = await requireClientInstagramSession();
    if (!session.ok) {
      return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
    }

    const { accountId } = await context.params;
    const normalizedAccountId = readString(accountId);
    if (!normalizedAccountId) {
      return NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 });
    }

    const authorized = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
    if (!authorized.ok) {
      return NextResponse.json({ ok: false, error: authorized.error }, { status: authorized.status });
    }

    const payload = (await request.json().catch(() => null)) as Body | null;
    const actionId = readString(payload?.action_id);
    const verificationCode = readString(payload?.verification_code);

    const result = await submitAccountVerificationCode({
      actionId,
      accountId: normalizedAccountId,
      verificationCode,
      actorId: session.userId,
      actorType: "client",
      metadataSource: "client_connect_verification",
      resumeActorType: "system",
    });

    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        error: clientSafeVerificationSubmitMessage(lang, result.code),
        code: result.code,
      }, { status: result.status });
    }

    const resumeStarted = result.resume_active
      || result.resume_queued
      || result.resume_already_queued
      || isActiveResumeRequestStatus(result.resume_request_status);

    return NextResponse.json({
      ok: true,
      data: {
        action_id: result.action_id,
        account_id: result.account_id,
        status: result.status,
        code_persisted: result.code_persisted,
        resume_queued: result.resume_queued,
        resume_already_queued: result.resume_already_queued,
        resume_active: result.resume_active,
        resume_request_id: result.resume_request_id,
        resume_request_status: result.resume_request_status,
        resume_queue_reason: result.resume_queue_reason,
        message: lang === "fr"
          ? (resumeStarted
            ? "Vérification en cours. Nous reprenons la connexion automatiquement."
            : "Code enregistré. Nous préparons la reprise de la connexion.")
          : (resumeStarted
            ? "Verification in progress. We are resuming the connection automatically."
            : "Code saved. We are preparing to resume the connection."),
      },
    });
  } catch (error) {
    console.error("client_submit_verification_code_failed", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({
      ok: false,
      error: clientSafeVerificationSubmitMessage(lang, "verification_code_submit_failed"),
      code: "verification_code_submit_failed",
    }, { status: 500 });
  }
}
