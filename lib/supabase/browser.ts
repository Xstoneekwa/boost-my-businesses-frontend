"use client";

import { createClient } from "@supabase/supabase-js";

export function createSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const legacyAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const browserKey = publishableKey || legacyAnonKey;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }

  if (!browserKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set");
  }

  return createClient(supabaseUrl, browserKey);
}
