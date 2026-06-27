import { evaluateClientEmailSendingGate, readClientEmailProviderEnv } from "./client-email-provider-config.ts";

function readBoolean(value: string | undefined, fallback = false) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

export type NeedsMoreTargetsEmailAutomationGateResult =
  | { allowed: true }
  | {
    allowed: false;
    reason:
      | "automation_disabled"
      | "client_sending_disabled"
      | "provider_not_configured"
      | "postmark_token_missing";
    message: string;
  };

export function readClientEmailNeedsMoreTargetsAutomationEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return readBoolean(env.CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED, false);
}

export function evaluateNeedsMoreTargetsEmailAutomationGate(
  env: Record<string, string | undefined> = process.env,
): NeedsMoreTargetsEmailAutomationGateResult {
  if (!readClientEmailNeedsMoreTargetsAutomationEnabled(env)) {
    return {
      allowed: false,
      reason: "automation_disabled",
      message: "Needs-more-targets email automation is disabled by CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED.",
    };
  }
  const clientGate = evaluateClientEmailSendingGate(env);
  if (!clientGate.allowed) {
    return {
      allowed: false,
      reason: "client_sending_disabled",
      message: clientGate.message,
    };
  }
  const provider = readClientEmailProviderEnv(env);
  if (provider.provider !== "postmark") {
    return {
      allowed: false,
      reason: "provider_not_configured",
      message: "CLIENT_EMAIL_PROVIDER must be postmark before lifecycle sends.",
    };
  }
  if (!provider.postmarkServerTokenConfigured) {
    return {
      allowed: false,
      reason: "postmark_token_missing",
      message: "POSTMARK_SERVER_TOKEN is not configured.",
    };
  }
  return { allowed: true };
}

export function canPersistNeedsMoreTargetsEmailAutomation(
  env: Record<string, string | undefined> = process.env,
) {
  return evaluateNeedsMoreTargetsEmailAutomationGate(env).allowed;
}
