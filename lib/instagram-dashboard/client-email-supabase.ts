import type { createSupabaseClient } from "../supabase.ts";

export type ClientEmailSupabase = ReturnType<typeof createSupabaseClient>;
