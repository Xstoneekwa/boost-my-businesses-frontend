import { jsonError, jsonOk } from "@/app/api/instagram-dashboard/_utils";
import { createSupabaseClient } from "@/lib/supabase";
import { GET as getLegacyProfiles } from "../route";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function accountId(row: Row) {
  return text(row.accountId) || text(row.account_id) || text(row.id);
}

function liveJsonOk(data: Record<string, unknown>) {
  const response = jsonOk(data);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function GET(request: Request) {
  try {
    const legacyResponse = await getLegacyProfiles(request);
    if (!legacyResponse.ok) return legacyResponse;

    const legacyPayload = await legacyResponse.json() as Row;
    const activeProfiles = Array.isArray(legacyPayload.activeAccounts)
      ? legacyPayload.activeAccounts.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row))
      : [];
    const accountIds = activeProfiles.map(accountId).filter(Boolean);
    const identityByAccount = new Map<string, Row>();
    let identitySource = "not_requested";

    if (accountIds.length) {
      const identityResult = await createSupabaseClient()
        .from("client_instagram_accounts")
        .select("account_id,login_identity_proof_status,login_identity_profile_opened,login_identity_username_match,login_identity_verified_at,login_state_invalidation_reason")
        .in("account_id", accountIds)
        .limit(200);
      if (identityResult.error) {
        identitySource = "unavailable";
      } else {
        identitySource = "client_instagram_accounts";
        for (const row of (identityResult.data ?? []) as Row[]) {
          const id = text(row.account_id);
          if (id) identityByAccount.set(id, row);
        }
      }
    }

    const profiles = activeProfiles.map((profile) => {
      const identity = identityByAccount.get(accountId(profile));
      return {
        ...profile,
        loginIdentityProofStatus: identity ? identity.login_identity_proof_status ?? null : null,
        loginIdentityProfileOpened: identity ? identity.login_identity_profile_opened ?? null : null,
        loginIdentityUsernameMatch: identity ? identity.login_identity_username_match ?? null : null,
        loginIdentityVerifiedAt: identity ? identity.login_identity_verified_at ?? null : null,
        loginStateInvalidationReason: identity ? identity.login_state_invalidation_reason ?? null : null,
        identityProjectionSource: identity ? "client_instagram_accounts" : identitySource,
      };
    });

    return liveJsonOk({
      generated_at: new Date().toISOString(),
      profiles,
      removed_account_ids: [],
      archived_account_ids: [],
      query_count: accountIds.length ? 2 : 1,
      source: "profiles_live_c0d66a5_native_v1",
      projection_mode: "full_snapshot",
    });
  } catch {
    return jsonError("Could not load live Profiles projection.", 500);
  }
}
