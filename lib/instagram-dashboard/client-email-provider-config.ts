export type ClientEmailProviderName = "postmark";

export type ClientEmailProviderEnv = {
  provider: ClientEmailProviderName | null;
  sendingEnabled: boolean;
  postmarkServerTokenConfigured: boolean;
  postmarkWebhookAuthConfigured: boolean;
};

export type ClientEmailSendingGateResult =
  | { allowed: true }
  | {
    allowed: false;
    reason:
      | "sending_disabled"
      | "provider_not_configured"
      | "postmark_token_missing"
      | "invalid_from_email"
      | "invalid_recipient_email";
    message: string;
  };

function readBoolean(value: string | undefined, fallback = false) {
  if (value == null || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return fallback;
}

export function readClientEmailProviderEnv(
  env: Record<string, string | undefined> = process.env,
): ClientEmailProviderEnv {
  const providerRaw = env.CLIENT_EMAIL_PROVIDER?.trim().toLowerCase() ?? "";
  return {
    provider: providerRaw === "postmark" ? "postmark" : null,
    sendingEnabled: readBoolean(env.CLIENT_EMAIL_SENDING_ENABLED, false),
    postmarkServerTokenConfigured: Boolean(env.POSTMARK_SERVER_TOKEN?.trim()),
    postmarkWebhookAuthConfigured: Boolean(
      env.POSTMARK_WEBHOOK_USERNAME?.trim() && env.POSTMARK_WEBHOOK_PASSWORD?.trim(),
    ),
  };
}

export function evaluateClientEmailSendingGate(
  env: Record<string, string | undefined> = process.env,
): ClientEmailSendingGateResult {
  const config = readClientEmailProviderEnv(env);
  if (!config.sendingEnabled) {
    return {
      allowed: false,
      reason: "sending_disabled",
      message: "Client email sending is disabled by CLIENT_EMAIL_SENDING_ENABLED.",
    };
  }
  if (config.provider !== "postmark") {
    return {
      allowed: false,
      reason: "provider_not_configured",
      message: "CLIENT_EMAIL_PROVIDER must be set to postmark before sending.",
    };
  }
  if (!config.postmarkServerTokenConfigured) {
    return {
      allowed: false,
      reason: "postmark_token_missing",
      message: "POSTMARK_SERVER_TOKEN is not configured.",
    };
  }
  return { allowed: true };
}
