import { after, NextResponse } from "next/server";
import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { COMMERCIAL_DISCOVERY_CANARY_MAX, parseCommercialDiscoveryTrigger } from "@/lib/commercial/discovery-contract";
import { createCommercialDiscoveryRun, executeCommercialDiscoveryRun, getCommercialDiscoveryReadModel } from "@/lib/commercial/discovery-service";
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
    // Production V1 is deliberately canary-locked. The database contract keeps
    // the future 30/run ceiling, but scaling needs a reviewed code promotion.
    if (trigger.maxProspects > COMMERCIAL_DISCOVERY_CANARY_MAX) {
      return NextResponse.json({ ok: false, error: "Discovery is canary-limited to 3 prospects.", code: "commercial_discovery_canary_limit" }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    }
    const run = await createCommercialDiscoveryRun(trigger);
    if (!run.idempotent_replay && run.status === "queued") after(() => executeCommercialDiscoveryRun(String(run.id)));
    return commercialJson(run, 202);
  } catch (error) { return commercialApiError(error); }
}
