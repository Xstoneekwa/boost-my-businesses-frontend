import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { buildDmProjection, saveDmDomainPatch } from "@/lib/instagram-dashboard/dm-domain-service";
import {
  assertClientCanConfigureOutreach,
  projectClientDmTemplates,
} from "@/lib/instagram-client/client-dm-templates";
import { resolveAccountPackageCode } from "@/lib/instagram-client/resolve-account-package-code";
import { authorizeClientInstagramAccount, readString, rejectTechnicalClientFields, requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

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

async function loadAccountUsername(accountId: string) {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("client_instagram_accounts")
    .select("username")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return readString(data?.username, "");
}

type OutreachPatchBody = {
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

  let body: OutreachPatchBody | null = null;
  try {
    body = await request.json() as OutreachPatchBody;
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
    const guard = assertClientCanConfigureOutreach(domain);
    if (!guard.ok) {
      return NextResponse.json({ ok: false, code: guard.code, error: guard.error }, { status: guard.status });
    }

    const result = await saveDmDomainPatch(supabase, {
      accountId: auth.accountId,
      patch: {
        outreach_enabled: body?.enabled,
        outreach_message: body?.message,
      },
      actorId: auth.userId,
      actorType: "client",
      sourceSurface: "client_dashboard_dm_templates",
      allowedFields: ["outreach_enabled", "outreach_message"],
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    const username = await loadAccountUsername(auth.accountId);
    const packageCode = await resolveAccountPackageCode(auth.accountId);
    const data = projectClientDmTemplates({
      accountId: auth.accountId,
      username,
      packageCode,
      domain: result.projection,
    });
    return NextResponse.json({ ok: true, data, changed_fields: result.changedFields });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save outreach DM template.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
