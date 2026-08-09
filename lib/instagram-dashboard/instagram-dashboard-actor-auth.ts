import type { InstagramOnboardingActorContext } from "@/lib/instagram-onboarding/canonical-account-onboarding";

type RelayAuthResult =
  | { ok: true; mode: "relay_key" | "admin_session" }
  | { ok: false; reason: "relay_auth_required" | "relay_auth_invalid" | "relay_auth_unconfigured" };

export type InstagramDashboardActorAuthFailureReason =
  | "relay_auth_required"
  | "relay_auth_invalid"
  | "relay_auth_unconfigured"
  | "botapp_operator_identity_unconfigured"
  | "authentication_required"
  | "admin_access_denied";

export type InstagramDashboardActorAuthDependencies<TAdminContext> = {
  readRelayKey: (headers: Headers) => string;
  verifyRelayKey: (headers: Headers) => RelayAuthResult;
  readBotAppOperatorId: () => string;
  getAdminContext: () => Promise<TAdminContext | null>;
  readAdminUserId: (context: TAdminContext) => string;
  canAccessAdmin: (context: TAdminContext) => boolean;
};

export type InstagramDashboardActorAuthResult =
  | {
    ok: true;
    mode: "relay_key" | "admin_session";
    actor: InstagramOnboardingActorContext;
  }
  | {
    ok: false;
    status: 401 | 403 | 503;
    reason: InstagramDashboardActorAuthFailureReason;
  };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function relayFailureStatus(reason: "relay_auth_required" | "relay_auth_invalid" | "relay_auth_unconfigured") {
  if (reason === "relay_auth_unconfigured") return 503 as const;
  if (reason === "relay_auth_invalid") return 403 as const;
  return 401 as const;
}

export async function resolveInstagramDashboardActorAuth<TAdminContext>(
  headers: Headers,
  dependencies: InstagramDashboardActorAuthDependencies<TAdminContext>,
): Promise<InstagramDashboardActorAuthResult> {
  const suppliedRelayKey = dependencies.readRelayKey(headers);

  if (suppliedRelayKey) {
    const relayAuth = dependencies.verifyRelayKey(headers);
    if (!relayAuth.ok) {
      return {
        ok: false,
        status: relayFailureStatus(relayAuth.reason),
        reason: relayAuth.reason,
      };
    }
    if (relayAuth.mode !== "relay_key") {
      return { ok: false, status: 503, reason: "relay_auth_unconfigured" };
    }

    const operatorId = dependencies.readBotAppOperatorId().trim();
    if (!UUID_PATTERN.test(operatorId)) {
      return { ok: false, status: 503, reason: "botapp_operator_identity_unconfigured" };
    }

    return {
      ok: true,
      mode: "relay_key",
      actor: { actorType: "botapp_operator", actorId: operatorId, source: "botapp" },
    };
  }

  const adminContext = await dependencies.getAdminContext();
  if (!adminContext) {
    return { ok: false, status: 401, reason: "authentication_required" };
  }

  const adminUserId = dependencies.readAdminUserId(adminContext).trim();
  if (!adminUserId) {
    return { ok: false, status: 401, reason: "authentication_required" };
  }
  if (!dependencies.canAccessAdmin(adminContext)) {
    return { ok: false, status: 403, reason: "admin_access_denied" };
  }

  return {
    ok: true,
    mode: "admin_session",
    actor: { actorType: "admin", actorId: adminUserId, source: "admin_dashboard" },
  };
}
