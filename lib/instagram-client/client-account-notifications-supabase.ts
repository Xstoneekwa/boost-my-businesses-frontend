import type { createSupabaseClient } from "../supabase.ts";

/** Canonical Supabase client type for client account notification reads/writes. */
export type ClientAccountNotificationsSupabase = ReturnType<typeof createSupabaseClient>;
