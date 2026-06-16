import type { UserRole } from "@/lib/userContext";

export function instagramPostLoginPath(role: UserRole | string | null | undefined) {
  return role === "superadmin" ? "/instagram-dashboard" : "/instagram-client";
}
