"use client";

import { useCallback, useEffect, useState } from "react";

export function InstagramGrowthFrame() {
  const [source, setSource] = useState("/instagram-growth/index.html");

  useEffect(() => {
    const syncHash = () => setSource(`/instagram-growth/index.html${window.location.hash}`);
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const settleOnAnchor = useCallback((frame: HTMLIFrameElement) => {
    const anchor = window.location.hash.slice(1);
    if (!anchor) return;
    const scroll = () => frame.contentDocument?.getElementById(anchor)?.scrollIntoView({ block: "start" });
    requestAnimationFrame(() => requestAnimationFrame(scroll));
    window.setTimeout(scroll, 500);
  }, []);

  return (
    <iframe
      src={source}
      title="Instagram Growth – BoostMyBusinesses"
      onLoad={(event) => settleOnAnchor(event.currentTarget)}
      style={{ display: "block", width: "100%", height: "100dvh", border: "none" }}
    />
  );
}
