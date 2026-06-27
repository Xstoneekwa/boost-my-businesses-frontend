import { normalizeCommunicationEmail } from "./client-communication-email.ts";
import { readClientEmailProviderEnv } from "./client-email-provider-config.ts";
import type { ResolvedTransactionalDeliverySettings } from "./client-email-delivery-settings.ts";

function readBoolean(value: string | undefined, fallback = false) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

export type ClientEmailTestEnv = {
  clientSendingEnabled: boolean;
  testSendingEnabled: boolean;
  testRecipient: string | null;
  testRecipientMasked: string | null;
  providerReady: boolean;
};

export type ClientEmailTestSendingGateResult =
  | { allowed: true; recipientEmail: string }
  | {
    allowed: false;
    reason:
      | "client_sending_must_stay_disabled"
      | "test_sending_disabled"
      | "test_recipient_missing"
      | "test_recipient_invalid"
      | "provider_not_configured"
      | "postmark_token_missing";
    message: string;
  };

export function maskEmailForDisplay(email: string | null | undefined) {
  const normalized = normalizeCommunicationEmail(email);
  if (!normalized) return null;
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return null;
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

export function readClientEmailTestEnv(
  env: Record<string, string | undefined> = process.env,
): ClientEmailTestEnv {
  const provider = readClientEmailProviderEnv(env);
  const testRecipientRaw = env.CLIENT_EMAIL_TEST_RECIPIENT?.trim() ?? "";
  const testRecipient = normalizeCommunicationEmail(testRecipientRaw);
  return {
    clientSendingEnabled: provider.sendingEnabled,
    testSendingEnabled: readBoolean(env.CLIENT_EMAIL_TEST_SENDING_ENABLED, false),
    testRecipient,
    testRecipientMasked: maskEmailForDisplay(testRecipient),
    providerReady: provider.provider === "postmark" && provider.postmarkServerTokenConfigured,
  };
}

export function evaluateClientEmailTestSendingGate(
  env: Record<string, string | undefined> = process.env,
): ClientEmailTestSendingGateResult {
  const config = readClientEmailTestEnv(env);
  if (config.clientSendingEnabled) {
    return {
      allowed: false,
      reason: "client_sending_must_stay_disabled",
      message: "CLIENT_EMAIL_SENDING_ENABLED must remain false while test delivery is used.",
    };
  }
  if (!config.testSendingEnabled) {
    return {
      allowed: false,
      reason: "test_sending_disabled",
      message: "Test delivery is disabled by CLIENT_EMAIL_TEST_SENDING_ENABLED.",
    };
  }
  if (!config.testRecipient) {
    return {
      allowed: false,
      reason: "test_recipient_missing",
      message: "CLIENT_EMAIL_TEST_RECIPIENT is not configured.",
    };
  }
  const provider = readClientEmailProviderEnv(env);
  if (provider.provider !== "postmark") {
    return {
      allowed: false,
      reason: "provider_not_configured",
      message: "CLIENT_EMAIL_PROVIDER must be postmark for test delivery.",
    };
  }
  if (!provider.postmarkServerTokenConfigured) {
    return {
      allowed: false,
      reason: "postmark_token_missing",
      message: "POSTMARK_SERVER_TOKEN is not configured.",
    };
  }
  return { allowed: true, recipientEmail: config.testRecipient };
}

export function rejectForbiddenTestDeliveryRecipientFields(body: Record<string, unknown>): string | null {
  const forbidden = [
    "recipient",
    "recipient_email",
    "to",
    "to_email",
    "email",
    "client_email",
    "contact_email",
    "client_id",
    "account_id",
  ];
  for (const field of forbidden) {
    if (field in body && body[field] != null && String(body[field]).trim() !== "") {
      return `Field ${field} is not allowed on test delivery requests.`;
    }
  }
  return null;
}

export function projectClientEmailTestDeliveryStatus(input: {
  env?: Record<string, string | undefined>;
  testSchemaReady: boolean;
  settings?: Pick<ResolvedTransactionalDeliverySettings, "activeFromEmail" | "supportEmail">;
}) {
  const env = input.env ?? process.env;
  const config = readClientEmailTestEnv(env);
  const gate = evaluateClientEmailTestSendingGate(env);
  const disabledReason = !input.testSchemaReady
    ? "Test intent schema migration is not applied yet."
    : gate.allowed
      ? null
      : gate.message;
  const activeFromEmail = input.settings?.activeFromEmail ?? "growth@boostmybusinesses.com";
  const supportEmail = input.settings?.supportEmail ?? "growth@boostmybusinesses.com";

  return {
    clientSendingEnabled: config.clientSendingEnabled,
    testSendingEnabled: config.testSendingEnabled,
    testRecipientConfigured: Boolean(config.testRecipient),
    testRecipientMasked: config.testRecipientMasked,
    providerReady: config.providerReady,
    testSchemaReady: input.testSchemaReady,
    canSendTest: gate.allowed && input.testSchemaReady,
    disabledReason,
    readinessLabel: gate.allowed && input.testSchemaReady
      ? "Ready for one controlled test"
      : disabledReason ?? "Test delivery prerequisites are not ready yet.",
    lockedFromEmail: activeFromEmail,
    supportEmail,
  };
}
