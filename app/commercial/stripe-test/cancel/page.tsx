"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { publicCheckoutCopy } from "@/lib/commercial/public-checkout-copy";
import {
  resolvePublicCheckoutLang,
  type PublicCheckoutLang,
} from "@/lib/commercial/public-checkout-lang";

function StripeCheckoutCancelContent() {
  const searchParams = useSearchParams();
  const [lang, setLang] = useState<PublicCheckoutLang>("fr");

  useEffect(() => {
    setLang(resolvePublicCheckoutLang({ searchParam: searchParams.get("lang") }));
  }, [searchParams]);

  const copy = useMemo(() => ({
    title: publicCheckoutCopy(lang, "cancelTitle"),
    body: publicCheckoutCopy(lang, "cancelBody"),
    returnLabel: publicCheckoutCopy(lang, "cancelReturn"),
  }), [lang]);

  const pricingHref = lang === "en"
    ? "/instagram-growth?lang=en#pricing"
    : "/instagram-growth#pricing";

  return (
    <main style={{ minHeight: "100dvh", background: "#09090b", color: "#f5f5f4", padding: 32 }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28, marginBottom: 12 }}>{copy.title}</h1>
        <p style={{ lineHeight: 1.6, color: "#e7e5e4" }}>{copy.body}</p>
        <p style={{ marginTop: 20 }}>
          <Link href={pricingHref} style={{ color: "#93c5fd" }}>{copy.returnLabel}</Link>
        </p>
      </div>
    </main>
  );
}

export default function StripeCheckoutCancelPage() {
  return (
    <Suspense fallback={(
      <main style={{ minHeight: "100dvh", background: "#09090b", color: "#fff", padding: 32 }}>
        …
      </main>
    )}
    >
      <StripeCheckoutCancelContent />
    </Suspense>
  );
}
