import { runSireneAliasDiagnostic } from "@/lib/commercial/sirene-alias-diagnostic-service";
import { SIRENE_ALIAS_DIAGNOSTIC_KEY } from "@/lib/commercial/sirene-alias-diagnostic-contract";
import { commercialApiError, commercialJson } from "../../_response";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "same_origin_required" }, { status: 403 });
    const body = await request.json();
    if (!body || Object.keys(body).length !== 1 || body.authorizationKey !== SIRENE_ALIAS_DIAGNOSTIC_KEY) return Response.json({ error: "fixed_diagnostic_only" }, { status: 400 });
    return commercialJson(await runSireneAliasDiagnostic());
  } catch (error) { return commercialApiError(error); }
}
