import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import { loadClientDmTemplatesProjection } from "@/lib/instagram-client/client-dm-templates";
import { authorizeClientInstagramAccount, readString, requireClientInstagramSession } from "@/lib/instagram-client/_utils";

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
  return { accountId: normalizedAccountId };
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  try {
    const username = await loadAccountUsername(auth.accountId);
    const data = await loadClientDmTemplatesProjection(auth.accountId, username);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load DM templates.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
