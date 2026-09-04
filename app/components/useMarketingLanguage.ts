"use client";

import { useEffect, useSyncExternalStore } from "react";

export type MarketingLanguage = "fr" | "en";
const EVENT = "bmb-language-change";
const LEGACY_KEY = "boost_ai_landing_lang_v1";
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(EVENT, callback);
  };
}
let memoryLanguage: MarketingLanguage = "en";
function snapshot(): MarketingLanguage {
  try {
    const value = localStorage.getItem("bmb_lang") ?? localStorage.getItem(LEGACY_KEY);
    return value === "fr" ? "fr" : "en";
  } catch { return memoryLanguage; }
}
export function useMarketingLanguage() {
  const lang = useSyncExternalStore(subscribe, snapshot, () => "en" as MarketingLanguage);
  function setLang(next: MarketingLanguage) {
    memoryLanguage = next;
    try {
      localStorage.setItem("bmb_lang", next);
      localStorage.setItem(LEGACY_KEY, next);
    } catch { /* The switch remains usable when browser storage is unavailable. */ }
    window.dispatchEvent(new Event(EVENT));
  }
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  return [lang, setLang] as const;
}
