import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { loadPlanChangeEligibleAccounts } from "@/lib/commercial/plan-change-eligible-accounts";
import { requireClientInstagramSession } from "@/lib/instagram-client/_utils";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireClientInstagramSession();
  if (!session.ok) {
    return jsonError("Connexion client requise.", 401, {
      code: "session_required",
      message_fr: "Connexion client requise.",
      message_en: "Client login is required.",
    });
  }

  const supabase = createSupabaseClient();
  const accounts = await loadPlanChangeEligibleAccounts(supabase, session.clientId);

  return jsonOk({
    accounts: accounts.map((account) => ({
      account_id: account.accountId,
      username: account.username,
      current_plan_key: account.currentPlanKey,
      current_plan_label: account.currentPlanLabel,
      source_entitlement_id: account.sourceEntitlementId,
      eligible: account.eligible,
      ineligible_code: account.ineligibleCode,
    })),
  });
}
