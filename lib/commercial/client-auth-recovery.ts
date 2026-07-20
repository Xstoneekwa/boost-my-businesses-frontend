const ALLOWED_CLIENT_LOGIN_PATHS = new Set([
  "/instagram-login",
  "/restaurant-login",
]);

export function normalizeClientLoginReturnPath(value: string | null | undefined) {
  const candidate = value?.trim() ?? "";
  return ALLOWED_CLIENT_LOGIN_PATHS.has(candidate) ? candidate : "/restaurant-login";
}

export function buildClientPasswordResetRedirect(origin: string, returnTo: string | null | undefined) {
  const redirect = new URL("/restaurant-reset-password", origin);
  redirect.searchParams.set("returnTo", normalizeClientLoginReturnPath(returnTo));
  return redirect.toString();
}
