import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validatePublicCheckoutPassword } from "./checkout-password.ts";

const CHECKOUT_SIGNUP_CREDENTIAL_CIPHER = "aes-256-gcm";
const CHECKOUT_SIGNUP_CREDENTIAL_IV_BYTES = 12;
const CHECKOUT_SIGNUP_CREDENTIAL_KEY_SALT = "commercial-checkout-signup-credential-v1";
const CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY = "pending_signup_credential_ciphertext";

type Row = Record<string, unknown>;

function checkoutSignupCredentialSecret(env: NodeJS.ProcessEnv = process.env) {
  return env.CHECKOUT_SIGNUP_CREDENTIAL_SECRET?.trim()
    || env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    || "";
}

function deriveCheckoutSignupCredentialKey(secret: string) {
  return createHash("sha256")
    .update(`${CHECKOUT_SIGNUP_CREDENTIAL_KEY_SALT}:${secret}`, "utf8")
    .digest();
}

function sealCheckoutSignupCredentialPayload(payload: { password: string; checkoutSessionId: string; idempotencyKey: string }, secret: string) {
  const key = deriveCheckoutSignupCredentialKey(secret);
  const iv = randomBytes(CHECKOUT_SIGNUP_CREDENTIAL_IV_BYTES);
  const cipher = createCipheriv(CHECKOUT_SIGNUP_CREDENTIAL_CIPHER, key, iv);
  const plaintext = Buffer.from(JSON.stringify({
    v: 1,
    checkout_session_id: payload.checkoutSessionId,
    idempotency_key: payload.idempotencyKey,
    password: payload.password,
  }), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

function unsealCheckoutSignupCredentialPayload(token: string, secret: string): { password: string; checkoutSessionId: string; idempotencyKey: string } | null {
  const parts = token.trim().split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const ciphertext = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const key = deriveCheckoutSignupCredentialKey(secret);
    const decipher = createDecipheriv(CHECKOUT_SIGNUP_CREDENTIAL_CIPHER, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    const parsed = JSON.parse(plaintext) as {
      v?: number;
      checkout_session_id?: string;
      idempotency_key?: string;
      password?: string;
    };
    if (parsed.v !== 1) return null;
    if (typeof parsed.checkout_session_id !== "string" || !parsed.checkout_session_id.trim()) return null;
    if (typeof parsed.idempotency_key !== "string" || !parsed.idempotency_key.trim()) return null;
    if (typeof parsed.password !== "string" || !parsed.password) return null;
    return {
      password: parsed.password,
      checkoutSessionId: parsed.checkout_session_id.trim(),
      idempotencyKey: parsed.idempotency_key.trim(),
    };
  } catch {
    return null;
  }
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
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; ciphertext: string } | { ok: false; code: string; messageEn: string }> {
  const validation = validateStripeFirstPurchaseSignupPassword(input);
  if (!validation.ok) {
    return { ok: false, code: validation.code, messageEn: validation.messageEn };
  }
  const secret = checkoutSignupCredentialSecret(env);
  if (!secret) {
    return { ok: false, code: "checkout_credential_secret_missing", messageEn: "Checkout credential storage is unavailable." };
  }
  const ciphertext = sealCheckoutSignupCredentialPayload({
    password: input.password,
    checkoutSessionId: input.checkoutSessionId,
    idempotencyKey: input.idempotencyKey,
  }, secret);

  const { data: existing, error: readError } = await supabase
    .from("commercial_checkout_sessions")
    .select("id,metadata")
    .eq("id", input.checkoutSessionId)
    .maybeSingle<Row>();
  if (readError || !existing?.id) {
    return { ok: false, code: "checkout_storage_unavailable", messageEn: "Could not store checkout signup credential." };
  }

  const metadata = {
    ...(typeof existing.metadata === "object" && existing.metadata ? existing.metadata as Row : {}),
    [CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY]: ciphertext,
  };
  const { error: updateError } = await supabase
    .from("commercial_checkout_sessions")
    .update({ metadata })
    .eq("id", input.checkoutSessionId);
  if (updateError) {
    return { ok: false, code: "checkout_storage_unavailable", messageEn: "Could not store checkout signup credential." };
  }

  return { ok: true, ciphertext };
}

export async function loadCheckoutPendingSignupCredential(
  supabase: SupabaseClient,
  input: {
    checkoutSessionId: string;
    idempotencyKey: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; password: string } | { ok: false; code: string; messageEn: string }> {
  const secret = checkoutSignupCredentialSecret(env);
  if (!secret) {
    return { ok: false, code: "checkout_credential_secret_missing", messageEn: "Checkout credential storage is unavailable." };
  }

  const { data: existing, error: readError } = await supabase
    .from("commercial_checkout_sessions")
    .select("id,metadata")
    .eq("id", input.checkoutSessionId)
    .maybeSingle<Row>();
  if (readError || !existing?.id) {
    return { ok: false, code: "checkout_pending_credential_missing", messageEn: "Checkout signup credential was not found." };
  }

  const metadata = typeof existing.metadata === "object" && existing.metadata ? existing.metadata as Row : {};
  const token = typeof metadata[CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY] === "string"
    ? metadata[CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY]
    : "";
  if (!token) {
    return { ok: false, code: "checkout_pending_credential_missing", messageEn: "Checkout signup credential was not found." };
  }

  const payload = unsealCheckoutSignupCredentialPayload(token, secret);
  if (!payload || payload.checkoutSessionId !== input.checkoutSessionId || payload.idempotencyKey !== input.idempotencyKey) {
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
    .select("id,metadata")
    .eq("id", checkoutSessionId)
    .maybeSingle<Row>();
  if (readError || !existing?.id) return { ok: false as const };

  const metadata = typeof existing.metadata === "object" && existing.metadata ? existing.metadata as Row : {};
  if (!(CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY in metadata)) return { ok: true as const, cleared: false as const };

  const nextMetadata = { ...metadata };
  delete nextMetadata[CHECKOUT_SIGNUP_CREDENTIAL_METADATA_KEY];
  const { error: updateError } = await supabase
    .from("commercial_checkout_sessions")
    .update({ metadata: nextMetadata })
    .eq("id", checkoutSessionId);
  if (updateError) return { ok: false as const };
  return { ok: true as const, cleared: true as const };
}

export async function consumeCheckoutPendingSignupCredential(
  supabase: SupabaseClient,
  input: {
    checkoutSessionId: string;
    idempotencyKey: string;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true; password: string } | { ok: false; code: string; messageEn: string }> {
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

export function sealCheckoutPendingSignupCredentialForTests(input: {
  password: string;
  checkoutSessionId: string;
  idempotencyKey: string;
}, secret = "test-checkout-signup-secret") {
  return sealCheckoutSignupCredentialPayload(input, secret);
}

export function unsealCheckoutPendingSignupCredentialForTests(token: string, secret = "test-checkout-signup-secret") {
  return unsealCheckoutSignupCredentialPayload(token, secret);
}
