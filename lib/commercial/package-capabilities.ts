import { createSupabaseClient } from "../supabase.ts";

type SupabaseClient = ReturnType<typeof createSupabaseClient>;
type Row = Record<string, unknown>;

export type CommercialPackageCapabilities = {
  code: string;
  aiTargetingEnabled: boolean;
};

function normalizePackageCode(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Read product capabilities from the active commercial package catalogue.
 * Missing, inactive, or unreadable catalogue rows fail closed.
 */
export async function loadCommercialPackageCapabilities(
  supabase: SupabaseClient,
  packageCode: string | null | undefined,
): Promise<CommercialPackageCapabilities> {
  const code = normalizePackageCode(packageCode);
  if (!code) return { code: "", aiTargetingEnabled: false };

  const { data, error } = await supabase
    .from("commercial_packages")
    .select("code,active,ai_targeting_enabled")
    .eq("code", code)
    .eq("active", true)
    .limit(1)
    .maybeSingle<Row>();

  if (error || data?.active !== true || normalizePackageCode(String(data?.code ?? "")) !== code) {
    return { code, aiTargetingEnabled: false };
  }

  return {
    code,
    aiTargetingEnabled: data.ai_targeting_enabled === true,
  };
}
