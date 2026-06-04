import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  clearInstagramAuthCookies,
  writeInstagramAuthCookies,
} from "@/lib/instagram-auth/cookies";
import { resolveInstagramUserContextFromCookies } from "@/lib/instagram-auth/resolve-user-context";
import {
  createUserContextFromTenantUser,
  isUserRole,
  type TenantUserRow,
} from "@/lib/userContext";

export const dynamic = "force-dynamic";

type SessionRequest = {
  access_token?: unknown;
  refresh_token?: unknown;
};

type TenantUserRecord = {
  user_id?: unknown;
  tenant_id?: unknown;
  role?: unknown;
};

function normalizeTenantUser(row: TenantUserRecord): TenantUserRow | null {
  if (typeof row.user_id !== "string" || !isUserRole(row.role)) {
    return null;
  }

  return {
    user_id: row.user_id,
    tenant_id: typeof row.tenant_id === "string" && row.tenant_id.trim() ? row.tenant_id : null,
    role: row.role,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SessionRequest;
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : "";

    if (!accessToken || !refreshToken) {
      return NextResponse.json(
        { error: "Missing Supabase session tokens." },
        { status: 400 }
      );
    }

    const supabase = createSupabaseAdminClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);

    if (userError || !userData.user) {
      return NextResponse.json(
        { error: "Invalid Supabase session." },
        { status: 401 }
      );
    }

    const { data: tenantUser, error: tenantUserError } = await supabase
      .from("tenant_users")
      .select("user_id, tenant_id, role")
      .eq("user_id", userData.user.id)
      .maybeSingle<TenantUserRecord>();

    if (tenantUserError) {
      return NextResponse.json(
        { error: "Could not load Instagram dashboard access.", details: tenantUserError.message },
        { status: 500 }
      );
    }

    if (!tenantUser) {
      return NextResponse.json(
        { error: "This user does not have access to the Instagram Growth dashboard." },
        { status: 403 }
      );
    }

    const normalizedTenantUser = normalizeTenantUser(tenantUser);

    if (!normalizedTenantUser) {
      return NextResponse.json(
        { error: "Invalid role or tenant mapping for Instagram dashboard." },
        { status: 403 }
      );
    }

    const context = createUserContextFromTenantUser(normalizedTenantUser);
    await writeInstagramAuthCookies(accessToken, refreshToken);

    return NextResponse.json(
      { user: context },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Instagram auth session route failed.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  const context = await resolveInstagramUserContextFromCookies();

  if (!context) {
    return NextResponse.json(
      { error: "Instagram session expired or invalid." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { user: context },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}

export async function DELETE() {
  await clearInstagramAuthCookies();

  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
