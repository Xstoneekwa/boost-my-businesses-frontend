import type { CommercialOutreachFact } from "./outreach-contract";

type Row = Record<string, unknown>;

function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
function value(value: unknown, max = 500) {
  return typeof value === "string"
    ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

function push(facts: CommercialOutreachFact[], key: string, raw: unknown, source: string, max = 500) {
  const factValue = value(raw, max);
  if (factValue && !facts.some((fact) => fact.key === key && fact.value === factValue)) facts.push({ key, value: factValue, source });
}

export function buildCommercialOutreachFactLedger(input: { lead: Row; business: Row }) {
  const facts: CommercialOutreachFact[] = [];
  const enrichment = row(input.business.enrichment_snapshot_safe);
  const instagram = row(enrichment.instagram);
  const metadata = row(instagram.metadata);

  push(facts, "business_name", input.business.business_name, "commercial_businesses.business_name", 160);
  push(facts, "city", input.lead.city_snapshot || input.business.city, "commercial_leads.city_snapshot", 120);
  push(facts, "subsegment", input.lead.subsegment_snapshot || input.business.subsegment, "commercial_leads.subsegment_snapshot", 120);
  push(facts, "instagram_handle", input.business.instagram_handle, "commercial_businesses.instagram_handle", 160);
  push(facts, "website", input.business.website, "commercial_businesses.website", 500);
  push(facts, "booking_url", input.business.booking_url, "commercial_businesses.booking_url", 500);
  push(facts, "booking_provider", input.business.booking_provider, "commercial_businesses.booking_provider", 160);
  push(facts, "instagram_profile_name", metadata.profile_name, "verified_instagram_profile", 160);
  push(facts, "instagram_category", instagram.official_category, "verified_instagram_profile", 160);
  push(facts, "instagram_bio", metadata.biography, "verified_instagram_profile", 350);

  return facts.slice(0, 12);
}
