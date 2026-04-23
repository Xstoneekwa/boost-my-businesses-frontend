export type UserRole = "superadmin" | "tenant";

export type UserContext = {
  role: UserRole;
  tenantId: string;
  userId: string;
};

export type TenantUserRow = {
  user_id: string;
  tenant_id: string | null;
  role: UserRole;
};

export const RESTAURANT_AUTH_ACCESS_COOKIE = "restaurant_auth_access_token";
export const RESTAURANT_AUTH_REFRESH_COOKIE = "restaurant_auth_refresh_token";

export function isUserRole(value: unknown): value is UserRole {
  return value === "superadmin" || value === "tenant";
}

export function createUserContextFromTenantUser(row: TenantUserRow): UserContext {
  if (!row.tenant_id && row.role === "tenant") {
    throw new Error("Tenant users must have a tenant_id.");
  }

  return {
    role: row.role,
    tenantId: row.tenant_id ?? "",
    userId: row.user_id,
  };
}
