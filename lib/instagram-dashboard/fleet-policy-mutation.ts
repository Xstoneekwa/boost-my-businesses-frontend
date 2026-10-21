import "server-only";
import { createSupabaseClient } from "@/lib/supabase";

export class FleetPolicyMutationError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid = () => new FleetPolicyMutationError("fleet_policy_input_invalid", 400);

export function parseFleetPolicyMutation(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const input = value as Record<string, unknown>;
  const allowed = new Set(["account_id", "tenant_id", "request_id", "action", "expected_revision", "cap"]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw invalid();
  for (const key of ["account_id", "tenant_id", "request_id"]) {
    if (typeof input[key] !== "string" || !uuid.test(input[key])) throw invalid();
  }
  if (!["hold", "release", "set_cap", "remove_cap"].includes(String(input.action))) throw invalid();
  const revision = input.expected_revision;
  if (revision !== null && (typeof revision !== "number" || !Number.isSafeInteger(revision)
    || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)) throw invalid();
  if (input.action === "set_cap") {
    if (typeof input.cap !== "number" || !Number.isInteger(input.cap) || input.cap < 0
      || input.cap > 2147483647) throw invalid();
  } else if (Object.prototype.hasOwnProperty.call(input, "cap")) throw invalid();
  return { account_id: input.account_id as string, tenant_id: input.tenant_id as string,
    request_id: input.request_id as string, action: input.action as "hold" | "release" | "set_cap" | "remove_cap",
    expected_revision: revision as number | null,
    ...(input.action === "set_cap" ? { cap: input.cap as number } : {}) };
}

// actorId is derived from resolveInstagramDashboardActor, never from the body.
export async function mutateFleetPolicy(actorId: string, body: unknown) {
  if (!uuid.test(actorId)) throw new FleetPolicyMutationError("fleet_policy_actor_forbidden", 403);
  const input = parseFleetPolicyMutation(body);
  const { data, error } = await createSupabaseClient().rpc("fleet_mutate_policy_v1", {
    p_input: { ...input, actor_id: actorId },
  });
  if (error) {
    const codes: Record<string, number> = {
      service_role_required: 403, fleet_policy_actor_forbidden: 403,
      fleet_policy_binding_forbidden: 403, fleet_policy_input_invalid: 400,
      fleet_policy_replay_conflict: 409, fleet_policy_revision_conflict: 409,
    };
    if (Object.prototype.hasOwnProperty.call(codes, error.message)) {
      throw new FleetPolicyMutationError(error.message, codes[error.message]);
    }
    throw new FleetPolicyMutationError("fleet_policy_mutation_failed", 503);
  }
  if (!data || typeof data !== "object" || !data.receipt || typeof data.replayed !== "boolean") {
    throw new FleetPolicyMutationError("fleet_policy_response_invalid", 503);
  }
  return data;
}
