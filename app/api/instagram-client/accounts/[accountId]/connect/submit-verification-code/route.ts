import { readString } from "@/app/api/instagram-dashboard/_utils";
import {
  clientSafeVerificationSubmitMessage,
  submitAccountVerificationCode,
} from "@/lib/instagram-dashboard/submit-verification-code-service";
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
    const lang = request.headers.get("accept-language")?.toLowerCase().startsWith("en") ? "en" : "fr";

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

    return NextResponse.json({
      ok: true,
      data: {
        action_id: result.action_id,
        account_id: result.account_id,
        status: result.status,
        resume_queued: result.resume_queued,
        resume_already_queued: result.resume_already_queued,
        message: lang === "fr"
          ? (result.resume_queued || result.resume_already_queued
            ? "Code envoyé. Nous reprenons la connexion."
            : "Code envoyé.")
          : (result.resume_queued || result.resume_already_queued
            ? "Code submitted. We are resuming the connection."
            : "Code submitted."),
      },
    });
  } catch {
    return NextResponse.json({
      ok: false,
      error: "Could not submit verification code.",
      code: "verification_code_submit_failed",
    }, { status: 503 });
  }
}
