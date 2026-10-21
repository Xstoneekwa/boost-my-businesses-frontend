import "server-only";
import { createSupabaseClient } from "@/lib/supabase";
import { jsonError, jsonOk, resolveInstagramDashboardActor } from "@/app/api/instagram-dashboard/_utils";

export async function fleetOperatorRequest(request: Request, mode: "read" | "preview" | "apply" | "history") {
  const auth = await resolveInstagramDashboardActor(request, "Fleet Control");
  if (!auth.ok) return auth.response;
  let input: unknown;
  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      if ([...url.searchParams.keys()].some((key) => key !== "input")) return jsonError("fleet_operator_input_invalid", 400);
      input = JSON.parse(url.searchParams.get("input") ?? (mode === "history" ? "{}" : '{"kind":"ALL"}'));
    } else {
      const text = await request.text();
      if (text.length > 131072) return jsonError("fleet_operator_input_invalid", 413);
      input = JSON.parse(text);
    }
  } catch { return jsonError("fleet_operator_input_invalid", 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return jsonError("fleet_operator_input_invalid", 400);
  const names = { read: "fleet_operator_targets_v1", preview: "fleet_operator_preview_v1", apply: "fleet_operator_apply_v1", history: "fleet_operator_history_v1" };
  const args = mode === "read" ? { p_actor: auth.actor.actorId, p_scope: input } : { p_actor: auth.actor.actorId, p_input: input };
  const { data, error } = await createSupabaseClient().rpc(names[mode], args);
  if (error) {
    if (error.code === "42501") return jsonError("fleet_operator_forbidden", 403);
    if (["fleet_preview_stale", "fleet_bulk_replay_conflict", "fleet_policy_revision_conflict"].includes(error.message)) return jsonError(error.message, 409);
    if (error.code?.startsWith("22")) return jsonError("fleet_operator_input_invalid", 400);
    return jsonError("fleet_operator_unavailable", 503);
  }
  if (mode === "read") {
    if (!Array.isArray(data)) return jsonError("fleet_operator_unavailable", 503);
    const knownStates = new Set(["REQUESTED", "ACTIVE", "WAITING", "PARTIAL", "RELEASING", "CLEARED"]);
    const inactive = new Set(["archived", "bin", "deleted"]);
    const skipped = data.filter((row) => inactive.has(row.lifecycle)).length;
    const blocked = data.filter((row) => !inactive.has(row.lifecycle)
      && (row.binding_valid !== true || !knownStates.has(row.state))).length;
    return jsonOk({
      targets: data,
      resolved_account_count: data.length,
      eligible_count: data.length - skipped - blocked,
      blocked_count: blocked,
      skipped_count: skipped,
      eligibility_basis: "scope_binding_and_lifecycle; operation eligibility requires preview",
    });
  }
  return jsonOk(data);
}
