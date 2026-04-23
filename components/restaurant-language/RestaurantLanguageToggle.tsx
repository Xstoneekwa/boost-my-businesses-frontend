"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  isRestaurantLang,
  RESTAURANT_LANG_COOKIE,
  RESTAURANT_LANG_KEY,
  type RestaurantLang,
} from "@/lib/restaurant-language";

type RestaurantLanguageToggleProps = {
  lang?: RestaurantLang;
  onLangChange?: (lang: RestaurantLang) => void;
};

const RESTAURANT_LANG_EVENT = "restaurant-language-change";

export function persistRestaurantLang(lang: RestaurantLang) {
  localStorage.setItem(RESTAURANT_LANG_KEY, lang);
  document.cookie = `${RESTAURANT_LANG_COOKIE}=${lang}; path=/; max-age=31536000; SameSite=Lax`;
}

export function useRestaurantLanguage(defaultLang: RestaurantLang = "en") {
  const getSnapshot = useCallback(() => {
    const saved = localStorage.getItem(RESTAURANT_LANG_KEY);
    return isRestaurantLang(saved) ? saved : defaultLang;
  }, [defaultLang]);

  const getServerSnapshot = useCallback(() => defaultLang, [defaultLang]);

  const subscribe = useCallback((onStoreChange: () => void) => {
    window.addEventListener(RESTAURANT_LANG_EVENT, onStoreChange);
    window.addEventListener("storage", onStoreChange);

    return () => {
      window.removeEventListener(RESTAURANT_LANG_EVENT, onStoreChange);
      window.removeEventListener("storage", onStoreChange);
    };
  }, []);

  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setLang = useCallback((nextLang: RestaurantLang) => {
    persistRestaurantLang(nextLang);
    window.dispatchEvent(new Event(RESTAURANT_LANG_EVENT));
  }, []);

  return [lang, setLang] as const;
}

export default function RestaurantLanguageToggle({ lang, onLangChange }: RestaurantLanguageToggleProps) {
  const [internalLang, setInternalLang] = useRestaurantLanguage(lang ?? "en");
  const activeLang = lang ?? internalLang;

  function updateLang(nextLang: RestaurantLang) {
    setInternalLang(nextLang);
    onLangChange?.(nextLang);
  }

  return (
    <div style={{ display: "inline-flex", border: "1px solid rgba(245,158,11,0.24)", borderRadius: 999, padding: 3, background: "rgba(255,255,255,0.035)" }}>
      {(["fr", "en"] as RestaurantLang[]).map((item) => {
        const active = item === activeLang;

        return (
          <button
            key={item}
            type="button"
            onClick={() => updateLang(item)}
            style={{
              border: "none",
              background: active ? "#F59E0B" : "transparent",
              color: active ? "#160b02" : "rgba(255,255,255,0.68)",
              borderRadius: 999,
              padding: "7px 10px",
              font: "inherit",
              fontSize: 11,
              fontWeight: 900,
              cursor: "pointer",
              minWidth: 36,
            }}
          >
            {item.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
