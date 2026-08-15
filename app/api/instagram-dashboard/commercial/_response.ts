import { NextResponse } from "next/server";
import { CommercialCrmAccessError } from "@/lib/commercial/crm-access";
import { CommercialReviewError } from "@/lib/commercial/lead-review";
import { CommercialOutreachError } from "@/lib/commercial/outreach-service";

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
  if (error instanceof CommercialReviewError) {
    return NextResponse.json(
      { ok: false, error: "Commercial review request failed.", code: error.code },
      { status: error.status, headers: noStore },
    );
  }
  if (error instanceof CommercialOutreachError) {
    return NextResponse.json(
      { ok: false, error: "Commercial outreach request failed.", code: error.code },
      { status: error.status, headers: noStore },
    );
  }
  return NextResponse.json(
    { ok: false, error: "Commercial data is unavailable." },
    { status: 503, headers: noStore },
  );
}
