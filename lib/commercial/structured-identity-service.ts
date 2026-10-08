import "server-only";
import { requireCommercialCrmAccess } from "@/lib/commercial/crm-access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/** Identity only: no discovery, enrichment, lead creation, approval or transport. */
export type StructuredIdentityInput = {
  provider: string;
  externalId: string;
  businessName: string;
  country: string;
  city?: string;
  address?: string;
  website?: string;
  instagramHandle?: string;
};

export async function getStructuredIdentityProviders() {
  await requireCommercialCrmAccess();
  const { data, error } = await createSupabaseAdminClient()
    .from("commercial_identity_providers")
    .select("provider_key,country,identity_mode,external_id_normalizer,external_id_case_sensitive,location_authority,source_policy")
    .order("provider_key");
  if (error) throw new Error("structured_identity_registry_unavailable");
  return data;
}

export async function preflightStructuredBusiness(input: StructuredIdentityInput) {
  const actor = await requireCommercialCrmAccess();
  const { data, error } = await createSupabaseAdminClient().rpc("preflight_structured_commercial_business_v1", {
    p_actor_user_id: actor.userId, p_provider: input.provider, p_external_id: input.externalId,
    p_business_name: input.businessName, p_address: input.address ?? null,
    p_website: input.website ?? null, p_instagram_handle: input.instagramHandle ?? null,
  });
  if (error) throw new Error("structured_identity_preflight_failed");
  return data;
}

export async function createStructuredBusiness(input: StructuredIdentityInput) {
  const actor = await requireCommercialCrmAccess();
  const { data, error } = await createSupabaseAdminClient().rpc("create_structured_commercial_business_v1", {
    p_actor_user_id: actor.userId, p_provider: input.provider, p_external_id: input.externalId,
    p_business_name: input.businessName, p_country: input.country, p_city: input.city ?? null,
    p_address: input.address ?? null, p_website: input.website ?? null,
    p_instagram_handle: input.instagramHandle ?? null,
  });
  if (error) throw new Error("structured_identity_create_failed");
  return data;
}
