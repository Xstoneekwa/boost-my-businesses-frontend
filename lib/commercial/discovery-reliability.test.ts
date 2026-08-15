import assert from "node:assert/strict";
import test from "node:test";
import { deterministicCommercialPrecheck, enrichCommercialWebsite, extractBookingEvidence, filterCommercialAudiences, resolveCommercialLocation } from "./discovery-reliability.ts";

test("precheck passes a proven local beauty business and rejects an agency before AI", () => {
  const location = resolveCommercialLocation({ requestedCity: "Johannesburg", signals: { provider: ["Hair salon Johannesburg"], instagram: ["Rosebank hair specialists"] } });
  assert.equal(location.confidence, "HIGH");
  assert.equal(deterministicCommercialPrecheck({ requestedCity: "Johannesburg", title: "Glow Hair Salon", biography: "Rosebank hair specialists", profileFound: true, isPrivate: false, location }).decision, "PRECHECK_PASS");
  assert.equal(deterministicCommercialPrecheck({ requestedCity: "Johannesburg", title: "Mashilo Digital Agency", biography: "Social media marketing", profileFound: true, isPrivate: false,
    location: resolveCommercialLocation({ requestedCity: "Johannesburg", signals: { provider: ["Johannesburg"] } }) }).decision, "PRECHECK_REJECT");
  assert.equal(deterministicCommercialPrecheck({ requestedCity: "Johannesburg", title: "Mashilo Digital Agency", biography: "Marketing for aesthetic clinic owners", profileFound: true, isPrivate: false,
    location: resolveCommercialLocation({ requestedCity: "Johannesburg", signals: { provider: ["Johannesburg"] } }) }).decision, "PRECHECK_REJECT");
});

test("one location source is medium and missing location remains ambiguous", () => {
  const medium = resolveCommercialLocation({ requestedCity: "Cape Town", signals: { instagram: ["Cape Town beauty clinic"] } });
  assert.equal(medium.confidence, "MEDIUM");
  const low = resolveCommercialLocation({ requestedCity: "Cape Town", signals: { instagram: ["Skin and beauty clinic"] } });
  assert.equal(low.confidence, "LOW");
  assert.equal(deterministicCommercialPrecheck({ requestedCity: "Cape Town", title: "Skin Clinic", profileFound: true, isPrivate: false, location: low }).decision, "PRECHECK_AMBIGUOUS");
});

test("website enrichment is bounded and extracts contact plus booking evidence", async () => {
  let calls = 0;
  const html = '<meta name="description" content="Aesthetic clinic in Sandton"><a href="/contact">Contact</a><a href="https://fresha.com/a/glow">Book Online</a> hello@glow.co.za +27 11 123 4567';
  const result = await enrichCommercialWebsite({ websiteUrl: "https://glow.co.za", maxPages: 3, fetchImpl: async () => { calls += 1; return new Response(html, { headers: { "content-type": "text/html" } }); } });
  assert.ok(calls <= 3); assert.equal(result.email, "hello@glow.co.za"); assert.equal(result.bookingProvider, "fresha"); assert.equal(result.bookingUrl, "https://fresha.com/a/glow");
});

test("booking extraction is provider-agnostic", () => {
  const result = extractBookingEvidence([{ title: "Appointments", url: "https://clinic.example/book-now" }]);
  assert.equal(result.bookingProvider, "website_booking"); assert.equal(result.bookingUrl, "https://clinic.example/book-now");
});

test("audience filter removes apps and agencies and keeps a local competitor", () => {
  const base = { profile_url: "https://instagram.com/example", source: "searchapi_google_serp", source_query: "beauty Johannesburg", confidence: "high" as const, location: "Johannesburg" };
  const result = filterCommercialAudiences([
    { ...base, name: "Book A Spot App", instagram_handle: "bookaspot_app", category: "Booking app platform", reason: "Booking platform used by salons in Johannesburg" },
    { ...base, name: "Glow Aesthetics", instagram_handle: "glowaesthetics", category: "Aesthetic Clinic", reason: "Direct aesthetic competitor in Sandton offering similar treatments" },
  ], "Johannesburg");
  assert.deepEqual(result.map((item) => item.instagram_handle), ["glowaesthetics"]); assert.ok(result[0].audience_relevance_score >= 0.72);
});
