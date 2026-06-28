import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, readJsonBody, requireInstagramAdmin, getInstagramAdminUserContext } from "@/app/api/instagram-dashboard/_utils";
import {
  createProdTestCheckoutAuthorization,
  redactProdTestAuthorizationStatus,
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
  const maxAccountsRaw = Number(body?.max_accounts ?? 2);
  const maxAccounts = Number.isFinite(maxAccountsRaw) ? Math.max(1, Math.min(2, Math.floor(maxAccountsRaw))) : 2;
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
    const authorization = await createProdTestCheckoutAuthorization({
      supabase,
      email,
      createdByAuthUserId: adminContext.userId,
      expiresAt: new Date(Date.now() + durationHours * 60 * 60 * 1000),
      maxAccounts,
      planKey,
      billingIntervalMonths,
      adminConfirmationAcknowledged,
    });

    return jsonOk({
      authorization,
      message_fr: "Autorisation de test créée. Aucun tenant ni checkout n'a été activé.",
      message_en: "Test authorization created. No tenant or checkout was activated.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "create_failed";
    if (message === "production_environment_required") {
      return jsonError("Disponible uniquement sur la base de production.", 403, { code: message });
    }
    if (message === "prod_test_authorization_create_failed") {
      return jsonError("Impossible de créer l'autorisation (email déjà actif ?).", 409, { code: message });
    }
    return jsonError("Impossible de créer l'autorisation de test.", 500, { code: message });
  }
}
