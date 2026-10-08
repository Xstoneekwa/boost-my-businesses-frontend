import "server-only";
import { requireCommercialCrmAccess } from "./crm-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SireneExactProvider } from "./sirene-exact-provider";
import { SireneSchemaError } from "./sirene-alias-parser";
import { assertSireneAliasTarget } from "./sirene-alias-diagnostic-contract";

type Input = Parameters<typeof assertSireneAliasTarget>[0];
async function control(actor: string, action: string, itemId?: string, payload: unknown = {}) {
  const { data, error } = await createSupabaseAdminClient().rpc("commercial_sirene_alias_v3a_control", { p_actor_user_id: actor, p_action: action, p_item_id: itemId ?? null, p_payload: payload });
  if (error) throw new Error("alias_database_control_failed");
  return data as { replay: boolean; status: string; inputs: Input[] | null };
}

/** Only owner-authenticated POST invokes this; no cron, discovery or transport imports. */
export async function runSireneAliasDiagnostic() {
  const actor = await requireCommercialCrmAccess();
  const apiKey = process.env.SIRENE_API_KEY?.trim();
  if (!apiKey) throw new Error("sirene_configuration_missing");
  const started = await control(actor.userId, "start");
  if (started.replay) return started;
  try {
    if (started.inputs?.length !== 4) throw new Error("alias_exact_four_required");
    // Validate ALL fixed identities before consuming the first reservation or request.
    for (const input of started.inputs) assertSireneAliasTarget(input);
    const provider = new SireneExactProvider();
    for (const input of started.inputs) {
      await control(actor.userId, "reserve", input.itemId);
      let result;
      try {
        result = await provider.getEstablishmentBySiret(input, apiKey, new Date().toISOString());
      } catch (error) {
        const schemaFailure = error instanceof SireneSchemaError;
        await control(actor.userId, "record", input.itemId, { outcome: schemaFailure ? "SCHEMA_FAIL" : "ERROR", schema: "FAIL", aliases: [], mismatches: schemaFailure ? error.mismatches : [], errorCode: schemaFailure ? "sirene_live_schema_mismatch" : error instanceof Error && /^sirene_(http_\d{3}|network_failure)$/.test(error.message) ? error.message : "sirene_detail_failed" });
        return { replay: false, status: "failed", inputs: null };
      }
      // No writes of aliases can occur before parser schema + current eligibility checks.
      await control(actor.userId, "record", input.itemId, { ...result, outcome: result.eligibility.prospectingEligible ? "SUCCESS" : "INELIGIBLE", mismatches: [] });
    }
    return await control(actor.userId, "complete");
  } catch {
    await control(actor.userId, "fail");
    return { replay: false, status: "failed", inputs: null };
  }
}
