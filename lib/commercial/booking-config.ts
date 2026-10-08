/** Server-resolved, shared FR/ZA event type. Never use a prospect's booking_url. */
export function commercialDemoBookingUrl(value = process.env.COMMERCIAL_DEMO_BOOKING_URL) {
  const raw = value?.trim() || "https://calendly.com/boostmybusinesses/discovertheassistant";
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "calendly.com" || url.username || url.password
      || url.hash || url.search || !/^\/[a-z0-9_-]+\/[a-z0-9_-]+\/?$/i.test(url.pathname)) {
    throw new Error("commercial_demo_booking_url_invalid");
  }
  return url.href.replace(/\/$/, "");
}
