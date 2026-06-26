import { timingSafeEqual } from "node:crypto";

export type PostmarkWebhookAuthResult =
  | { ok: true }
  | { ok: false; reason: "auth_required" | "auth_invalid" | "auth_unconfigured" };

export function readPostmarkWebhookAuthEnv(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    username: env.POSTMARK_WEBHOOK_USERNAME?.trim() ?? "",
    password: env.POSTMARK_WEBHOOK_PASSWORD?.trim() ?? "",
  };
}

function safeEqual(expected: string, provided: string) {
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function parseBasicAuthHeader(authorizationHeader: string | null) {
  const authorization = authorizationHeader?.trim() ?? "";
  if (!authorization.toLowerCase().startsWith("basic ")) return null;
  const encoded = authorization.slice(6).trim();
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function verifyPostmarkWebhookBasicAuth(
  authorizationHeader: string | null,
  env: Record<string, string | undefined> = process.env,
): PostmarkWebhookAuthResult {
  const { username, password } = readPostmarkWebhookAuthEnv(env);
  if (!username || !password) {
    return { ok: false, reason: "auth_unconfigured" };
  }
  const provided = parseBasicAuthHeader(authorizationHeader);
  if (!provided) {
    return { ok: false, reason: "auth_required" };
  }
  if (!safeEqual(username, provided.username) || !safeEqual(password, provided.password)) {
    return { ok: false, reason: "auth_invalid" };
  }
  return { ok: true };
}

export function postmarkWebhookAuthStatus(reason: Exclude<PostmarkWebhookAuthResult, { ok: true }>["reason"]) {
  if (reason === "auth_required") return 401;
  if (reason === "auth_unconfigured") return 503;
  return 403;
}
