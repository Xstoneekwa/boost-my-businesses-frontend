import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import {
  buildMaterializeSingleGateClosedResponse,
  executeMaterializeSingleRequest,
} from "@/lib/instagram-dashboard/client-email-materialize-single";
import {
  evaluateClientEmailMaterializationExecutionGate,
} from "@/lib/instagram-dashboard/client-email-materialization-execution-gate";
import { jsonError, requireRelayOrAdmin } from "../../_utils";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

export async function POST(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Materialize single client email");
  if (unauthorizedResponse) return unauthorizedResponse;

  const executionGate = evaluateClientEmailMaterializationExecutionGate(process.env);
  if (!executionGate.enabled) {
    return NextResponse.json(
      buildMaterializeSingleGateClosedResponse(),
      {
        status: 409,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const supabase = createSupabaseClient();
    const body = await request.json();
    const result = await executeMaterializeSingleRequest({ supabase, body });
    return NextResponse.json(result.body, {
      status: result.status,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Could not execute single client email materialization.";
    return jsonError(message, 500);
  }
}
