type RelayAuth =
  | { ok: true; mode: "relay_key" | "admin_session" }
  | { ok: false; reason: "relay_auth_required" | "relay_auth_invalid" | "relay_auth_unconfigured" };

type ResolveOperatorReviewActorInput = {
  relayKeyProvided: boolean;
  relayAuth: RelayAuth | null;
  relayOperatorId: unknown;
  adminUserId: string | null;
  adminAuthorized: boolean;
};

export type OperatorReviewActorResult =
  | { ok: true; actorId: string; mode: "relay_key" | "admin_session" }
  | { ok: false; status: 401 | 403 | 503; error: string; reason?: string };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value.trim());
}

export function resolveOperatorReviewActor(input: ResolveOperatorReviewActorInput): OperatorReviewActorResult {
  if (input.relayKeyProvided) {
    if (!input.relayAuth?.ok || input.relayAuth.mode !== "relay_key") {
      const reason = input.relayAuth && !input.relayAuth.ok ? input.relayAuth.reason : "relay_auth_required";
      return {
        ok: false,
        status: reason === "relay_auth_invalid" ? 403 : reason === "relay_auth_unconfigured" ? 503 : 401,
        error: "Operator review relay authentication failed.",
        reason,
      };
    }
    const actorId = typeof input.relayOperatorId === "string" ? input.relayOperatorId.trim().toLowerCase() : "";
    if (!isUuid(actorId)) {
      return { ok: false, status: 401, error: "Authenticated operator identity is required." };
    }
    return { ok: true, actorId, mode: "relay_key" };
  }

  if (!input.adminUserId) return { ok: false, status: 401, error: "Authentication required." };
  if (!input.adminAuthorized) {
    return { ok: false, status: 403, error: "You are not authorized to access the Instagram dashboard." };
  }
  return { ok: true, actorId: input.adminUserId, mode: "admin_session" };
}

export function isIdempotentlyResolvedOperatorReview(action: Record<string, unknown>) {
  return action.action_type === "operator_review_required"
    && action.status === "resolved"
    && action.blocking_campaign !== true;
}
