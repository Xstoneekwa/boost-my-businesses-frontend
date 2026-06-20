import { jsonError, jsonOk, readJsonBody } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { activateClientAccountEntitlementFromCheckout } from "@/lib/commercial/activate-client-account-entitlement-from-checkout";
import { requireClientInstagramSession, readString } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

type ActivateBody = {
  plan_key?: unknown;
  billing_interval_months?: unknown;
  outreach_addon_key?: unknown;
  purchaser_email?: unknown;
  idempotency_key?: unknown;
  flow_type?: unknown;
};

export async function POST(request: Request) {
  const body = await readJsonBody<ActivateBody>(request);
  const planKey = readString(body?.plan_key);
  const billingIntervalMonths = Number(body?.billing_interval_months ?? 1);
  const outreachAddonKey = readString(body?.outreach_addon_key) || null;
  const purchaserEmail = readString(body?.purchaser_email);
  const idempotencyKey = readString(body?.idempotency_key);
  const flowTypeRaw = readString(body?.flow_type, "first_purchase");
  const flowType = flowTypeRaw === "additional_account" ? "additional_account" : "first_purchase";

  const session = await requireClientInstagramSession();
  const clientId = session.ok ? session.clientId : null;
  const authUserId = session.ok ? session.userId : null;

  if (flowType === "additional_account" && !clientId) {
    return jsonError("Client session required for additional account checkout.", 401, { code: "session_required" });
  }

  let email = purchaserEmail;
  if (!email && authUserId) {
    const supabase = createSupabaseClient();
    const { data } = await supabase.auth.admin.getUserById(authUserId);
    email = readString(data.user?.email);
  }
  if (!email) {
    return jsonError("Purchaser email is required.", 400, { code: "email_required" });
  }

  const supabase = createSupabaseClient();
  const result = await activateClientAccountEntitlementFromCheckout(supabase, {
    planKey,
    billingIntervalMonths,
    outreachAddonKey,
    purchaserEmail: email,
    idempotencyKey,
    flowType,
    clientId,
    authUserId,
    mode: "simulated",
  });

  if (!result.ok) {
    return jsonError(result.error, result.status, {
      code: result.code,
      message_fr: result.messageFr,
      message_en: result.messageEn,
    });
  }

  return jsonOk({
    idempotent_replay: result.idempotentReplay,
    checkout_session_id: result.checkoutSessionId,
    entitlement_id: result.entitlementId,
    client_id: result.clientId,
    redirect_path: result.redirectPath,
    quote: result.quote,
    message_fr: result.idempotentReplay
      ? "Activation de test déjà confirmée pour cette session."
      : "Activation de test confirmée. Aucun paiement n'a été encaissé. Votre espace client est prêt.",
    message_en: result.idempotentReplay
      ? "Test activation was already confirmed for this session."
      : "Test activation confirmed. No payment was collected. Your client workspace is ready.",
  });
}
