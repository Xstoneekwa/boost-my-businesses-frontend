import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { countLinkedInstagramAccountsForClient, countReservedEntitlementsForClient, getReservedEntitlementForClient } from "@/lib/commercial/entitlements";
import { deriveAgencyModeSnapshot } from "@/lib/commercial/agency";
import { requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireClientInstagramSession();
  if (!session.ok) return jsonError(session.error, session.status);

  const supabase = createSupabaseClient();
  const [reserved, linkedCount, reservedCount] = await Promise.all([
    getReservedEntitlementForClient(supabase, session.clientId),
    countLinkedInstagramAccountsForClient(supabase, session.clientId),
    countReservedEntitlementsForClient(supabase, session.clientId),
  ]);

  const agency = deriveAgencyModeSnapshot({
    linkedAccountCount: linkedCount,
    reservedEntitlementCount: reservedCount,
  });

  return jsonOk({
    reserved_entitlement: reserved,
    agency,
    can_add_account_directly: Boolean(reserved?.id),
    must_choose_plan: !reserved?.id,
  });
}
