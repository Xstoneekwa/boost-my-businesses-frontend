import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { countLinkedInstagramAccountsForClient, countReservedEntitlementsForClient } from "@/lib/commercial/entitlements";
import { buildDashboardAgencyPricingSnapshot } from "@/lib/commercial/pricing-snapshot";
import { requireClientInstagramSession } from "@/lib/instagram-client/_utils";
import { createSupabaseClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireClientInstagramSession();
  if (!session.ok) return jsonError(session.error, session.status);

  const url = new URL(request.url);
  if (url.searchParams.has("linked_account_count") || url.searchParams.has("billable_account_count")) {
    return jsonError("Requête invalide.", 400, {
      code: "client_counts_not_allowed",
      message_fr: "Les compteurs commerciaux sont calculés côté serveur.",
      message_en: "Commercial counters are computed server-side.",
    });
  }

  const supabase = createSupabaseClient();
  const [linkedCount, reservedCount] = await Promise.all([
    countLinkedInstagramAccountsForClient(supabase, session.clientId),
    countReservedEntitlementsForClient(supabase, session.clientId),
  ]);

  const snapshotResult = buildDashboardAgencyPricingSnapshot({
    linkedAccountCount: linkedCount,
    reservedEntitlementCount: reservedCount,
  });

  if ("error" in snapshotResult) {
    return jsonError("Statut commercial indisponible.", 500, {
      code: snapshotResult.error,
      message_fr: "Statut commercial indisponible.",
      message_en: "Commercial status unavailable.",
    });
  }

  return jsonOk({
    agencyModeActive: snapshotResult.agencyModeActive,
    agencyDisplayCount: snapshotResult.agencyDisplayCount,
    billableAccountCount: snapshotResult.billableAccountCount,
    pricingSnapshot: snapshotResult,
  });
}
