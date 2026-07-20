const INSTAGRAM_PASSWORD_RESET_PATH = "/instagram-reset-password";
const INSTAGRAM_PRODUCTION_ORIGIN = "https://www.boostmybusinesses.com";

function isLocalDevelopmentOrigin(origin: URL) {
  return origin.hostname === "localhost"
    || origin.hostname === "127.0.0.1"
    || origin.hostname === "[::1]";
}

export function buildInstagramPasswordResetRedirect(
  currentOrigin: string,
  nodeEnv = process.env.NODE_ENV,
) {
  const parsedOrigin = new URL(currentOrigin);

  if (nodeEnv === "development" && isLocalDevelopmentOrigin(parsedOrigin)) {
    return new URL(INSTAGRAM_PASSWORD_RESET_PATH, parsedOrigin.origin).toString();
  }

  return `${INSTAGRAM_PRODUCTION_ORIGIN}${INSTAGRAM_PASSWORD_RESET_PATH}`;
}

export function isPasswordRecoveryAuthEvent(event: string, hasSession: boolean) {
  return event === "PASSWORD_RECOVERY" && hasSession;
}
