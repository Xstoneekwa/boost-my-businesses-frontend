import { after, NextResponse } from "next/server";
import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { parseCommercialDiscoveryTrigger } from "@/lib/commercial/discovery-contract";
import { cancelCommercialDiscoveryRun, processCommercialDiscoveryBatch } from "@/lib/commercial/discovery-processor";
import { createCommercialDiscoveryRun, getCommercialDiscoveryReadModel } from "@/lib/commercial/discovery-service";
import { commercialApiError, commercialJson } from "../../_response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  try { await requireCommercialCrmAccess(); return commercialJson(await getCommercialDiscoveryReadModel()); }
  catch (error) { return commercialApiError(error); }
}

export async function POST(request: Request) {
  try {
    await requireCommercialCrmAccess();
    let body: unknown;
    try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }
    let trigger;
    try { trigger = parseCommercialDiscoveryTrigger(body); } catch (error) {
      return NextResponse.json({ ok: false, error: "Invalid discovery request.", code: error instanceof Error ? error.message : "invalid_request" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
    }
    const run = await createCommercialDiscoveryRun(trigger);
    if (!run.idempotent_replay && run.status === "queued") after(() => processCommercialDiscoveryBatch());
    return commercialJson(run, 202);
  } catch (error) { return commercialApiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const context = await requireCommercialCrmAccess();
    let body: unknown; try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }
    const value = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    if (value.action !== "cancel" || typeof value.runId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.runId)) {
      return NextResponse.json({ ok: false, error: "Invalid cancel request." }, { status: 400 });
    }
    return commercialJson(await cancelCommercialDiscoveryRun(value.runId, context.userId));
  } catch (error) { return commercialApiError(error); }
}
