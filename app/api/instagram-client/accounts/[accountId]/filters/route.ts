import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import {
  normalizeAccountFilterListInput,
  parseAccountFilterList,
  serializeAccountFilterList,
} from "@/lib/instagram-client/account-filter-lists";
import { authorizeClientInstagramAccount, readString, rejectTechnicalClientFields, requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

export type ClientAccountFilterLists = {
  whitelist: string[];
  blacklist: string[];
};

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

async function loadFilterLists(accountId: string): Promise<ClientAccountFilterLists> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("ig_account_filters")
    .select("whitelist_words,blacklist_accounts")
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return {
    whitelist: parseAccountFilterList(data?.whitelist_words),
    blacklist: parseAccountFilterList(data?.blacklist_accounts),
  };
}

async function ensureFilterRow(accountId: string) {
  const supabase = createSupabaseClient();
  const { data } = await supabase
    .from("ig_account_filters")
    .select("account_id")
    .eq("account_id", accountId)
    .maybeSingle();
  if (data?.account_id) return;
  await supabase.from("ig_account_filters").insert({ account_id: accountId, whitelist_words: "", blacklist_accounts: "" });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  try {
    const data = await loadFilterLists(auth.accountId);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load account filters.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

type PatchBody = {
  whitelist?: string[];
  blacklist?: string[];
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  const { accountId } = await context.params;
  const auth = await authorizeAccountRoute(accountId ?? "");
  if ("error" in auth) return auth.error;

  let body: PatchBody | null = null;
  try {
    body = await request.json() as PatchBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const technicalError = rejectTechnicalClientFields(body ?? {});
  if (technicalError) return NextResponse.json({ ok: false, error: technicalError }, { status: 400 });

  const whitelist = body?.whitelist !== undefined ? normalizeAccountFilterListInput(body.whitelist) : undefined;
  const blacklist = body?.blacklist !== undefined ? normalizeAccountFilterListInput(body.blacklist) : undefined;
  if (whitelist === undefined && blacklist === undefined) {
    return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
  }

  try {
    await ensureFilterRow(auth.accountId);
    const current = await loadFilterLists(auth.accountId);
    const nextWhitelist = whitelist ?? current.whitelist;
    const nextBlacklist = blacklist ?? current.blacklist;
    const supabase = createSupabaseClient();
    const { error } = await supabase
      .from("ig_account_filters")
      .update({
        whitelist_words: serializeAccountFilterList(nextWhitelist),
        blacklist_accounts: serializeAccountFilterList(nextBlacklist),
        updated_at: new Date().toISOString(),
      })
      .eq("account_id", auth.accountId);
    if (error) throw new Error(error.message);
    return NextResponse.json({
      ok: true,
      data: { whitelist: nextWhitelist, blacklist: nextBlacklist },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save account filters.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
