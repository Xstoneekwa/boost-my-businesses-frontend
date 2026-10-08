import type { CommercialDiscoveryCity, CommercialDiscoveryCountry, CommercialDiscoverySubsegment } from "./discovery-contract";
import { FRANCE_BEAUTY_QUERY_TERMS } from "./market-config.ts";

const SUBSEGMENT_SEARCH_TERMS: Record<CommercialDiscoverySubsegment, readonly string[]> = {
  "Aesthetic Clinic": ["aesthetic clinic", "aesthetics clinic", "aesthetic centre"],
  "Skin Clinic": ["skin clinic", "skin care clinic", "dermal clinic"],
  "Med Spa": ["med spa", "medical aesthetics", "aesthetic medicine"],
  "Beauty Salon": ["beauty salon", "beauty studio", "beauty bar"],
  "Hair Salon": ["hair salon", "hair studio", "hairdresser"],
  "Hair Stylist": ["hair stylist", "hairstylist", "hairdresser"],
  "Nail Studio": ["nail studio", "nail salon", "nail technician"],
  "Lash Studio": ["lash studio", "lash salon", "lash technician"],
  "Brow Studio": ["brow studio", "brow bar", "brow artist"],
  "Laser Clinic": ["laser clinic", "laser hair removal", "aesthetic laser"],
  "Makeup Artist": ["makeup artist", "make-up artist", "bridal makeup"],
  "Wellness Studio": ["wellness studio", "wellness centre", "holistic wellness"],
};

const BROAD_SEARCH_TERMS = [
  "aesthetic clinic", "skin clinic", "med spa", "beauty salon", "hair salon", "nail lash brow studio",
] as const;

function queriesForTerm(term: string, city: CommercialDiscoveryCity, countryCode: CommercialDiscoveryCountry = city === "France" ? "FR" : "ZA") {
  const country = countryCode === "FR" ? "France" : "South Africa";
  return [
    `site:instagram.com/ "${term}" "${city}" ${country}`,
    `site:instagram.com/ "${term}" "${city}" ${country} booking`,
  ];
}

export function buildCommercialDiscoveryQueries(city: CommercialDiscoveryCity, subsegment?: CommercialDiscoverySubsegment, countryCode: CommercialDiscoveryCountry = city === "France" ? "FR" : "ZA") {
  if (city === "France") return FRANCE_BEAUTY_QUERY_TERMS.map((term) => `site:instagram.com/ "${term}" "France" ("rendez-vous" OR "réservation" OR "prestations")`);
  const terms = subsegment ? SUBSEGMENT_SEARCH_TERMS[subsegment] : BROAD_SEARCH_TERMS;
  const limit = subsegment ? 8 : 10;
  return [...new Set(terms.flatMap((term) => queriesForTerm(term, city, countryCode)))].slice(0, limit);
}
