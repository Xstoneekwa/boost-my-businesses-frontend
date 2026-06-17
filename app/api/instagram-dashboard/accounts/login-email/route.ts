import { createSupabaseClient } from "@/lib/supabase";
import {
  jsonError,
  jsonOk,
  readBoolean,
  readJsonBody,
  readString,
  requireInstagramAdmin,
  type SupabaseRecord,
} from "../../_utils";
import { verifyCompassRelayKey } from "../../compass/relay-auth";
import {
  parseLoginEmailInput,
  persistAccountLoginEmail,
} from "@/lib/instagram-dashboard/persist-account-login-email";
import { resolveAccountEmail } from "@/lib/instagram-dashboard/resolve-account-email";

export const dynamic = "force-dynamic";

type LoginEmailPayload = {
  account_id?: unknown;
  email?: unknown;
  login_email?: unknown;
  dry_run?: unknown;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function requireRelayOrAdmin(request: Request) {
  const relayAuth = verifyCompassRelayKey(request.headers);
  if (relayAuth.ok && relayAuth.mode === "relay_key") return { mode: "relay_key" as const };
  if (!relayAuth.ok && relayAuth.reason === "relay_auth_invalid") {
    return { mode: "unauthorized" as const, response: jsonError("Login email sync relay authentication failed.", 403, { reason: relayAuth.reason }) };
  }
  const unauthorizedResponse = await requireInstagramAdmin();
  if (unauthorizedResponse) return { mode: "unauthorized" as const, response: unauthorizedResponse };
  return { mode: "admin_session" as const };
}

async function loadAccountState(accountId: string) {
  const supabase = createSupabaseClient();
  const [{ data: account, error: accountError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase.from("ig_accounts").select("id,username,status,admin_lifecycle_status").eq("id", accountId).maybeSingle<SupabaseRecord>(),
    supabase.from("ig_account_settings").select("account_id,email").eq("account_id", accountId).maybeSingle<SupabaseRecord>(),
  ]);
  if (accountError) throw new Error("account_lookup_failed");
  if (!account?.id) throw new Error("account_not_found");
  if (settingsError) throw new Error("settings_lookup_failed");
  return { account, settings: settings ?? null };
}

export async function POST(request: Request) {
  try {
    const auth = await requireRelayOrAdmin(request);
    if (auth.mode === "unauthorized") return auth.response;

    const payload = (await readJsonBody<LoginEmailPayload>(request)) ?? {};
    const accountId = readString(payload.account_id, "").trim();
    const emailInput = readString(payload.email) || readString(payload.login_email);
    const dryRun = readBoolean(payload.dry_run, false);
    const parsed = parseLoginEmailInput(emailInput);

    if (!uuidPattern.test(accountId)) return jsonError("account_id_invalid", 400);
    if (!parsed.present) return jsonError("email_required", 400);
    if (parsed.invalid || !parsed.email) return jsonError("email_invalid", 400);

    const state = await loadAccountState(accountId);
    const status = readString(state.account.status, "").toLowerCase();
    const lifecycle = readString(state.account.admin_lifecycle_status, status).toLowerCase();
    if (["archived", "trashed", "cancelled", "canceled", "deleted"].includes(status) || ["archived", "trashed", "cancelled", "canceled", "deleted"].includes(lifecycle)) {
      return jsonError("account_inactive", 409);
    }

    const currentResolved = resolveAccountEmail({ accountSettings: state.settings });
    if (dryRun) {
      return jsonOk({
        account_id: accountId,
        username: readString(state.account.username, ""),
        email_status: "would_persist",
        email_source: "ig_account_settings",
        email_available_before: currentResolved.emailAvailable,
        dry_run: true,
      });
    }

    const result = await persistAccountLoginEmail(
      createSupabaseClient(),
      accountId,
      parsed.email,
      "settings_sync",
    );
    if (!result.ok) {
      return jsonError(result.code, result.code === "email_invalid" ? 400 : 500);
    }
    if (!result.emailPresent) {
      return jsonError("email_required", 400);
    }

    const resolved = resolveAccountEmail({
      accountSettings: { email: result.email },
    });

    return jsonOk({
      account_id: accountId,
      username: readString(state.account.username, ""),
      email_status: "persisted",
      email_source: resolved.emailSource,
      email_available: resolved.emailAvailable,
      password_status: "unchanged",
      credentials_status: "unchanged",
      assignment_status: "unchanged",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "login_email_sync_failed";
    if (message === "account_not_found") return jsonError(message, 404);
    return jsonError(message, 500);
  }
}
