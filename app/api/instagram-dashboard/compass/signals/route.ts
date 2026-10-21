import { persistCompassCollection } from "@/lib/instagram-dashboard/compass-v2-data";
import { jsonError, jsonOk, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const unauthorized = await requireRelayOrAdmin(request, "Compass signal ingestion");
  if (unauthorized) return unauthorized;
  if (Number(request.headers.get("content-length")) > 524288) return jsonError("Batch too large.", 413);
  let body: {signals?: unknown[]; source_checks?: unknown[]};
  try {
    const reader=request.body?.getReader();
    if(!reader) return jsonError("Missing body.",400);
    const chunks: Uint8Array[]=[]; let size=0;
    while(true) { const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>524288) {await reader.cancel();return jsonError("Batch too large.",413);} chunks.push(value); }
    body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return jsonError("Invalid JSON.",400); }
  if (!body || !Array.isArray(body.signals)) return jsonError("Invalid Compass collection batch.", 400);
  try {
    return jsonOk(await persistCompassCollection({ signals: body.signals, sourceChecks: body.source_checks }), 202);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Compass collection failed.", 400);
  }
}
