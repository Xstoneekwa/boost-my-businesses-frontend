import type { SupabaseClient } from "@supabase/supabase-js";
import { countActiveStripeComponentPriceCatalogMappings } from "./stripe-component-price-resolver.ts";
import { readStripeTestConfig } from "./stripe-config.ts";

export type StripeTestReadiness = {
  stripeSdkAvailable: true;
  testModeConfigured: boolean;
  webhookConfigured: boolean;
  testCatalogMappingsCount: number;
  portalConfigurationAvailable: boolean;
  testCheckoutEnabled: boolean;
};

export async function getStripeTestReadiness(
  supabase: SupabaseClient,
  env: NodeJS.ProcessEnv = process.env,
): Promise<StripeTestReadiness> {
  let config: ReturnType<typeof readStripeTestConfig> = null;
  try {
    config = readStripeTestConfig(env);
  } catch {
    config = null;
  }

  const mappingsCount = config
    ? await countActiveStripeComponentPriceCatalogMappings(supabase, "test")
    : 0;

  return {
    stripeSdkAvailable: true,
    testModeConfigured: Boolean(config?.secretKey),
    webhookConfigured: Boolean(config?.webhookSecret),
    testCatalogMappingsCount: mappingsCount,
    portalConfigurationAvailable: Boolean(config?.billingPortalConfigurationId),
    testCheckoutEnabled: Boolean(config?.testCheckoutEnabled),
  };
}

export function isStripeTestFoundationReady(readiness: StripeTestReadiness) {
  return readiness.testModeConfigured
    && readiness.webhookConfigured
    && readiness.testCatalogMappingsCount > 0
    && readiness.testCheckoutEnabled;
}
