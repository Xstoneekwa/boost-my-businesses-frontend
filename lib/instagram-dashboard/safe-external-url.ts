export function safeExternalImageUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const unsafeText = `${url.search} ${url.hash}`.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (["token", "secret", "authorization", "service_role", "supabase_vault://"].some((term) => unsafeText.includes(term))) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
