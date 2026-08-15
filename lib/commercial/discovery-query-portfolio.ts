import type { CommercialDiscoveryCity, CommercialDiscoverySubsegment } from "./discovery-contract";

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

function queriesForTerm(term: string, city: CommercialDiscoveryCity) {
  return [
    `site:instagram.com/ "${term}" "${city}" South Africa`,
    `site:instagram.com/ "${term}" "${city}" booking`,
  ];
}

export function buildCommercialDiscoveryQueries(city: CommercialDiscoveryCity, subsegment?: CommercialDiscoverySubsegment) {
  const terms = subsegment ? SUBSEGMENT_SEARCH_TERMS[subsegment] : BROAD_SEARCH_TERMS;
  const limit = subsegment ? 8 : 10;
  return [...new Set(terms.flatMap((term) => queriesForTerm(term, city)))].slice(0, limit);
}
