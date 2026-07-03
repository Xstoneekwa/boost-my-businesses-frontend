"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function StripeTestSuccessContent() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id") || "";
  const [status, setStatus] = useState("Payment received. Confirming your account setup…");
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const poll = async () => {
      const response = await fetch(
        `/api/commercial/checkout/stripe/session-status?session_id=${encodeURIComponent(sessionId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json() as {
        ok?: boolean;
        data?: { commercial_status?: string; activated_at?: string | null; informational_only?: boolean };
      };
      if (cancelled) return;
      if (!payload.ok || !payload.data) {
        setStatus("Payment received. Confirming your account setup…");
        return;
      }
      if (payload.data.commercial_status === "checkout_paid") {
        setStatus("Payment confirmed. Your workspace activation is complete or in progress.");
        setDetail(payload.data.activated_at ? `Activated at ${payload.data.activated_at}` : null);
        return;
      }
      setStatus("Payment received. Confirming your account setup…");
      setDetail(`Current status: ${payload.data.commercial_status}`);
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [sessionId]);

  return (
    <main style={{ minHeight: "100dvh", background: "#09090b", color: "#f5f5f4", padding: 32 }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1>Stripe Test checkout</h1>
        <p>{status}</p>
        {detail ? <p style={{ color: "#a8a29e" }}>{detail}</p> : null}
        <p style={{ color: "#a8a29e", marginTop: 24 }}>
          This page is informational only. Activation is triggered exclusively by the signed Stripe webhook.
        </p>
      </div>
    </main>
  );
}

export default function StripeTestSuccessPage() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100dvh", background: "#09090b", color: "#fff", padding: 32 }}>Loading…</main>}>
      <StripeTestSuccessContent />
    </Suspense>
  );
}
