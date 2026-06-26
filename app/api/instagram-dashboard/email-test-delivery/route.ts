import { createSupabaseClient } from "@/lib/supabase";
import {
  CLIENT_EMAIL_TEMPLATE_CATEGORIES,
  type ClientEmailTemplateCategory,
} from "@/lib/instagram-dashboard/client-email-constants";
import {
  executeClientEmailTestDelivery,
  loadClientEmailTestDeliveryStatus,
} from "@/lib/instagram-dashboard/client-email-test-delivery";
import { requireRelayOrAdmin, jsonError, jsonOk } from "../_utils";

export const dynamic = "force-dynamic";

function readCategory(value: unknown): ClientEmailTemplateCategory | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return CLIENT_EMAIL_TEMPLATE_CATEGORIES.includes(normalized as ClientEmailTemplateCategory)
    ? normalized as ClientEmailTemplateCategory
    : null;
}

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Email test delivery");
    if (unauthorizedResponse) return unauthorizedResponse;

    const supabase = createSupabaseClient();
    const status = await loadClientEmailTestDeliveryStatus(supabase);
    return jsonOk(status);
  } catch {
    return jsonError("Could not load email test delivery status.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "Email test delivery");
    if (unauthorizedResponse) return unauthorizedResponse;

    let body: Record<string, unknown> = {};
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return jsonError("Invalid JSON payload.", 400);
    }

    const category = readCategory(body.category);
    if (!category) {
      return jsonError("Template category is required.", 400, { reason: "invalid_category" });
    }

    const supabase = createSupabaseClient();
    const result = await executeClientEmailTestDelivery(
      supabase,
      {
        category,
        confirmed: body.confirm === true || body.confirmed === true,
      },
      body,
    );

    if (!result.ok) {
      const status = result.reason === "gate_closed" || result.reason === "test_schema_unavailable"
        ? 503
        : result.reason === "forbidden_recipient_field" || result.reason === "invalid_category"
          ? 400
          : result.reason === "confirmation_required"
            ? 400
            : 409;
      return jsonError(result.message, status, { reason: result.reason });
    }

    return jsonOk({
      action: result.action,
      intentId: result.intentId,
      providerMessageId: result.providerMessageId,
    });
  } catch {
    return jsonError("Email test delivery failed.", 500);
  }
}
