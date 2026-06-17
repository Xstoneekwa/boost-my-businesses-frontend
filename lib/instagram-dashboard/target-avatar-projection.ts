import type { TargetSafeRow } from "../../app/instagram-dashboard/targets-data.ts";
import { safeInstagramPublicAvatarUrl } from "../instagram-public-profile-lookup.ts";

export type TargetAvatarProjection = {
  avatarUrl: string | null;
  avatarAvailable: boolean;
  avatarSource: string | null;
};

export function projectPersistedTargetAvatar(rawAvatarUrl: unknown): TargetAvatarProjection {
  const persisted = safeInstagramPublicAvatarUrl(typeof rawAvatarUrl === "string" ? rawAvatarUrl : "");
  return {
    avatarUrl: persisted,
    avatarAvailable: Boolean(persisted),
    avatarSource: persisted ? "ig_targets.avatar_url" : null,
  };
}

export function clientTargetAvatarProxyPath(accountId: string, targetId: string) {
  if (!accountId || !targetId) return null;
  return `/api/instagram-client/accounts/${encodeURIComponent(accountId)}/targets/${encodeURIComponent(targetId)}/avatar`;
}

export function projectTargetSafeRowAvatar(row: TargetSafeRow): TargetSafeRow & TargetAvatarProjection {
  const avatar = projectPersistedTargetAvatar(row.avatar_url);
  return {
    ...row,
    ...avatar,
  };
}

export function projectTargetSafeRowsAvatar(rows: TargetSafeRow[]) {
  return rows.map(projectTargetSafeRowAvatar);
}

export function isSearchApiProfileLookupConfigured() {
  const provider = (process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_PROVIDER ?? "disabled").trim().toLowerCase();
  const apiKey = process.env.INSTAGRAM_PUBLIC_PROFILE_LOOKUP_API_KEY?.trim() ?? "";
  if (provider === "mock" || provider === "http") return true;
  if (provider === "searchapi") return Boolean(apiKey);
  return false;
}
