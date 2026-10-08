"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import type { ConsentChoice } from "@/lib/marketing/consent";
import styles from "./ConsentBanner.module.css";

const consentSnapshot = () => window.bmbConsentChoice || null;
const consentServerSnapshot = (): ConsentChoice | null => null;
const subscribeConsent = (callback: () => void) => { window.addEventListener("bmb:consent", callback); return () => window.removeEventListener("bmb:consent", callback); };
const languageSnapshot = () => document.documentElement.lang === "fr" ? "fr" : "en";
const subscribeLanguage = (callback: () => void) => { const observer = new MutationObserver(callback); observer.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] }); return () => observer.disconnect(); };

export default function ConsentBanner() {
  const choice = useSyncExternalStore(subscribeConsent, consentSnapshot, consentServerSnapshot);
  const lang = useSyncExternalStore(subscribeLanguage, languageSnapshot, () => "en");
  const [opened, setOpened] = useState(false);
  const [settings, setSettings] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [ads, setAds] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const fr = lang === "fr";
  const visible = opened || !choice;
  const save = (a: boolean, b: boolean) => {
    window.bmbSetConsent?.(a, b);
    setOpened(false); setSettings(false);
    requestAnimationFrame(() => launcher.current?.focus());
  };
  const customize = () => { setAnalytics(choice?.analytics || false); setAds(choice?.ads || false); setSettings(true); setOpened(true); };

  return <div className={styles.root}>
    <button ref={launcher} className={styles.launcher} onClick={customize} aria-expanded={visible} aria-controls="bmb-consent-panel">{fr ? "Confidentialité" : "Privacy choices"}</button>
    {visible && <section id="bmb-consent-panel" className={styles.panel} aria-labelledby="bmb-consent-title" onKeyDown={e => { if (e.key === "Escape" && choice) { setOpened(false); launcher.current?.focus(); } }}>
      <h2 id="bmb-consent-title">{fr ? "Vos choix de confidentialité" : "Your privacy choices"}</h2>
      <p>{fr ? "Avec votre accord, Google Analytics nous aide à comprendre l’usage du site. La publicité est un choix séparé. Sans accord, le stockage analytics et publicitaire reste refusé. Google peut recevoir des signaux sans cookies via le mode de consentement." : "With your permission, Google Analytics helps us understand site usage. Advertising is a separate choice. Without permission, analytics and advertising storage stay denied. Google may receive cookieless signals through consent mode."}</p>
      <a href="/privacy-policy">{fr ? "Politique de confidentialité" : "Privacy policy"}</a>
      {settings && <fieldset className={styles.settings}>
        <legend>{fr ? "Personnaliser le consentement" : "Customize consent"}</legend>
        <p>{fr ? "Nécessaires : toujours actifs, notamment pour mémoriser ce choix pendant 180 jours." : "Necessary: always active, including remembering this choice for 180 days."}</p>
        <label><input type="checkbox" checked={analytics} onChange={e => setAnalytics(e.target.checked)} /> <span>{fr ? "Mesure d’audience (Google Analytics)" : "Audience measurement (Google Analytics)"}</span></label>
        <label><input type="checkbox" checked={ads} onChange={e => setAds(e.target.checked)} /> <span>{fr ? "Publicité : stockage, données publicitaires et personnalisation" : "Advertising: storage, advertising data and personalization"}</span></label>
      </fieldset>}
      <div className={styles.actions}>
        <button onClick={() => save(false, false)}>{fr ? "Tout refuser" : "Reject all"}</button>
        {settings ? <button onClick={() => save(analytics, ads)}>{fr ? "Enregistrer mes choix" : "Save my choices"}</button> : <button onClick={customize}>{fr ? "Personnaliser" : "Customize"}</button>}
        <button onClick={() => save(true, true)}>{fr ? "Tout accepter" : "Accept all"}</button>
        {choice && <button onClick={() => { setOpened(false); launcher.current?.focus(); }}>{fr ? "Fermer sans modifier" : "Close without changes"}</button>}
      </div>
    </section>}
  </div>;
}
