import { sanitizeRunControlReason } from "@/lib/instagram-dashboard/run-control";
import {
  buildDmProjection,
  DEFAULT_OUTREACH_DM_DAY_CAP,
  DEFAULT_WELCOME_DM_DAY_CAP,
  dmChangedFields,
  projectionToValidationInput,
  readProductDefaultDayCap,
  saveDmDomainPatch,
  validateDmDomainInput,
  type DmDomainPatchInput,
  type DmDomainValidationInput,
} from "@/lib/instagram-dashboard/dm-domain-service";
import { createSupabaseClient } from "@/lib/supabase";
import {
  getAccountId,
  getInstagramAdminUserContext,
  jsonError,
  jsonOk,
  readJsonBody,
  readString,
  requireRelayOrAdmin,
  validateAccountId,
} from "../../_utils";

export const dynamic = "force-dynamic";

export type DmDomainPatchPayload = DmDomainPatchInput & {
  account_id?: unknown;
};

export type { DmDomainValidationInput };
export {
  DEFAULT_OUTREACH_DM_DAY_CAP,
  DEFAULT_WELCOME_DM_DAY_CAP,
  dmChangedFields,
  readProductDefaultDayCap,
  validateDmDomainInput,
};

export async function GET(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "DM settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const accountId = getAccountId(request);
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const projection = await buildDmProjection(supabase, accountId);
    return jsonOk(projection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load DM domain settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not load DM domain settings."), 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const unauthorizedResponse = await requireRelayOrAdmin(request, "DM settings");
    if (unauthorizedResponse) return unauthorizedResponse;

    const body = await readJsonBody<DmDomainPatchPayload>(request);
    if (!body) return jsonError("Invalid DM settings payload.", 400);

    const accountId = readString(body.account_id, getAccountId(request)).trim();
    const accountIdError = validateAccountId(accountId);
    if (accountIdError) return accountIdError;

    const supabase = createSupabaseClient();
    const actorContext = await getInstagramAdminUserContext();
    const result = await saveDmDomainPatch(supabase, {
      accountId,
      patch: body,
      actorId: actorContext?.userId ?? null,
      actorType: "admin",
      sourceSurface: "admin_dashboard",
    });

    if (!result.ok) {
      return jsonError(sanitizeRunControlReason(result.error, "Could not save DM settings."), result.status);
    }

    return jsonOk({ ...result.projection, changed_fields: result.changedFields });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save DM domain settings.";
    return jsonError(sanitizeRunControlReason(message, "Could not save DM domain settings."), 500);
  }
}
