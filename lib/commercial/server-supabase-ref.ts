export const ISOLATED_CHECKOUT_ALLOWED_REF = "nxntngkhkoynljcagmkq";

export function extractSupabaseProjectRefFromUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^https?:\/\/([^.]+)\./i);
  return match?.[1]?.toLowerCase() ?? null;
}

/** Server-only Supabase URL — never read NEXT_PUBLIC_* for security decisions. */
export function readServerSupabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return readString(env.SUPABASE_URL);
}

export function readServerSupabaseProjectRef(env: NodeJS.ProcessEnv = process.env) {
  const url = readServerSupabaseUrl(env);
  if (!url) return null;
  return extractSupabaseProjectRefFromUrl(url);
}

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}
