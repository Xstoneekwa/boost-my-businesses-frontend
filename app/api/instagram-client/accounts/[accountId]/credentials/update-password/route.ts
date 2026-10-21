import { NextResponse } from "next/server";
import { authorizeClientInstagramAccount, requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { readOpaqueSecretString, readString } from "@/lib/instagram-client/guards";
import { updateClientInstagramPassword } from "@/lib/instagram-client/update-client-instagram-password";

export const dynamic = "force-dynamic";

type Body = { action_id?: unknown; password?: unknown };

export async function POST(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const lang = request.headers.get("accept-language")?.toLowerCase().startsWith("en") ? "en" : "fr";
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }

  const { accountId } = await context.params;
  const normalizedAccountId = readString(accountId);
  if (!normalizedAccountId) {
    return NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 });
  }

  const ownership = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!ownership.ok) {
    return NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status });
  }

  const payload = (await request.json().catch(() => null)) as Body | null;
  const result = await updateClientInstagramPassword({
    actorUserId: session.userId,
    clientId: session.clientId,
    accountId: normalizedAccountId,
    actionId: readString(payload?.action_id),
    password: readOpaqueSecretString(payload?.password),
  });

  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      code: result.code,
      error: lang === "fr"
        ? "Le mot de passe n’a pas pu être enregistré. Vérifiez-le puis réessayez."
        : result.message,
    }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    data: {
      account_id: result.accountId,
      action_id: result.actionId,
      credentials_version: result.credentialsVersion,
      action_status: result.actionStatus,
      next_action: result.nextAction,
      idempotent_replay: result.idempotentReplay,
      password_status: "write_only",
      login_started: false,
      run_started: false,
      message: lang === "fr"
        ? "Mot de passe enregistré. Vous pouvez maintenant relancer la connexion Instagram."
        : "Password saved. You can now restart the Instagram connection.",
    },
  });
}
