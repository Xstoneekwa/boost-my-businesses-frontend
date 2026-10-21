import { jsonError, jsonOk, readJsonBody, resolveInstagramDashboardActor } from "../../_utils";
import { FleetPolicyMutationError, mutateFleetPolicy } from "@/lib/instagram-dashboard/fleet-policy-mutation";

export async function POST(request: Request) {
  const authorization = await resolveInstagramDashboardActor(request, "Fleet policy");
  if (!authorization.ok) return authorization.response;
  try {
    const result = await mutateFleetPolicy(authorization.actor.actorId, await readJsonBody(request));
    return jsonOk(result);
  } catch (error) {
    if (error instanceof FleetPolicyMutationError) return jsonError(error.code, error.status);
    return jsonError("fleet_policy_mutation_failed", 503);
  }
}
