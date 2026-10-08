import type { LocationResolution } from "./discovery-reliability.ts";

type Source = LocationResolution["evidence"][number]["source"];
type Signals = Partial<Record<Source, unknown[]>>;
const foreignCountry = /\b(?:Belgique|Belgium|Suisse|Switzerland|Canada|Québec|Quebec|Luxembourg|Maroc|Morocco|Tunisie|Algeria|Algérie|South Africa|USA|United States)\b|🇧🇪|🇨🇦|🇨🇭/iu;
const countryEnd = /(?:[,\s|·]+(?:France|FR)|\s*🇫🇷)\s*$/iu;
const cityWords = /^[\p{L}][\p{L}'’ -]{1,75}$/u;

function canonicalCity(value: string) {
  const city = value.normalize("NFKC").replace(/^[\s📍➖💈]+/u, "").trim();
  if (!cityWords.test(city) || /\b(?:institut|salon|made|fabriqué|produits|cosmétiques|beauté|formations?|soins|numéro|France)\b/iu.test(city.replace(/-en-france$/i, ""))) return null;
  return city.toLocaleLowerCase("fr").replace(/(^|[- '’])(\p{L})/gu, (_, separator, letter) => separator + letter.toLocaleUpperCase("fr"))
    .replace(/-(En|Sur|Sous|Les|Le|La|De|Du)-/g, (_, word) => "-" + word.toLowerCase() + "-");
}

/** Only explicit, observed location formats. No language/domain/hashtag geolocation. */
export function resolveFranceLocation(signals: Signals): LocationResolution {
  const evidence: LocationResolution["evidence"] = [];
  const postcodes = new Set<string>();
  for (const [source, values] of Object.entries(signals) as [Source, unknown[]][]) {
    for (const raw of values ?? []) {
      if (typeof raw !== "string") continue;
      // Preserve field and line boundaries: a France product claim must not prove another line's address.
      const normalized = raw.normalize("NFKC").slice(0, 3000);
      for (const fragment of normalized.split(/[\n\r;]+/)) {
        if (foreignCountry.test(fragment)) continue;
        let value = fragment.trim().replace(/\s+/g, " ");
        // Search profile titles sometimes append the handle.
        value = value.replace(/\s*\(@[^)]*\)\s*$/u, "");
        const postalAddress = value.match(/\b\d{5}\s+[\p{L}'’ -]+?[, ]+(?:France|FR)(?=\s|$)/iu);
        if (postalAddress) value = postalAddress[0];
        const country = countryEnd.exec(value);
        if (!country) continue;
        // A name ending in France is not an address (e.g. Environ Skin Care France).
        if (!postalAddress && !/[,|·]\s*(?:France|FR)$/iu.test(value) && !/🇫🇷$/.test(value)) continue;
        let location = value.slice(0, country.index).trim().replace(/[📍💈]+$/u, "").trim();
        const department = location.match(/\s+\((\d{2,3})\)$/);
        if (department) location = location.slice(0, department.index).trim();
        // Profile wording observed in the capture: "Institut de Beauté à Paris🇫🇷".
        if (/\b(?:institut|salon)\b.*\sà\s/iu.test(location)) location = location.split(/\sà\s/iu).at(-1)!;
        const postal = location.match(/\b((?:0[1-9]|[1-8]\d|9[0-8])\d{3})\s+(.+)$/u);
        const city = canonicalCity(postal ? postal[2] : location);
        if (!city) continue;
        if (postal) postcodes.add(postal[1]);
        evidence.push({
          source, value: fragment.trim().slice(0, 500), city,
          evidence_source: source, raw_evidence: fragment.trim().slice(0, 500),
          normalized_city: city, normalized_country: "FR",
          postal_code: postal?.[1] ?? null, region: null,
          confidence: "MEDIUM",
        });
      }
    }
  }
  const cities = new Set(evidence.map(e => e.city.toLocaleLowerCase("fr")));
  if (cities.size !== 1) return { country: null, city: null, postalCode: null, region: null, confidence: "LOW", confidenceScore: 0.25, evidence };
  const sources = new Set(evidence.map(e => e.source));
  if (sources.has("website")) sources.delete("structured_metadata");
  const high = sources.size >= 2 || evidence.some(e => e.source === "structured_metadata");
  const confidence = high ? "HIGH" : "MEDIUM";
  return { country: "FR", city: evidence[0].city, postalCode: postcodes.size === 1 ? [...postcodes][0] : null, region: null,
    confidence, confidenceScore: high ? 0.94 : 0.72, evidence: evidence.map(e => ({ ...e, confidence })) };
}

/** Identity-level training-only evidence; offering occasional training is not enough. */
export function franceNonLocalServiceReason(identity: string, biography: string, websiteDescription = "") {
  const normalized = (identity + "\n" + biography + "\n" + websiteDescription).normalize("NFKC");
  const localService = /\b(?:clientes?|patients?|prestations?|salon|institut|coiffeur|barber)\b/iu.test(normalized);
  if (!localService && (/\bcollège international\b/iu.test(identity) ||
      (/\bassociation de médecins\b/iu.test(websiteDescription) && /\bcompagnonnage et formations\b/iu.test(websiteDescription)) ||
      (/\bformations?\b/iu.test(biography) && /\b(?:qual iopi|qualiopi|inscriptions|cursus|médecins formés|infirmiers formés)\b/iu.test(biography)))) {
    return "fr_training_only_organization";
  }
  return null;
}
