import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCheckoutEmail } from "./checkout-context.ts";
import { validatePublicCheckoutPassword } from "./checkout-password.ts";

const CHECKOUT_SIGNUP_CREDENTIAL_CIPHER = "aes-256-gcm";
const CHECKOUT_SIGNUP_CREDENTIAL_IV_BYTES = 12;
const CHECKOUT_SIGNUP_CREDENTIAL_KEY_SALT = "commercial-checkout-signup-credential-v2";
const CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY = "pending_signup_credential_ciphertext";
const CHECKOUT_SIGNUP_CREDENTIAL_EXPIRES_METADATA_KEY = "pending_signup_credential_expires_at";
const CHECKOUT_SIGNUP_CREDENTIAL_ENVELOPE_VERSION = 2;
const CHECKOUT_SIGNUP_CREDENTIAL_MIN_SECRET_LENGTH = 32;
const CHECKOUT_SIGNUP_CREDENTIAL_DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export const CHECKOUT_SIGNUP_CREDENTIAL_SECRET_DOC = [
  "Dedicated secret for sealing public checkout signup passwords before Stripe payment.",
  "Format: opaque random string, minimum 32 characters (256-bit entropy target).",
  "Recommended generation: `openssl rand -base64 32`.",
  "Required whenever STRIPE_TEST_CHECKOUT_ENABLED=true and public first-purchase checkout stores credentials.",
  "Never reuse SUPABASE_SERVICE_ROLE_KEY or any other operational secret.",
].join(" ");

type Row = Record<string, unknown>;

export type CheckoutSignupCredentialBinding = {
  checkoutSessionId: string;
  idempotencyKey: string;
  purchaserEmail: string;
  flowType: "first_purchase" | "additional_account";
  commercialMode: "full_cycle" | "outreach_only";
  expiresAtUnix: number;
};

const TERMINAL_CHECKOUT_SESSION_STATUSES = new Set([
  "checkout_paid",
  "checkout_activated_test",
  "checkout_expired",
  "checkout_failed",
  "checkout_cancelled",
]);

