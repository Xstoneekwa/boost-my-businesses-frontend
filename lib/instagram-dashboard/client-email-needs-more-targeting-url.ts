export function buildNeedsMoreTargetingDashboardUrl(
  accountId: string,
  baseUrl?: string,
): string {
  const normalizedAccountId = accountId.trim();
  const base = (baseUrl
    ?? process.env.NEXT_PUBLIC_APP_URL
    ?? "https://www.boostmybusinesses.com").replace(/\/$/, "");
  if (!normalizedAccountId) {
    return `${base}/instagram-client?view=targeting`;
  }
  return `${base}/instagram-client?view=targeting&account=${encodeURIComponent(normalizedAccountId)}`;
}
