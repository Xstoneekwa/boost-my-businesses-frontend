import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

const PAGE_SIZE = 1000;
const APPLY_CONFIRMATION = "AUTH_LOCALE_BACKFILL";

function readLocale(value) {
  return value === "en" || value === "fr" ? value : null;
}

function readClientPreferredLanguage(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return readLocale(metadata.preferred_language);
}

export function planAuthLocaleBackfill(input) {
  const currentLocale = readLocale(input.currentLocale);
  if (currentLocale) {
    return { needsUpdate: false, locale: currentLocale, source: "existing_auth_metadata" };
  }

  const knownLocales = [...new Set(input.linkedClientLocales.map(readLocale).filter(Boolean))];
  if (knownLocales.length === 1) {
    return { needsUpdate: true, locale: knownLocales[0], source: "client_preferred_language" };
  }
  return { needsUpdate: true, locale: "fr", source: "temporary_fr_fallback" };
}

async function loadAllAuthUsers(supabase) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error("auth_user_list_failed");
    const batch = data.users ?? [];
    users.push(...batch);
    if (batch.length < PAGE_SIZE) return users;
  }
}

async function loadRows(supabase, table, columns) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}_list_failed`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

export async function runAuthLocaleBackfill(input) {
  const users = await loadAllAuthUsers(input.supabase);
  const clientUsers = await loadRows(input.supabase, "client_users", "auth_user_id,client_id");
  const clients = await loadRows(input.supabase, "clients", "id,metadata");
  const localeByClientId = new Map(
    clients.map((client) => [client.id, readClientPreferredLanguage(client.metadata)]),
  );

  const clientLocalesByAuthUserId = new Map();
  for (const link of clientUsers) {
    const locales = clientLocalesByAuthUserId.get(link.auth_user_id) ?? [];
    locales.push(localeByClientId.get(link.client_id) ?? null);
    clientLocalesByAuthUserId.set(link.auth_user_id, locales);
  }

  const planned = users.map((user) => ({
    user,
    decision: planAuthLocaleBackfill({
      currentLocale: user.user_metadata?.locale,
      linkedClientLocales: clientLocalesByAuthUserId.get(user.id) ?? [],
    }),
  }));
  const updates = planned.filter((entry) => entry.decision.needsUpdate);

  for (const entry of updates) {
    console.log(JSON.stringify({
      user_ref: entry.user.id.slice(0, 8),
      locale: entry.decision.locale,
      source: entry.decision.source,
      mode: input.apply ? "apply" : "dry_run",
    }));
    if (!input.apply) continue;

    const { error } = await input.supabase.auth.admin.updateUserById(entry.user.id, {
      user_metadata: {
        ...(entry.user.user_metadata ?? {}),
        locale: entry.decision.locale,
      },
    });
    if (error) throw new Error(`auth_locale_update_failed:${entry.user.id.slice(0, 8)}`);
  }

  return {
    usersScanned: users.length,
    usersAlreadyLocalized: planned.length - updates.length,
    usersPlannedForUpdate: updates.length,
    applied: input.apply,
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);
  if (apply && confirmation !== APPLY_CONFIRMATION) {
    throw new Error(`apply_requires_--confirm=${APPLY_CONFIRMATION}`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) throw new Error("server_supabase_credentials_required");

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const summary = await runAuthLocaleBackfill({ supabase, apply });
  console.log(JSON.stringify({ event: "auth_locale_backfill_complete", ...summary }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "auth_locale_backfill_failed");
    process.exitCode = 1;
  });
}