function readString(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

export function hashCheckoutSignupEmail(email: string) {
  const normalized = normalizeCheckoutEmail(email);
  return createHash("sha256").update(normalized).digest("hex");
}

export function isStripeTestCheckoutEnabled(env: NodeJS.ProcessEnv = process.env) {
  return ["1", "true", "yes", "on"].includes(String(env.STRIPE_TEST_CHECKOUT_ENABLED ?? "").trim().toLowerCase());
}

export function readCheckoutSignupCredentialSecret(env: NodeJS.ProcessEnv = process.env) {
  const secret = readString(env.CHECKOUT_SIGNUP_CREDENTIAL_SECRET);
  if (!secret) return null;
  if (secret.length < CHECKOUT_SIGNUP_CREDENTIAL_MIN_SECRET_LENGTH) return null;
  if (readString(env.SUPABASE_SERVICE_ROLE_KEY) && secret === readString(env.SUPABASE_SERVICE_ROLE_KEY)) {
    return null;
  }
  return secret;
}

export function requireCheckoutSignupCredentialSecret(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; secret: string } | { ok: false; code: string; messageEn: string } {
  if (!isStripeTestCheckoutEnabled(env)) {
    return { ok: false, code: "stripe_test_not_enabled", messageEn: "Stripe Test checkout is not enabled." };
  }
  const secret = readString(env.CHECKOUT_SIGNUP_CREDENTIAL_SECRET);
  if (!secret) {
    return {
      ok: false,
      code: "checkout_signup_credential_secret_missing",
      messageEn: "Checkout signup credential storage is not configured.",
    };
  }
  if (secret.length < CHECKOUT_SIGNUP_CREDENTIAL_MIN_SECRET_LENGTH) {
    return {
      ok: false,
      code: "checkout_signup_credential_secret_weak",
      messageEn: "Checkout signup credential storage is not configured.",
    };
  }
  if (readString(env.SUPABASE_SERVICE_ROLE_KEY) && secret === readString(env.SUPABASE_SERVICE_ROLE_KEY)) {
    return {
      ok: false,
      code: "checkout_signup_credential_secret_forbidden",
      messageEn: "Checkout signup credential storage is not configured.",
    };
  }
  return { ok: true, secret };
}

function deriveCheckoutSignupCredentialKey(secret: string) {
  return createHash("sha256")
    .update(`${CHECKOUT_SIGNUP_CREDENTIAL_KEY_SALT}:${secret}`, "utf8")
    .digest();
}

function buildCredentialAad(binding: CheckoutSignupCredentialBinding) {
  return Buffer.from(JSON.stringify({
    v: CHECKOUT_SIGNUP_CREDENTIAL_ENVELOPE_VERSION,
    checkout_session_id: binding.checkoutSessionId,
    idempotency_key: binding.idempotencyKey,
    email_hash: hashCheckoutSignupEmail(binding.purchaserEmail),
    flow_type: binding.flowType,
    commercial_mode: binding.commercialMode,
    exp: binding.expiresAtUnix,
  }), "utf8");
}

function resolveCredentialExpiryUnix(input: { expiresAtUnix?: number | null; nowMs?: number }) {
  const nowMs = input.nowMs ?? Date.now();
  const upperBound = nowMs + CHECKOUT_SIGNUP_CREDENTIAL_DEFAULT_TTL_MS;
  const candidate = Number(input.expiresAtUnix ?? 0);
  if (Number.isFinite(candidate) && candidate > 0) {
    return Math.min(Math.floor(candidate), Math.floor(upperBound / 1000));
  }
  return Math.floor(upperBound / 1000);
}

function sealCheckoutSignupCredentialPayload(binding: CheckoutSignupCredentialBinding, password: string, secret: string) {
  const key = deriveCheckoutSignupCredentialKey(secret);
  const iv = randomBytes(CHECKOUT_SIGNUP_CREDENTIAL_IV_BYTES);
  const aad = buildCredentialAad(binding);
  const cipher = createCipheriv(CHECKOUT_SIGNUP_CREDENTIAL_CIPHER, key, iv);
  cipher.setAAD(aad);
  const plaintext = Buffer.from(JSON.stringify({ password }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    token: [
      `v${CHECKOUT_SIGNUP_CREDENTIAL_ENVELOPE_VERSION}`,
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      tag.toString("base64url"),
    ].join("."),
    expiresAtUnix: binding.expiresAtUnix,
  };
}

function unsealCheckoutSignupCredentialPayload(
  token: string,
  binding: CheckoutSignupCredentialBinding,
  secret: string,
): { password: string } | null {
  const parts = token.trim().split(".");
  if (parts.length !== 4 || parts[0] !== `v${CHECKOUT_SIGNUP_CREDENTIAL_ENVELOPE_VERSION}`) return null;
  if (binding.expiresAtUnix <= Math.floor(Date.now() / 1000)) return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const key = deriveCheckoutSignupCredentialKey(secret);
    const decipher = createDecipheriv(CHECKOUT_SIGNUP_CREDENTIAL_CIPHER, key, iv);
    decipher.setAAD(buildCredentialAad(binding));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plaintext) as { password?: string };
    if (typeof parsed.password !== "string" || !parsed.password) return null;
    return { password: parsed.password };
  } catch {
    return null;
  }
}

function sessionBlocksCredentialLoad(row: Row) {
  const status = readString(row.status);
  if (TERMINAL_CHECKOUT_SESSION_STATUSES.has(status)) {
    return status === "checkout_paid" || status === "checkout_activated_test"
      ? "checkout_pending_credential_consumed"
      : "checkout_pending_credential_terminal";
  }
  return null;
}

