import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { buildDmProjection, saveDmDomainPatch } from "@/lib/instagram-dashboard/dm-domain-service";
import { sanitizeClientApiError } from "@/lib/instagram-client/client-account-canonical";
import {
  assertClientCanConfigureWelcome,
  loadClientDmTemplatesProjection,
} from "@/lib/instagram-client/client-dm-templates";
import { authorizeClientInstagramAccount, rejectTechnicalClientFields, requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

const SAVE_ERROR = "Could not save welcome DM template.";

async function authorizeAccountRoute(accountId: string) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return { error: NextResponse.json({ ok: false, error: session.error }, { status: session.status }) };
  }
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) {
    return { error: NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 }) };
  }
  const ownership = await authorizeClientInstagramAccount(session.userId, normalizedAccountId);
  if (!ownership.ok) {
    return { error: NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status }) };
  }
  return { accountId: normalizedAccountId, userId: session.userId };
}

type WelcomePatchBody = {
  enabled?: boolean;
  message?: string;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  let body: WelcomePatchBody | null = null;
  try {
    body = await request.json() as WelcomePatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const technicalError = rejectTechnicalClientFields(body ?? {});
  if (technicalError) return NextResponse.json({ ok: false, error: technicalError }, { status: 400 });
  if (body?.enabled === undefined && body?.message === undefined) {
    return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseClient();
    const domain = await buildDmProjection(supabase, auth.accountId);
    const guard = assertClientCanConfigureWelcome(domain);
    if (!guard.ok) {
      return NextResponse.json({ ok: false, code: guard.code, error: guard.error }, { status: guard.status });
    }

    const result = await saveDmDomainPatch(supabase, {
      accountId: auth.accountId,
      patch: {
        welcome_enabled: body?.enabled,
        welcome_message: body?.message,
      },
      actorId: auth.userId,
      actorType: "client",
      sourceSurface: "client_dashboard_dm_templates",
      allowedFields: ["welcome_enabled", "welcome_message"],
    });
    if (!result.ok) {
      return NextResponse.json({
        ok: false,
        error: sanitizeClientApiError(result.error, SAVE_ERROR),
      }, { status: result.status });
    }

    const data = await loadClientDmTemplatesProjection(auth.accountId);
    return NextResponse.json({ ok: true, data, changed_fields: result.changedFields });
  } catch (error) {
    const message = error instanceof Error ? error.message : SAVE_ERROR;
    return NextResponse.json({
      ok: false,
      error: sanitizeClientApiError(message, SAVE_ERROR),
    }, { status: 500 });
  }
}
