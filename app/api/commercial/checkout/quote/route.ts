import { jsonError, jsonOk, readJsonBody } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { countLinkedInstagramAccountsForClient, countReservedEntitlementsForClient } from "@/lib/commercial/entitlements";
import { QUOTE_UNAVAILABLE_EN, QUOTE_UNAVAILABLE_FR } from "@/lib/commercial/checkout-api-messages";
import { buildCommercialQuote } from "@/lib/commercial/pricing";
import { deriveAgencyModeSnapshot } from "@/lib/commercial/agency";
import { projectSimulatedCheckoutAvailability } from "@/lib/commercial/simulated-checkout-guard";
import { projectInitialCheckoutSimulationAvailability } from "@/lib/commercial/initial-checkout-simulation-guard";
import { requireClientInstagramSession, readString } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

type QuoteBody = {
  plan_key?: unknown;
  billing_interval_months?: unknown;
  outreach_addon_key?: unknown;
  client_id?: unknown;
  purchaser_email?: unknown;
  flow_type?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<QuoteBody>(request);
    const planKey = readString(body?.plan_key);
    const billingIntervalMonths = Number(body?.billing_interval_months ?? 1);
    const outreachAddonKey = readString(body?.outreach_addon_key) || null;
    const flowTypeRaw = readString(body?.flow_type, "first_purchase");
    const flowType = flowTypeRaw === "additional_account" ? "additional_account" : "first_purchase";

    let clientId = readString(body?.client_id);
    const session = await requireClientInstagramSession();
    if (session.ok && flowType === "additional_account") {
      clientId = session.clientId;
    } else {
      clientId = "";
    }

    let purchaserEmail = readString(body?.purchaser_email);
    if (!purchaserEmail && session.ok) {
      const supabase = createSupabaseClient();
      const { data } = await supabase.auth.admin.getUserById(session.userId);
      purchaserEmail = readString(data.user?.email);
    }

    const supabase = createSupabaseClient();
    const linkedCount = clientId ? await countLinkedInstagramAccountsForClient(supabase, clientId) : 0;
    const reservedCount = clientId ? await countReservedEntitlementsForClient(supabase, clientId) : 0;
    const agencySnapshot = deriveAgencyModeSnapshot({ linkedAccountCount: linkedCount, reservedEntitlementCount: reservedCount });
    const billableAccountCount = agencySnapshot.billableAccountCount + 1;

    const quote = buildCommercialQuote({
      planKey,
      billingIntervalMonths,
      outreachAddonKey,
      billableAccountCount,
    });
    if ("error" in quote) {
      return jsonError("Invalid checkout selection.", 400, {
        code: quote.error,
        message_fr: "Sélection checkout invalide.",
        message_en: "Invalid checkout selection.",
      });
    }

    const availability = flowType === "first_purchase"
      ? projectInitialCheckoutSimulationAvailability(purchaserEmail || null)
      : null;
    const legacyAvailability = flowType === "additional_account"
      ? projectSimulatedCheckoutAvailability(purchaserEmail || null)
      : null;

    if (flowType === "first_purchase") {
      return jsonOk({
        quote,
        agency: agencySnapshot,
        simulationAvailable: availability?.simulationAvailable ?? false,
        simulationUnavailableReason: availability?.simulationUnavailableReason ?? null,
      });
    }

    return jsonOk({
      quote,
      agency: agencySnapshot,
      simulatedCheckoutEnabled: legacyAvailability?.simulatedCheckoutEnabled ?? false,
      simulatedActivationAvailable: legacyAvailability?.simulatedActivationAvailable ?? false,
      requiresEmail: legacyAvailability?.requiresEmail ?? false,
      activationMessageFr: legacyAvailability?.messageFr,
      activationMessageEn: legacyAvailability?.messageEn,
    });
  } catch (error) {
    console.error("[commercial/checkout/quote] unexpected failure", error);
    return jsonError(QUOTE_UNAVAILABLE_FR, 500, {
      code: "quote_failed",
      message_fr: QUOTE_UNAVAILABLE_FR,
      message_en: QUOTE_UNAVAILABLE_EN,
    });
  }
}
