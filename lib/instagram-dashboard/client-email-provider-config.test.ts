import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateClientEmailSendingGate,
  readClientEmailProviderEnv,
} from "./client-email-provider-config.ts";

test("CLIENT_EMAIL_SENDING_ENABLED defaults to false", () => {
  const config = readClientEmailProviderEnv({});
  assert.equal(config.sendingEnabled, false);
});

test("sending gate blocks when CLIENT_EMAIL_SENDING_ENABLED is false", () => {
  const gate = evaluateClientEmailSendingGate({
    CLIENT_EMAIL_PROVIDER: "postmark",
    POSTMARK_SERVER_TOKEN: "configured-but-not-used",
    CLIENT_EMAIL_SENDING_ENABLED: "false",
  });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "sending_disabled");
});

test("sending gate requires postmark provider when enabled", () => {
  const gate = evaluateClientEmailSendingGate({
    CLIENT_EMAIL_SENDING_ENABLED: "true",
    POSTMARK_SERVER_TOKEN: "configured-but-not-used",
  });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "provider_not_configured");
});

test("sending gate requires token when enabled", () => {
  const gate = evaluateClientEmailSendingGate({
    CLIENT_EMAIL_PROVIDER: "postmark",
    CLIENT_EMAIL_SENDING_ENABLED: "true",
  });
  assert.equal(gate.allowed, false);
  if (gate.allowed) return;
  assert.equal(gate.reason, "postmark_token_missing");
});

test("webhook auth env is considered configured only when username and password exist", () => {
  const missing = readClientEmailProviderEnv({
    POSTMARK_WEBHOOK_USERNAME: "user",
  });
  assert.equal(missing.postmarkWebhookAuthConfigured, false);

  const configured = readClientEmailProviderEnv({
    POSTMARK_WEBHOOK_USERNAME: "user",
    POSTMARK_WEBHOOK_PASSWORD: "pass",
  });
  assert.equal(configured.postmarkWebhookAuthConfigured, true);
});
