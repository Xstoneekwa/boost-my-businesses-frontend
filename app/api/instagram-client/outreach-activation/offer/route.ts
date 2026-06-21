import { NextResponse } from "next/server";
import {
  buildOutreachActivationPath,
  resolveOutreachActivationOffer,
} from "@/lib/instagram-client/client-dm-templates";
import { authorizeClientInstagramAccount, readString, requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return NextResponse.json({ ok: false, error: session.error }, { status: session.status });
  }

  const url = new URL(request.url);
  const accountId = readString(url.searchParams.get("account_id"), "").trim();
  if (!accountId) {
    return NextResponse.json({ ok: false, error: "Missing account id." }, { status: 400 });
  }

  const ownership = await authorizeClientInstagramAccount(session.userId, accountId);
  if (!ownership.ok) {
    return NextResponse.json({ ok: false, error: ownership.error }, { status: ownership.status });
  }

  const offer = resolveOutreachActivationOffer();
  if (!offer.available) {
    return NextResponse.json({
      ok: true,
      data: {
        available: false,
        outreachUnavailableReason: offer.reason,
        outreachActivationPath: null,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    data: {
      available: true,
      outreachUnavailableReason: null,
      outreachActivationPath: buildOutreachActivationPath(accountId),
      addonKey: offer.addonKey,
      displayNameFr: offer.displayNameFr,
      displayNameEn: offer.displayNameEn,
      baseMonthlyPriceCents: offer.baseMonthlyPriceCents,
      accountId,
    },
  });
}
