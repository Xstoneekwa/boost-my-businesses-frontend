import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readJsonBody, requireInstagramAdmin, getInstagramAdminUserContext } from "@/app/api/instagram-dashboard/_utils";
import {
  createProdTestCheckoutAuthorization,
  redactProdTestAuthorizationStatus,
  revokeProdTestCheckoutAuthorization,
  resolveProdTestCheckoutClientIdByEmail,
  type ProdTestCheckoutAuthorizationRow,
} from "@/lib/commercial/prod-test-checkout-authorization";
import { isPlanKey, type PlanKey } from "@/lib/commercial/catalog";

export const dynamic = "force-dynamic";

const DEFAULT_DURATION_HOURS = 48;
const MAX_DURATION_HOURS = 168;

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

function readDurationHours(value: unknown) {
  const parsed = Number(value ?? DEFAULT_DURATION_HOURS);
  if (!Number.isFinite(parsed)) return DEFAULT_DURATION_HOURS;
  return Math.max(1, Math.min(MAX_DURATION_HOURS, Math.floor(parsed)));
}

export async function GET() {
  const unauthorized = await requireInstagramAdmin();
  if (unauthorized) return unauthorized;

  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("commercial_prod_test_checkout_authorizations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return jsonError("Impossible de charger les autorisations de test.", 500);
  }

  return jsonOk({
    authorizations: (data ?? []).map((row) => redactProdTestAuthorizationStatus(row as ProdTestCheckoutAuthorizationRow)),
  });
}

type CreateBody = {
  email?: unknown;
  duration_hours?: unknown;
  max_accounts?: unknown;
  plan_key?: unknown;
  billing_interval_months?: unknown;
  admin_confirmation_acknowledged?: unknown;
  scope?: unknown;
};

