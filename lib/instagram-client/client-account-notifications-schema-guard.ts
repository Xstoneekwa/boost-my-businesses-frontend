import type { ClientAccountNotificationsSupabase } from "./client-account-notifications-supabase.ts";

export const CLIENT_ACCOUNT_NOTIFICATIONS_TABLE = "client_account_notifications";

type PostgrestLikeError = {
  message?: string;
  code?: string;
};

function readErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null) {
    const row = error as PostgrestLikeError;
    if (typeof row.message === "string") return row.message;
  }
  return String(error);
}

function readErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const code = (error as PostgrestLikeError).code;
  return typeof code === "string" ? code.toUpperCase() : "";
}

export function isClientAccountNotificationsTableMissingError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  if (!message.includes(CLIENT_ACCOUNT_NOTIFICATIONS_TABLE)) {
    return false;
  }

  const code = readErrorCode(error);
  const schemaCacheMiss = message.includes("could not find the table") && message.includes("schema cache");
  const relationMissing = message.includes("relation") && message.includes("does not exist");
  const undefinedTable = code === "42P01" || code === "PGRST205";

  return schemaCacheMiss || relationMissing || undefinedTable;
}

export function emptyClientAccountNotificationsProjection(featureAvailable: boolean) {
  return {
    featureAvailable,
    active: [],
    recentResolved: [],
    activeCount: 0,
    unreadActiveCount: 0,
  };
}

export async function probeClientAccountNotificationsTable(
  supabase: ClientAccountNotificationsSupabase,
): Promise<{ available: true } | { available: false }> {
  const { error } = await supabase
    .from(CLIENT_ACCOUNT_NOTIFICATIONS_TABLE)
    .select("id")
    .limit(1);

  if (!error) return { available: true };
  if (isClientAccountNotificationsTableMissingError(error)) return { available: false };
  throw new Error(readErrorMessage(error));
}
