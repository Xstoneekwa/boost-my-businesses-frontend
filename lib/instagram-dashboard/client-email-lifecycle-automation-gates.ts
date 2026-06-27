import { evaluateClientEmailSendingGate, readClientEmailProviderEnv } from "./client-email-provider-config.ts";
import { readClientEmailNeedsMoreTargetsAutomationEnabled } from "./client-email-needs-more-targets-automation-config.ts";
import { readClientEmailLifecycleAutomationEnabledAt } from "./client-email-lifecycle-contract.ts";

function readBoolean(value: string | undefined, fallback = false) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

export function readClientEmailLifecycleAutomationEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return readBoolean(env.CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED, false);
}

export function readClientEmailNeedsMoreTargetsAutomationEnabledAt(
  env: Record<string, string | undefined> = process.env,
): Date | null {
  const raw = env.CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT?.trim() ?? "";
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type ClientEmailMaterializeAutomationGateResult =
  | { allowed: true }
  | {
    allowed: false;
    reason: "automation_disabled" | "watermark_not_configured";
    message: string;
  };

export type ClientEmailLifecycleAutomationGateResult =
  | { allowed: true }
  | {
    allowed: false;
    reason:
      | "automation_disabled"
      | "watermark_not_configured"
      | "client_sending_disabled"
      | "provider_not_configured"
      | "postmark_token_missing";
    message: string;
  };

export function evaluateMaterializeLifecycleAutomationGate(
  env: Record<string, string | undefined> = process.env,
): ClientEmailMaterializeAutomationGateResult {
  if (!readClientEmailLifecycleAutomationEnabled(env)) {
    return {
      allowed: false,
      reason: "automation_disabled",
      message: "Lifecycle email automation is disabled by CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED.",
    };
  }
  if (!readClientEmailLifecycleAutomationEnabledAt(env)) {
    return {
      allowed: false,
      reason: "watermark_not_configured",
      message: "Lifecycle email automation watermark CLIENT_EMAIL_LIFECYCLE_AUTOMATION_ENABLED_AT is not configured.",
    };
  }
  return { allowed: true };
}

export function evaluateMaterializeNeedsMoreAutomationGate(
  env: Record<string, string | undefined> = process.env,
) {
  if (!readClientEmailNeedsMoreTargetsAutomationEnabled(env)) {
    return {
      allowed: false as const,
      reason: "automation_disabled" as const,
      message: "Needs-more-targets email automation is disabled by CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED.",
    };
  }
  if (!readClientEmailNeedsMoreTargetsAutomationEnabledAt(env)) {
    return {
      allowed: false as const,
      reason: "watermark_not_configured" as const,
      message: "Needs-more email automation watermark CLIENT_EMAIL_NEEDS_MORE_TARGETS_AUTOMATION_ENABLED_AT is not configured.",
    };
  }
  return { allowed: true as const };
}

export function evaluateClientEmailLifecycleAutomationGate(
  env: Record<string, string | undefined> = process.env,
): ClientEmailLifecycleAutomationGateResult {
  const materializeGate = evaluateMaterializeLifecycleAutomationGate(env);
  if (!materializeGate.allowed) {
    return materializeGate;
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
      message: "CLIENT_EMAIL_PROVIDER must be set to postmark before lifecycle sends.",
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

export function evaluateNeedsMoreTargetsOutboxGate(
  env: Record<string, string | undefined> = process.env,
) {
  const materializeGate = evaluateMaterializeNeedsMoreAutomationGate(env);
  if (!materializeGate.allowed) return materializeGate;

  const clientGate = evaluateClientEmailSendingGate(env);
  if (!clientGate.allowed) {
    return {
      allowed: false as const,
      reason: "client_sending_disabled" as const,
      message: clientGate.message,
    };
  }
  const provider = readClientEmailProviderEnv(env);
  if (provider.provider !== "postmark") {
    return {
      allowed: false as const,
      reason: "provider_not_configured" as const,
      message: "CLIENT_EMAIL_PROVIDER must be postmark before lifecycle dispatch.",
    };
  }
  if (!provider.postmarkServerTokenConfigured) {
    return {
      allowed: false as const,
      reason: "postmark_token_missing" as const,
      message: "POSTMARK_SERVER_TOKEN is not configured.",
    };
  }
  return { allowed: true as const };
}

export function isNeedsMoreSignalEligibleAfterWatermark(input: {
  createdAt: string | null;
  updatedAt: string | null;
  watermark: Date | null;
}) {
  if (!input.watermark || !input.createdAt) return false;
  const watermarkMs = input.watermark.getTime();
  const createdMs = new Date(input.createdAt).getTime();
  if (!Number.isNaN(createdMs) && createdMs >= watermarkMs) return true;
  if (!input.updatedAt) return false;
  const updatedMs = new Date(input.updatedAt).getTime();
  return !Number.isNaN(updatedMs) && updatedMs >= watermarkMs;
}
