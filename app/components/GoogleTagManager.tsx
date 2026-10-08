import { GTM_CONTAINER_ID, GTM_ENABLED, GTM_HEAD_SCRIPT } from "@/lib/marketing/gtm";
import { CONSENT_BOOTSTRAP } from "@/lib/marketing/consent";
import Script from "next/script";

export function GoogleTagManagerHead() {
  if (!GTM_ENABLED) return null;
  return <Script id="bmb-gtm-bootstrap" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: CONSENT_BOOTSTRAP + GTM_HEAD_SCRIPT }} />;
}

export function GoogleTagManagerNoScript() {
  if (!GTM_ENABLED) return null;
  // Static HTML cannot read a consent cookie. The local no-store gate prevents
  // the standard Google iframe from bypassing refused categories without JS.
  return <noscript><iframe title="Google Tag Manager" data-container-id={GTM_CONTAINER_ID} src="/analytics/gtm-noscript" height="0" width="0" style={{ display: "none", visibility: "hidden" }} /></noscript>;
}
