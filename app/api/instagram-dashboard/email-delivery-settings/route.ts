import { NextResponse } from "next/server";
import { createSupabaseClient } from "@/lib/supabase";
import {
  assertNoForbiddenDeliverySettingsSecrets,
  loadTransactionalDeliverySettingsProjection,
  patchTransactionalDeliverySettings,
} from "@/lib/instagram-dashboard/client-email-delivery-settings";
import {
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireRelayOrAdmin,
} from "../_utils";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function withNoStore<T>(response: NextResponse<T>) {
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function readUpdatedBy(request: Request) {
  return request.headers.get("x-external-user-id")?.trim()
    || "botapp_relay";
}

export async function GET(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Email delivery settings");
  if (unauthorizedResponse) return unauthorizedResponse;

  try {
    const supabase = createSupabaseClient();
    const projection = await loadTransactionalDeliverySettingsProjection(supabase);
    return withNoStore(jsonOk(projection));
  } catch {
    return withNoStore(jsonError("Could not load email delivery settings.", 500));
  }
}

type PatchBody = {
  support_email?: unknown;
  supportEmail?: unknown;
  active_from_email?: unknown;
  activeFromEmail?: unknown;
  config_version?: unknown;
  configVersion?: unknown;
  confirmed?: unknown;
};

export async function PATCH(request: Request) {
  const unauthorizedResponse = await requireRelayOrAdmin(request, "Email delivery settings");
  if (unauthorizedResponse) return unauthorizedResponse;

  const body = (await readJsonBody<PatchBody>(request)) ?? {};
  const forbidden = assertNoForbiddenDeliverySettingsSecrets(body as Record<string, unknown>);
  if (forbidden) return withNoStore(jsonError(forbidden, 400));

  try {
    const supabase = createSupabaseClient();
    const userContext = await getInstagramAdminUserContext();
    const changedBy = request.headers.get("x-external-user-id")?.trim()
      || userContext?.userId
      || readUpdatedBy(request);

    const result = await patchTransactionalDeliverySettings(supabase, {
      supportEmail: body.support_email ?? body.supportEmail,
      activeFromEmail: body.active_from_email ?? body.activeFromEmail,
      configVersion: body.config_version ?? body.configVersion,
      confirmed: body.confirmed === true,
    }, changedBy);

    if (!result.ok) {
      const status = result.reason === "schema_unavailable"
        ? 503
        : result.reason === "config_version_mismatch"
          ? 409
          : result.reason === "confirmation_required"
            || result.reason === "invalid_support_email"
            || result.reason === "invalid_active_from_email"
            || result.reason === "sender_not_confirmed"
            || result.reason === "stale_sender_refresh"
            || result.reason === "no_changes"
            ? 400
            : 503;
      return withNoStore(jsonError(result.message, status, { reason: result.reason }));
    }

    const projection = await loadTransactionalDeliverySettingsProjection(supabase);
    return withNoStore(jsonOk({
      settings: result.settings,
      projection,
      log_event: "transactional_delivery_settings_saved",
    }));
  } catch {
    return withNoStore(jsonError("Could not save email delivery settings.", 500));
  }
}
