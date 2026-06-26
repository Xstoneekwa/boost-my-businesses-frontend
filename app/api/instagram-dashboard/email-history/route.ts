import { jsonError, jsonOk, readString, requireRelayOrAdmin } from "../_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { loadClientEmailHistoryProjection } from "@/lib/instagram-dashboard/client-email-history";
import {
  CLIENT_EMAIL_DELIVERY_STATUSES,
  CLIENT_EMAIL_SEND_TRIGGERS,
  CLIENT_EMAIL_TEMPLATE_CATEGORIES,
  type ClientEmailDeliveryStatus,
  type ClientEmailSendTrigger,
  type ClientEmailTemplateCategory,
} from "@/lib/instagram-dashboard/client-email-constants";

export const dynamic = "force-dynamic";

function readCategory(value: string): ClientEmailTemplateCategory | undefined {
  return CLIENT_EMAIL_TEMPLATE_CATEGORIES.includes(value as ClientEmailTemplateCategory)
    ? value as ClientEmailTemplateCategory
    : undefined;
}

function readTrigger(value: string): ClientEmailSendTrigger | undefined {
  return CLIENT_EMAIL_SEND_TRIGGERS.includes(value as ClientEmailSendTrigger)
    ? value as ClientEmailSendTrigger
    : undefined;
}

function readStatus(value: string): ClientEmailDeliveryStatus | undefined {
  return CLIENT_EMAIL_DELIVERY_STATUSES.includes(value as ClientEmailDeliveryStatus)
    ? value as ClientEmailDeliveryStatus
    : undefined;
}

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Email history");
  if (unauthorizedResponse) return unauthorizedResponse;

  const url = new URL(request.url);
  const period = readString(url.searchParams.get("period"), "30d") as "7d" | "30d" | "90d" | "custom";
  const from = readString(url.searchParams.get("from"), "").trim() || undefined;
  const to = readString(url.searchParams.get("to"), "").trim() || undefined;
  const clientId = readString(url.searchParams.get("client_id"), "").trim() || undefined;
  const accountId = readString(url.searchParams.get("account_id"), "").trim() || undefined;
  const category = readCategory(readString(url.searchParams.get("category"), "").trim());
  const trigger = readTrigger(readString(url.searchParams.get("trigger"), "").trim());
  const deliveryStatus = readStatus(readString(url.searchParams.get("status"), "").trim())
    ?? readString(url.searchParams.get("intent_status"), "").trim() as ClientEmailDeliveryStatus | undefined;
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("page_size") ?? url.searchParams.get("pageSize") ?? "25");

  try {
    const supabase = createSupabaseClient();
    const projection = await loadClientEmailHistoryProjection(supabase, {
      period,
      from,
      to,
      clientId,
      accountId,
      category,
      trigger,
      deliveryStatus,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 25,
    });
    return jsonOk(projection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load email history.";
    return jsonError(message, 500);
  }
}
