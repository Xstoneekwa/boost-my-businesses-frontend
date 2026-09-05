// Public identifiers supplied by the owner. GA4 is configured ONLY in GTM.
export const GTM_CONTAINER_ID = "GTM-TW42V8MQ";
export const GA4_MEASUREMENT_ID = "G-BFWT2ZDXJ1";

// Owner authorized native Consent Mode v2 for this Preview candidate.
export const GTM_ENABLED = true;

export const GTM_HEAD_SCRIPT = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.id='bmb-gtm';j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_CONTAINER_ID}');`;

// Audited ownership: retain GA4 enhanced measurement instead of forwarding
// a second custom event for pageviews, form submits or outbound Calendly clicks.
export const CUSTOM_EVENT_ALLOWLIST = new Set([
  "bmb_cta_click", "bmb_view_plans", "bmb_checkout_start",
  "bmb_instagram_growth_click", "bmb_south_africa_click", "bmb_vertical_click",
]);

export function shouldForwardEvent(event: string, path: string): boolean {
  // Enhanced measurement in the parent cannot observe iframe outbound clicks.
  return CUSTOM_EVENT_ALLOWLIST.has(event) || (event === "bmb_book_call" && path === "/instagram-growth");
}
