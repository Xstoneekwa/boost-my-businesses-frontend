export const INITIAL_CHECKOUT_ALLOWED_SUPABASE_URL = "https://nxntngkhkoynljcagmkq.supabase.co";

export const INITIAL_CHECKOUT_TEST_ENV = {
  SUPABASE_URL: INITIAL_CHECKOUT_ALLOWED_SUPABASE_URL,
  SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM: "isolated-test-only",
  SIMULATED_CHECKOUT_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
} as const;

export function withInitialCheckoutAllowlist(emails: string[]) {
  return {
    ...INITIAL_CHECKOUT_TEST_ENV,
    SIMULATED_CHECKOUT_EMAIL_ALLOWLIST: emails.join(", "),
  };
}