export async function POST(request: Request) {
  const unauthorized = await requireInstagramAdmin();
  if (unauthorized) return unauthorized;

  const adminContext = await getInstagramAdminUserContext();
  if (!adminContext?.userId) {
    return jsonError("Session admin indisponible.", 401);
  }

  const body = await readJsonBody<CreateBody>(request);
  const email = readString(body?.email);
  const durationHours = readDurationHours(body?.duration_hours);
  const maxAccountsRaw = Number(body?.max_accounts ?? 1);
  const maxAccounts = Number.isFinite(maxAccountsRaw) ? Math.max(1, Math.min(10, Math.floor(maxAccountsRaw))) : 1;
  const scope = readString(body?.scope, "add_account") === "first_purchase" ? "first_purchase" : "add_account";
  const planKeyRaw = readString(body?.plan_key);
  const planKey = planKeyRaw && isPlanKey(planKeyRaw) ? planKeyRaw as PlanKey : null;
  const billingIntervalMonthsRaw = Number(body?.billing_interval_months ?? 0);
  const billingIntervalMonths = [1, 3, 6, 12].includes(billingIntervalMonthsRaw)
    ? billingIntervalMonthsRaw as 1 | 3 | 6 | 12
    : null;
  const adminConfirmationAcknowledged = body?.admin_confirmation_acknowledged === true;

  if (!email || !email.includes("@")) {
    return jsonError("Adresse e-mail invalide.", 400);
  }
  if (!adminConfirmationAcknowledged) {
    return jsonError("Confirmation admin requise.", 400, {
      code: "admin_confirmation_required",
    });
  }

  const supabase = createSupabaseClient();
  try {
    const resolvedClientId = await resolveProdTestCheckoutClientIdByEmail(supabase, email);
    const clientId = scope === "add_account" ? resolvedClientId : null;
    if (scope === "add_account" && !clientId) {
      return jsonError("Aucun tenant actif ne correspond à cette adresse e-mail.", 409, {
        code: "authorization_tenant_not_found",
      });
    }
    if (scope === "first_purchase" && resolvedClientId) {
      return jsonError("Cette adresse e-mail appartient déjà à un tenant actif.", 409, {
        code: "authorization_scope_mismatch",
      });
    }

    const result = await createProdTestCheckoutAuthorization({
      supabase,
      email,
      createdByAuthUserId: adminContext.userId,
      expiresAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
      maxAccounts,
      planKey,
      billingIntervalMonths,
      authorizedFlows: scope === "add_account" ? ["new_account"] : ["first_purchase"],
      clientId,
      adminConfirmationAcknowledged,
    });

    return jsonOk({
      authorization: result.authorization,
      action: result.action,
      message_fr: result.action === "created"
        ? "Autorisation de test créée. Aucun tenant ni checkout n'a été activé."
        : result.action === "expanded"
          ? "Autorisation de test étendue à ce parcours. Aucun checkout n'a été activé."
        : result.action === "renewed"
          ? "Autorisation de test prolongée. Aucun checkout n'a été activé."
          : "Autorisation active réutilisée. Aucun checkout n'a été activé.",
      message_en: result.action === "created"
        ? "Test authorization created. No tenant or checkout was activated."
        : result.action === "expanded"
          ? "Test authorization expanded to this flow. No checkout was activated."
        : result.action === "renewed"
          ? "Test authorization extended. No checkout was activated."
          : "Active authorization reused. No checkout was activated.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "create_failed";
    if (message === "production_environment_required") {
      return jsonError("Disponible uniquement sur la base de production.", 403, { code: message });
    }
    if (["authorization_tenant_mismatch", "authorization_scope_mismatch", "authorization_tenant_ambiguous", "authorization_tenant_lookup_failed"].includes(message)) {
      const errorFr = message === "authorization_tenant_mismatch"
        ? "L'autorisation active appartient à un autre tenant."
        : message === "authorization_scope_mismatch"
          ? "L'autorisation active possède une portée incompatible."
          : message === "authorization_tenant_ambiguous"
            ? "Plusieurs tenants actifs correspondent à cette adresse e-mail."
            : "La recherche du tenant a échoué.";
      return jsonError(errorFr, 409, { code: message });
    }
    if (message === "prod_test_authorization_create_failed") {
      return jsonError("Impossible de créer ou renouveler l'autorisation.", 409, { code: message });
    }
    return jsonError("Impossible de créer l'autorisation de test.", 500, { code: message });
  }
}

type RevokeBody = {
  authorization_id?: unknown;
  admin_confirmation_acknowledged?: unknown;
};

export async function DELETE(request: Request) {
  const unauthorized = await requireInstagramAdmin();
  if (unauthorized) return unauthorized;

  const adminContext = await getInstagramAdminUserContext();
  if (!adminContext?.userId) return jsonError("Session admin indisponible.", 401);

  const body = await readJsonBody<RevokeBody>(request);
  const authorizationId = readString(body?.authorization_id);
  const adminConfirmationAcknowledged = body?.admin_confirmation_acknowledged === true;
  if (!authorizationId) return jsonError("Autorisation invalide.", 400, { code: "authorization_id_required" });
  if (!adminConfirmationAcknowledged) {
    return jsonError("Confirmation admin requise.", 400, { code: "admin_confirmation_required" });
  }

  try {
    const result = await revokeProdTestCheckoutAuthorization({
      supabase: createSupabaseClient(),
      authorizationId,
      revokedByAuthUserId: adminContext.userId,
      adminConfirmationAcknowledged,
    });
    return jsonOk({
      authorization: result.authorization,
      action: result.action,
      message_fr: result.action === "revoked"
        ? "Activation Test désactivée. Aucun checkout ni abonnement n'a été modifié."
        : "Cette autorisation était déjà inactive.",
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "revoke_failed";
    const status = code === "prod_test_authorization_not_found" ? 404 : code === "production_environment_required" ? 403 : 500;
    return jsonError("Impossible de désactiver cette autorisation Test.", status, { code });
  }
}
