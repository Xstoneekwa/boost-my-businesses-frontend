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

const FRANCE_SUBSEGMENT_TERMS: Record<CommercialDiscoverySubsegment, readonly string[]> = {
  "Aesthetic Clinic": ["clinique esthétique", "médecine esthétique", "centre esthétique"],
  "Skin Clinic": ["soins de la peau", "clinique dermatologique", "centre dermo-esthétique"],
  "Med Spa": ["médecine esthétique", "spa médical", "centre médico-esthétique"],
  "Beauty Salon": ["institut de beauté", "salon de beauté", "centre esthétique"],
  "Hair Salon": ["salon de coiffure", "coiffeur", "barbier"],
  "Hair Stylist": ["coiffeur", "coiffeuse", "coiffure"],
  "Nail Studio": ["onglerie", "prothésiste ongulaire", "nail studio"],
  "Lash Studio": ["extensions de cils", "technicienne cils", "lash studio"],
  "Brow Studio": ["sourcils", "brow studio", "microblading"],
  "Laser Clinic": ["épilation laser", "centre laser", "clinique laser"],
  "Makeup Artist": ["maquilleuse", "maquillage professionnel", "makeup artist"],
  "Wellness Studio": ["spa", "massage", "centre bien-être"],
};
const FRANCE_BROAD_TERMS = ["institut de beauté", "médecine esthétique", "salon de coiffure", "barbier", "onglerie", "extensions de cils", "sourcils", "spa", "maquilleuse", "épilation laser"];
function franceCityQueries(city: string, subsegment?: CommercialDiscoverySubsegment) {
  const locality = city.replace(/["\\\r\n]/g, " ").trim();
  const profileScope = '-inurl:/p/ -inurl:/reel/ -inurl:/explore/ -inurl:/policy/ -inurl:/privacy/';
  const base = (term: string) => `site:instagram.com/ "${term}" "${locality}" France ${profileScope}`;
  // Diversify the broad first wave instead of filling its cap from the first
  // English clinic/booking pair. Counts and all provider bounds are unchanged.
  return subsegment
    ? FRANCE_SUBSEGMENT_TERMS[subsegment].flatMap(term => [base(term), `${base(term)} ("rendez-vous" OR "réservation" OR "prestations")`]).slice(0, 8)
    : FRANCE_BROAD_TERMS.map(base);
}

function queriesForTerm(term: string, city: CommercialDiscoveryCity, countryCode: CommercialDiscoveryCountry = city === "France" ? "FR" : "ZA") {
  const country = countryCode === "FR" ? "France" : "South Africa";
  return [
    `site:instagram.com/ "${term}" "${city}" ${country}`,
    `site:instagram.com/ "${term}" "${city}" ${country} booking`,
  ];
}

export function buildCommercialDiscoveryQueries(city: CommercialDiscoveryCity, subsegment?: CommercialDiscoverySubsegment, countryCode: CommercialDiscoveryCountry = city === "France" ? "FR" : "ZA") {
  if (city === "France") return FRANCE_BEAUTY_QUERY_TERMS.map((term) => `site:instagram.com/ "${term}" "France" ("rendez-vous" OR "réservation" OR "prestations")`);
  if (countryCode === "FR") return franceCityQueries(city, subsegment);
  const terms = subsegment ? SUBSEGMENT_SEARCH_TERMS[subsegment] : BROAD_SEARCH_TERMS;
  const limit = subsegment ? 8 : 10;
  return [...new Set(terms.flatMap((term) => queriesForTerm(term, city, countryCode)))].slice(0, limit);
}
