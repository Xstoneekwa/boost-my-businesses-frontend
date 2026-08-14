import "server-only";

import { getInstagramUserContext } from "@/lib/restaurant-analytics/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { UserContext } from "@/lib/userContext";
import {
  COMMERCIAL_CRM_ACCESS_PERMISSION,
  evaluateCommercialCrmAccess,
  type CommercialCrmAccessDecision,
} from "@/lib/commercial/crm-access-policy";

export type CommercialCrmAccessResult =
  | { allowed: true; context: UserContext }
  | (Extract<CommercialCrmAccessDecision, { allowed: false }> & { context?: never });

export class CommercialCrmAccessError extends Error {
  readonly status: 401 | 403 | 503;
  readonly code: Extract<CommercialCrmAccessDecision, { allowed: false }>["code"];

  constructor(decision: Extract<CommercialCrmAccessDecision, { allowed: false }>) {
    super(decision.code);
    this.name = "CommercialCrmAccessError";
    this.status = decision.status;
    this.code = decision.code;
  }
}

/**
 * Fail-closed Commercial CRM authorization for future server routes.
 *
 * Authentication is resolved through Supabase Auth getUser() by the existing
 * httpOnly-cookie session resolver. Generic superadmin status is necessary but
 * insufficient: the actor must also hold the active server-only DB grant.
 */
export async function resolveCommercialCrmAccess(): Promise<CommercialCrmAccessResult> {
  let context: UserContext | null;

  try {
    context = await getInstagramUserContext();
  } catch {
    return {
      allowed: false,
      status: 503,
      code: "commercial_crm_access_check_unavailable",
    };
  }

  const sessionDecision = evaluateCommercialCrmAccess({
    authenticated: context !== null,
    role: context?.role ?? null,
    grantLookupSucceeded: true,
    hasActiveGrant: false,
  });

  if (!context) {
    if (sessionDecision.allowed) {
      return {
        allowed: false,
        status: 503,
        code: "commercial_crm_access_check_unavailable",
      };
    }
    return sessionDecision;
  }

  if (!sessionDecision.allowed && sessionDecision.code !== "commercial_crm_access_grant_required") {
    return sessionDecision;
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: grant, error } = await supabase
      .from("internal_access_grants")
      .select("id")
      .eq("auth_user_id", context.userId)
      .eq("permission_key", COMMERCIAL_CRM_ACCESS_PERMISSION)
      .eq("active", true)
      .is("revoked_at", null)
      .maybeSingle<{ id: string }>();

    const decision = evaluateCommercialCrmAccess({
      authenticated: true,
      role: context.role,
      grantLookupSucceeded: !error,
      hasActiveGrant: Boolean(grant),
    });

    return decision.allowed ? { allowed: true, context } : decision;
  } catch {
    return {
      allowed: false,
      status: 503,
      code: "commercial_crm_access_check_unavailable",
    };
  }
}

export async function requireCommercialCrmAccess(): Promise<UserContext> {
  const result = await resolveCommercialCrmAccess();
  if (!result.allowed) {
    throw new CommercialCrmAccessError(result);
  }
  return result.context;
}
