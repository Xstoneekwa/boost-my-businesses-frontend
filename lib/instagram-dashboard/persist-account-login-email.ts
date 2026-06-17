import type { createSupabaseClient } from "@/lib/supabase";
import { defaultInstagramSettings } from "@/lib/instagram-dashboard/defaults";
import { normalizeSafeEmail } from "@/lib/instagram-dashboard/resolve-account-email";

type SupabaseClient = ReturnType<typeof createSupabaseClient>;
type SupabaseRecord = Record<string, unknown>;

export type AccountLoginEmailSource =
  | "client_add_account"
  | "admin_add_profile"
  | "credentials_submit"
  | "settings_sync";

export type PersistAccountLoginEmailResult =
  | {
      ok: true;
      email: string;
      emailPresent: true;
      source: AccountLoginEmailSource;
      updated: boolean;
    }
  | {
      ok: true;
      emailPresent: false;
      source: AccountLoginEmailSource;
      updated: false;
      skipped: "empty";
    }
  | {
      ok: false;
      code: "account_id_required" | "email_invalid" | "db_update_failed";
      source: AccountLoginEmailSource;
    };

function readString(value: unknown, fallback = "") {
  if (typeof value === "string") return value.trim() || fallback;
  return fallback;
}

export function parseLoginEmailInput(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { present: false as const, email: null as string | null };
  const normalized = normalizeSafeEmail(raw.toLowerCase());
  if (!normalized) return { present: true as const, email: null as string | null, invalid: true as const };
  return { present: true as const, email: normalized, invalid: false as const };
}

export async function persistAccountLoginEmail(
  supabase: SupabaseClient,
  accountId: string,
  emailInput: unknown,
  source: AccountLoginEmailSource,
): Promise<PersistAccountLoginEmailResult> {
  const normalizedAccountId = readString(accountId);
  if (!normalizedAccountId) {
    return { ok: false, code: "account_id_required", source };
  }

  const parsed = parseLoginEmailInput(emailInput);
  if (!parsed.present) {
    return { ok: true, emailPresent: false, source, updated: false, skipped: "empty" };
  }
  if (!parsed.email) {
    return { ok: false, code: "email_invalid", source };
  }

  const { data: existing, error: lookupError } = await supabase
    .from("ig_account_settings")
    .select("account_id")
    .eq("account_id", normalizedAccountId)
    .maybeSingle<SupabaseRecord>();

  if (lookupError) {
    return { ok: false, code: "db_update_failed", source };
  }

  if (!existing?.account_id) {
    const { data: account, error: accountError } = await supabase
      .from("ig_accounts")
      .select("username")
      .eq("id", normalizedAccountId)
      .maybeSingle<SupabaseRecord>();

    if (accountError || !account) {
      return { ok: false, code: "db_update_failed", source };
    }

    const { error: insertError } = await supabase.from("ig_account_settings").insert({
      ...defaultInstagramSettings,
      account_id: normalizedAccountId,
      username: readString(account.username),
      email: parsed.email,
      password: "",
    });

    if (insertError) {
      return { ok: false, code: "db_update_failed", source };
    }
  } else {
    const { error: updateError } = await supabase
      .from("ig_account_settings")
      .update({ email: parsed.email })
      .eq("account_id", normalizedAccountId);

    if (updateError) {
      return { ok: false, code: "db_update_failed", source };
    }
  }

  console.info("[account-login-email] persisted", {
    account_id: normalizedAccountId,
    email_present: true,
    source,
  });

  return {
    ok: true,
    email: parsed.email,
    emailPresent: true,
    source,
    updated: true,
  };
}
