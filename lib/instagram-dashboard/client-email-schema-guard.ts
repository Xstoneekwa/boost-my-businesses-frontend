import type { ClientEmailSupabase } from "./client-email-supabase.ts";

export const CLIENT_EMAIL_TEMPLATES_TABLE = "client_email_templates";
export const CLIENT_EMAIL_SEND_INTENTS_TABLE = "client_email_send_intents";
export const CLIENT_EMAIL_DELIVERY_EVENTS_TABLE = "client_email_delivery_events";

const EMAIL_TABLE_NAMES = [
  CLIENT_EMAIL_TEMPLATES_TABLE,
  CLIENT_EMAIL_SEND_INTENTS_TABLE,
  CLIENT_EMAIL_DELIVERY_EVENTS_TABLE,
] as const;

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

export function isClientEmailInfrastructureTableMissingError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  const mentionsEmailTable = EMAIL_TABLE_NAMES.some((table) => message.includes(table));
  if (!mentionsEmailTable) return false;

  const code = readErrorCode(error);
  const schemaCacheMiss = message.includes("could not find the table") && message.includes("schema cache");
  const relationMissing = message.includes("relation") && message.includes("does not exist");
  const undefinedTable = code === "42P01" || code === "PGRST205";

  return schemaCacheMiss || relationMissing || undefinedTable;
}

export function emptyClientEmailFeatureProjection(featureAvailable: boolean) {
  return {
    featureAvailable,
    templates: [],
    history: {
      items: [],
      page: 1,
      pageSize: 25,
      totalCount: 0,
      totalPages: 0,
    },
  };
}

export async function probeClientEmailInfrastructure(
  supabase: ClientEmailSupabase,
): Promise<{ available: true } | { available: false }> {
  const { error } = await supabase
    .from(CLIENT_EMAIL_TEMPLATES_TABLE)
    .select("id")
    .limit(1);

  if (!error) return { available: true };
  if (isClientEmailInfrastructureTableMissingError(error)) return { available: false };
  throw new Error(readErrorMessage(error));
}

export function isClientEmailTestIntentSchemaMissingError(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  if (!message.includes("intent_kind")) return false;
  const code = readErrorCode(error);
  return message.includes("schema cache")
    || message.includes("does not exist")
    || code === "PGRST204"
    || code === "42703";
}

export async function probeClientEmailTestIntentSchema(
  supabase: ClientEmailSupabase,
): Promise<{ available: true } | { available: false }> {
  const { error } = await supabase
    .from(CLIENT_EMAIL_SEND_INTENTS_TABLE)
    .select("intent_kind,provider_message_id,last_error_redacted")
    .limit(1);

  if (!error) return { available: true };
  if (isClientEmailTestIntentSchemaMissingError(error)) return { available: false };
  if (isClientEmailInfrastructureTableMissingError(error)) return { available: false };
  throw new Error(readErrorMessage(error));
}