function metadataExpiresAtUnix(metadata: Row) {
  const raw = readString(metadata[CHECKOUT_SIGNUP_CREDENTIAL_EXPIRES_METADATA_KEY]);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

export function validateStripeFirstPurchaseSignupPassword(input: {
  password?: string | null;
  passwordConfirmation?: string | null;
}) {
  return validatePublicCheckoutPassword({
    password: input.password ?? "",
    passwordConfirmation: input.passwordConfirmation ?? input.password ?? "",
  });
}

export async function storeCheckoutPendingSignupCredential(
  supabase: SupabaseClient,
  input: {
    checkoutSessionId: string;
    idempotencyKey: string;
    password: string;
    passwordConfirmation?: string | null;
    purchaserEmail: string;
    flowType: "first_purchase" | "additional_account";
    commercialMode: "full_cycle" | "outreach_only";
    expiresAtUnix?: number | null;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; ciphertext: string; expiresAtUnix: number } | { ok: false; code: string; messageEn: string }> {
  const validation = validateStripeFirstPurchaseSignupPassword(input);
  if (!validation.ok) {
    return { ok: false, code: validation.code, messageEn: validation.messageEn };
  }
  const secretResult = requireCheckoutSignupCredentialSecret(env);
  if (!secretResult.ok) {
    return secretResult;
  }

  const binding: CheckoutSignupCredentialBinding = {
    checkoutSessionId: input.checkoutSessionId,
    idempotencyKey: input.idempotencyKey,
    purchaserEmail: input.purchaserEmail,
    flowType: input.flowType,
    commercialMode: input.commercialMode,
    expiresAtUnix: resolveCredentialExpiryUnix({ expiresAtUnix: input.expiresAtUnix }),
  };
  const sealed = sealCheckoutSignupCredentialPayload(binding, input.password, secretResult.secret);

  const { data: existing, error: readError } = await supabase
    .from("commercial_checkout_sessions")
    .select("id,status,metadata")
    .eq("id", input.checkoutSessionId)
    .maybeSingle<Row>();
  if (readError || !existing?.id) {
    return { ok: false, code: "checkout_storage_unavailable", messageEn: "Could not store checkout signup credential." };
  }
  const blocked = sessionBlocksCredentialLoad(existing);
  if (blocked) {
    return { ok: false, code: blocked, messageEn: "Checkout signup credential is no longer available." };
  }

  const metadata = {
    ...(typeof existing.metadata === "object" && existing.metadata ? existing.metadata as Row : {}),
    [CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY]: sealed.token,
    [CHECKOUT_SIGNUP_CREDENTIAL_EXPIRES_METADATA_KEY]: new Date(sealed.expiresAtUnix * 1000).toISOString(),
  };
  const { error: updateError } = await supabase
    .from("commercial_checkout_sessions")
    .update({ metadata })
    .eq("id", input.checkoutSessionId);
  if (updateError) {
    return { ok: false, code: "checkout_storage_unavailable", messageEn: "Could not store checkout signup credential." };
  }

  return { ok: true, ciphertext: sealed.token, expiresAtUnix: sealed.expiresAtUnix };
}

export async function loadCheckoutPendingSignupCredential(
  supabase: SupabaseClient,
  input: {
    checkoutSessionId: string;
    idempotencyKey: string;
    purchaserEmail: string;
    flowType: "first_purchase" | "additional_account";
    commercialMode: "full_cycle" | "outreach_only";
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; password: string } | { ok: false; code: string; messageEn: string }> {
  const secretResult = requireCheckoutSignupCredentialSecret(env);
  if (!secretResult.ok) {
    return secretResult;
  }

  const { data: existing, error: readError } = await supabase
    .from("commercial_checkout_sessions")
    .select("id,status,purchaser_email,flow_type,commercial_mode,metadata")
    .eq("id", input.checkoutSessionId)
    .maybeSingle<Row>();
  if (readError || !existing?.id) {
    return { ok: false, code: "checkout_pending_credential_missing", messageEn: "Checkout signup credential was not found." };
  }

  const blocked = sessionBlocksCredentialLoad(existing);
  if (blocked) {
    return { ok: false, code: blocked, messageEn: "Checkout signup credential is no longer available." };
  }

  const metadata = typeof existing.metadata === "object" && existing.metadata ? existing.metadata as Row : {};
  const token = typeof metadata[CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY] === "string"
    ? metadata[CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY]
    : "";
  if (!token) {
    return { ok: false, code: "checkout_pending_credential_missing", messageEn: "Checkout signup credential was not found." };
  }

  const metadataExpiryUnix = metadataExpiresAtUnix(metadata);
  if (metadataExpiryUnix != null && metadataExpiryUnix <= Math.floor(Date.now() / 1000)) {
    return { ok: false, code: "checkout_pending_credential_expired", messageEn: "Checkout signup credential has expired." };
  }

  const sessionEmail = readString(existing.purchaser_email);
  const sessionFlowType = readString(existing.flow_type) === "additional_account" ? "additional_account" : "first_purchase";
  const sessionCommercialMode = readString(existing.commercial_mode) === "outreach_only" ? "outreach_only" : "full_cycle";
  if (
    sessionEmail.toLowerCase() !== normalizeCheckoutEmail(input.purchaserEmail)
    || sessionFlowType !== input.flowType
    || sessionCommercialMode !== input.commercialMode
    || readString(existing.id) !== input.checkoutSessionId
  ) {
    return { ok: false, code: "checkout_pending_credential_binding_mismatch", messageEn: "Checkout signup credential is invalid." };
  }

  const binding: CheckoutSignupCredentialBinding = {
    checkoutSessionId: input.checkoutSessionId,
    idempotencyKey: input.idempotencyKey,
    purchaserEmail: input.purchaserEmail,
    flowType: input.flowType,
    commercialMode: input.commercialMode,
    expiresAtUnix: metadataExpiryUnix ?? resolveCredentialExpiryUnix({}),
  };

  const payload = unsealCheckoutSignupCredentialPayload(token, binding, secretResult.secret);
  if (!payload) {
    return { ok: false, code: "checkout_pending_credential_invalid", messageEn: "Checkout signup credential is invalid." };
  }

  return { ok: true, password: payload.password };
}

export async function clearCheckoutPendingSignupCredential(
  supabase: SupabaseClient,
  checkoutSessionId: string,
) {
  const { data: existing, error: readError } = await supabase
    .from("commercial_checkout_sessions")
    .select("id,status,metadata")
    .eq("id", checkoutSessionId)
    .maybeSingle<Row>();
  if (readError || !existing?.id) return { ok: false as const };

  const metadata = typeof existing.metadata === "object" && existing.metadata ? existing.metadata as Row : {};
  const hasCredential = CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY in metadata
    || CHECKOUT_SIGNUP_CREDENTIAL_EXPIRES_METADATA_KEY in metadata;
  if (!hasCredential) return { ok: true as const, cleared: false as const };

  const nextMetadata = { ...metadata };
  delete nextMetadata[CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY];
  delete nextMetadata[CHECKOUT_SIGNUP_CREDENTIAL_EXPIRES_METADATA_KEY];
  const { error: updateError } = await supabase
    .from("commercial_checkout_sessions")
    .update({ metadata: nextMetadata })
    .eq("id", checkoutSessionId);
  if (updateError) return { ok: false as const };
  return { ok: true as const, cleared: true as const };
}

export async function clearCheckoutPendingSignupCredentialIdempotent(
  supabase: SupabaseClient,
  checkoutSessionId: string,
) {
  return clearCheckoutPendingSignupCredential(supabase, checkoutSessionId);
}

export async function consumeCheckoutPendingSignupCredential(
  supabase: SupabaseClient,
  input: Parameters<typeof loadCheckoutPendingSignupCredential>[1],
  env: NodeJS.ProcessEnv = process.env,
) {
  const loaded = await loadCheckoutPendingSignupCredential(supabase, input, env);
  if (!loaded.ok) return loaded;
  const cleared = await clearCheckoutPendingSignupCredential(supabase, input.checkoutSessionId);
  if (!cleared.ok) {
    return { ok: false, code: "checkout_storage_unavailable", messageEn: "Could not consume checkout signup credential." };
  }
  return loaded;
}

export function checkoutPendingSignupCredentialMetadataKey() {
  return CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY;
}

export function checkoutPendingSignupCredentialExpiresMetadataKey() {
  return CHECKOUT_SIGNUP_CREDENTIAL_EXPIRES_METADATA_KEY;
}

export function sealCheckoutPendingSignupCredentialForTests(input: {
  password: string;
  checkoutSessionId: string;
  idempotencyKey: string;
  purchaserEmail: string;
  flowType?: "first_purchase" | "additional_account";
  commercialMode?: "full_cycle" | "outreach_only";
  expiresAtUnix?: number;
}, secret = "test-checkout-signup-secret-32bytes-min!!") {
  const binding: CheckoutSignupCredentialBinding = {
    checkoutSessionId: input.checkoutSessionId,
    idempotencyKey: input.idempotencyKey,
    purchaserEmail: input.purchaserEmail,
    flowType: input.flowType ?? "first_purchase",
    commercialMode: input.commercialMode ?? "full_cycle",
    expiresAtUnix: resolveCredentialExpiryUnix({
      expiresAtUnix: input.expiresAtUnix,
      nowMs: Date.now(),
    }),
  };
  return sealCheckoutSignupCredentialPayload(binding, input.password, secret);
}

export function unsealCheckoutPendingSignupCredentialForTests(
  token: string,
  binding: CheckoutSignupCredentialBinding,
  secret = "test-checkout-signup-secret-32bytes-min!!",
) {
  return unsealCheckoutSignupCredentialPayload(token, binding, secret);
}

export function checkoutSignupCredentialSecretsEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
