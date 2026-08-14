import { NextResponse } from "next/server";
import { CommercialCrmAccessError } from "@/lib/commercial/crm-access";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

export function commercialJson(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, data }, { status, headers: noStore });
}

export function commercialApiError(error: unknown) {
  if (error instanceof CommercialCrmAccessError) {
    return NextResponse.json(
      { ok: false, error: "Commercial access denied.", code: error.code },
      { status: error.status, headers: noStore },
    );
  }
  return NextResponse.json(
    { ok: false, error: "Commercial data is unavailable." },
    { status: 503, headers: noStore },
  );
}
