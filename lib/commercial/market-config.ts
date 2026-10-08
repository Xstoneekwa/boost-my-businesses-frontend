/** Market configuration only. Scoring weights, priorities and routing are shared. */
export const COMMERCIAL_MARKETS = {
  ZA: { country: "South Africa", language: "en", timezone: "Africa/Johannesburg", vertical: "Beauty/Aesthetics", offer: "Instagram Growth", campaignCode: "BMB_ZA_BEAUTY_V1" },
  FR: { country: "France", language: "fr", timezone: "Europe/Paris", vertical: "Beauty/Aesthetics", offer: "Instagram Growth", campaignCode: "BMB_FR_BEAUTY_PORTABILITY_V1" },
} as const;

export const FRANCE_DISCOVERY_SCOPE = "France" as const;
export const FRANCE_CANARY_IDEMPOTENCY_KEY = "commercial-france-profile-first-v2-canary";
export function discoveryMarket(scope: string) { return scope === FRANCE_DISCOVERY_SCOPE ? COMMERCIAL_MARKETS.FR : COMMERCIAL_MARKETS.ZA; }

export const FRANCE_BEAUTY_QUERY_TERMS = [
  "clinique esthétique", "institut de beauté", "salon de coiffure", "coiffeur",
  "onglerie", "extensions de cils", "sourcils", "maquilleuse", "médecine esthétique", "soins de la peau",
] as const;
