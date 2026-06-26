import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isServerCredentialsConfigured,
  resolveServerCredentialsConfig,
} from "./server-credentials-config.ts";
import { clientSafeProcessErrorMessage } from "../instagram-client/client-account-process-projection.ts";

const ENV_KEYS = [
  "INSTAGRAM_CREDENTIALS_API_URL",
  "INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN",
  "INSTAGRAM_CREDENTIALS_API_TOKEN",
];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("resolveServerCredentialsConfig returns shared config when url and internal token are set", () => {
  const previous = snapshotEnv();
  try {
    process.env.INSTAGRAM_CREDENTIALS_API_URL = "https://example.test/functions/v1/instagram-credentials";
    process.env.INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN = "internal-token-for-tests";
    delete process.env.INSTAGRAM_CREDENTIALS_API_TOKEN;

    const config = resolveServerCredentialsConfig();
    assert.deepEqual(config, {
      url: "https://example.test/functions/v1/instagram-credentials",
      token: "internal-token-for-tests",
    });
    assert.equal(isServerCredentialsConfigured(), true);
  } finally {
    restoreEnv(previous);
  }
});

test("resolveServerCredentialsConfig ignores legacy API token env name", () => {
  const previous = snapshotEnv();
  try {
    process.env.INSTAGRAM_CREDENTIALS_API_URL = "https://example.test/functions/v1/instagram-credentials";
    process.env.INSTAGRAM_CREDENTIALS_API_TOKEN = "legacy-only-token";
    delete process.env.INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN;

    assert.equal(resolveServerCredentialsConfig(), null);
    assert.equal(isServerCredentialsConfigured(), false);
  } finally {
    restoreEnv(previous);
  }
});

test("resolveServerCredentialsConfig returns null when internal token is absent", () => {
  const previous = snapshotEnv();
  try {
    process.env.INSTAGRAM_CREDENTIALS_API_URL = "https://example.test/functions/v1/instagram-credentials";
    delete process.env.INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN;
    delete process.env.INSTAGRAM_CREDENTIALS_API_TOKEN;

    assert.equal(resolveServerCredentialsConfig(), null);
    assert.equal(isServerCredentialsConfigured(), false);
    const message = clientSafeProcessErrorMessage("fr", "credentials_unavailable", "Credential setup is temporarily unavailable.");
    assert.match(message, /temporairement indisponible/i);
  } finally {
    restoreEnv(previous);
  }
});

test("shared credentials config is imported by client and admin flows", () => {
  const helperSource = source("./server-credentials-config.ts");
  const clientSource = source("../instagram-client/create-account.ts");
  const adminCreateSource = source("../../app/api/instagram-dashboard/accounts/create/route.ts");
  const credentialsSubmitSource = source("../../app/api/instagram-dashboard/credentials/submit/route.ts");

  assert.match(helperSource, /INSTAGRAM_CREDENTIALS_API_URL/);
  assert.match(helperSource, /INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN/);
  assert.doesNotMatch(helperSource, /INSTAGRAM_CREDENTIALS_API_TOKEN/);
  assert.doesNotMatch(helperSource, /NEXT_PUBLIC_/);

  assert.match(clientSource, /resolveServerCredentialsConfig/);
  assert.match(clientSource, /credentials_unavailable/);
  assert.doesNotMatch(clientSource, /INSTAGRAM_CREDENTIALS_API_TOKEN/);
  assert.doesNotMatch(clientSource, /function credentialsConfig/);

  assert.match(adminCreateSource, /resolveServerCredentialsConfig/);
  assert.doesNotMatch(adminCreateSource, /function credentialsConfig/);
  assert.doesNotMatch(adminCreateSource, /INSTAGRAM_CREDENTIALS_API_TOKEN/);

  assert.match(credentialsSubmitSource, /resolveServerCredentialsConfig/);
  assert.doesNotMatch(credentialsSubmitSource, /function credentialsConfig/);
});

test("credentials helper and client-safe errors never expose token values", () => {
  const helperSource = source("./server-credentials-config.ts");
  const projectionSource = source("../instagram-client/client-account-process-projection.ts");
  const testSource = source("./server-credentials-config.test.mjs");

  for (const blob of [helperSource, projectionSource, testSource]) {
    assert.doesNotMatch(blob, /console\.(log|info|warn|error)\([\s\S]*token/i);
    assert.doesNotMatch(blob, /Authorization:\s*`Bearer \$\{config\.token\}`[\s\S]*jsonError/);
  }

  const message = clientSafeProcessErrorMessage("fr", "credentials_unavailable", "Credential setup is temporarily unavailable.");
  assert.doesNotMatch(message, /token|vault|internal|bearer|secret/i);
});
