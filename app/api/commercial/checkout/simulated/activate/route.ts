import { readJsonBody } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { activateClientAccountEntitlementFromCheckout } from "@/lib/commercial/activate-client-account-entitlement-from-checkout";
import {
  checkoutActivationError,
  checkoutActivationUnexpectedError,
  jsonOk as checkoutJsonOk,
} from "@/lib/commercial/checkout-route-response";
import { requireClientInstagramSession, readString } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

type ActivateBody = {
  plan_key?: unknown;
  billing_interval_months?: unknown;
  outreach_addon_key?: unknown;
  purchaser_email?: unknown;
  password?: unknown;
  password_confirmation?: unknown;
  idempotency_key?: unknown;
  flow_type?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<ActivateBody>(request);
    const planKey = readString(body?.plan_key);
    const billingIntervalMonths = Number(body?.billing_interval_months ?? 1);
    const outreachAddonKey = readString(body?.outreach_addon_key) || null;
    const purchaserEmail = readString(body?.purchaser_email);
    const idempotencyKey = readString(body?.idempotency_key);
    const flowTypeRaw = readString(body?.flow_type, "first_purchase");
    const flowType = flowTypeRaw === "additional_account" ? "additional_account" : "first_purchase";

    const supabase = createSupabaseClient();
    const session = await requireClientInstagramSession();
    let sessionEmail = "";
    if (session.ok) {
      const { data } = await supabase.auth.admin.getUserById(session.userId);
      sessionEmail = readString(data.user?.email);
    }

    const browserSession = session.ok
      ? {
        userId: session.userId,
        clientId: session.clientId,
        sessionEmail,
      }
      : null;

    const clientId = flowType === "additional_account" && session.ok ? session.clientId : null;
    const authUserId = flowType === "additional_account" && session.ok ? session.userId : null;

    if (flowType === "additional_account" && !clientId) {
      return checkoutActivationError(401, "session_required", {
        messageFr: "Connexion client requise pour cet achat.",
        messageEn: "Client login is required for this purchase.",
      });
    }

    let email = purchaserEmail;
    if (!email && authUserId) {
      const { data } = await supabase.auth.admin.getUserById(authUserId);
      email = readString(data.user?.email);
    }
    if (!email) {
      return checkoutActivationError(400, "email_required", {
        messageFr: "Adresse e-mail requise.",
        messageEn: "Email address is required.",
      });
    }

    const result = await activateClientAccountEntitlementFromCheckout(supabase, {
      planKey,
      billingIntervalMonths,
      outreachAddonKey,
      purchaserEmail: email,
      idempotencyKey,
      flowType,
      clientId,
      authUserId,
      browserSession,
      password: flowType === "first_purchase" ? readString(body?.password) : null,
      passwordConfirmation: flowType === "first_purchase" ? readString(body?.password_confirmation) : null,
      mode: "simulated",
    });

    if (!result.ok) {
      return checkoutActivationError(result.status, result.code, {
        messageFr: result.messageFr ?? result.error,
        messageEn: result.messageEn,
        redirectPath: result.redirectPath,
        handoff: result.handoff,
      });
    }

    const handoff = result.handoff;
    const isPublicHandoff = handoff.type === "email_login";

    return checkoutJsonOk({
      idempotent_replay: result.idempotentReplay,
      checkout_session_id: result.checkoutSessionId,
      entitlement_id: result.entitlementId,
      client_id: result.clientId,
      checkout_context: result.checkoutContext,
      handoff_type: handoff.type,
      login_path: handoff.type === "email_login" ? handoff.loginPath : null,
      redirect_path: result.redirectPath,
      quote: result.quote,
      message_fr: result.idempotentReplay
        ? (isPublicHandoff
          ? "Activation de test déjà confirmée. Connectez-vous pour accéder à votre espace client."
          : "Activation de test déjà confirmée pour cette session.")
        : (isPublicHandoff
          ? "Activation de test confirmée. Aucun paiement n'a été encaissé. Votre espace client est prêt. Connectez-vous pour poursuivre."
          : "Activation de test confirmée. Aucun paiement n'a été encaissé. Votre espace client est prêt."),
      message_en: result.idempotentReplay
        ? (isPublicHandoff
          ? "Test activation was already confirmed. Sign in to access your client workspace."
          : "Test activation was already confirmed for this session.")
        : (isPublicHandoff
          ? "Test activation confirmed. No payment was collected. Your client workspace is ready. Sign in to continue."
          : "Test activation confirmed. No payment was collected. Your client workspace is ready."),
    });
  } catch (error) {
    return checkoutActivationUnexpectedError(error);
  }
}
