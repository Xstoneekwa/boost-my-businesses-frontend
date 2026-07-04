"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { publicCheckoutCopy } from "@/lib/commercial/public-checkout-copy";
import {
  publicCheckoutLoginPath,
  resolvePublicCheckoutLang,
  type PublicCheckoutLang,
} from "@/lib/commercial/public-checkout-lang";

const POLL_INTERVAL_MS = 4000;
const SLOW_CONFIRMATION_MS = 45000;
const REDIRECT_DELAY_MS = 1200;

type PollState = "waiting" | "ready" | "slow";

type SessionStatusPayload = {
  ok?: boolean;
  data?: {
    commercial_status?: string;
    activated_at?: string | null;
    ready_for_login?: boolean;
    login_path?: string | null;
  };
};

async function fetchSessionStatus(sessionId: string) {
  const response = await fetch(
    `/api/commercial/checkout/stripe/session-status?session_id=${encodeURIComponent(sessionId)}`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    return { ok: false as const, status: response.status };
  }
  const payload = await response.json() as SessionStatusPayload;
  return { ok: true as const, payload };
}

function CheckoutSuccessShell({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <main style={{ minHeight: "100dvh", background: "#09090b", color: "#f5f5f4", padding: 32 }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: 28, marginBottom: 12 }}>{title}</h1>
        <p style={{ lineHeight: 1.6, color: "#e7e5e4" }}>{body}</p>
        {children}
      </div>
    </main>
  );
}

function StripeCheckoutSuccessContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id") || "";
  const [lang, setLang] = useState<PublicCheckoutLang>("fr");
  const [pollState, setPollState] = useState<PollState>("waiting");
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setLang(resolvePublicCheckoutLang({ searchParam: searchParams.get("lang") }));
  }, [searchParams]);

  const copy = useMemo(() => ({
    title: publicCheckoutCopy(lang, "successTitle"),
    waiting: publicCheckoutCopy(lang, "successWaiting"),
    ready: publicCheckoutCopy(lang, "successReady"),
    pending: publicCheckoutCopy(lang, "successPending"),
    retry: publicCheckoutCopy(lang, "retryCheck"),
  }), [lang]);

  const loginPath = useMemo(() => publicCheckoutLoginPath(lang), [lang]);

  const checkStatus = useCallback(async () => {
    if (!sessionId) return false;
    const result = await fetchSessionStatus(sessionId);
    if (!result.ok) return false;
    const data = result.payload.data;
    if (data?.ready_for_login) {
      setPollState("ready");
      return true;
    }
    return false;
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    let slowTimer: number | undefined;
    let redirectTimer: number | undefined;

    const startPolling = () => {
      slowTimer = window.setTimeout(() => {
        if (!cancelled) setPollState((current) => (current === "ready" ? current : "slow"));
      }, SLOW_CONFIRMATION_MS);

      const poll = async () => {
        const ready = await checkStatus();
        if (cancelled || !ready) return;
        window.clearInterval(interval);
        window.clearTimeout(slowTimer);
        redirectTimer = window.setTimeout(() => {
          router.replace(loginPath);
        }, REDIRECT_DELAY_MS);
      };

      void poll();
      const interval = window.setInterval(() => { void poll(); }, POLL_INTERVAL_MS);

      return () => {
        cancelled = true;
        window.clearInterval(interval);
        window.clearTimeout(slowTimer);
        window.clearTimeout(redirectTimer);
      };
    };

    return startPolling();
  }, [sessionId, checkStatus, loginPath, router, retryNonce]);

  if (!sessionId) {
    return (
      <CheckoutSuccessShell
        title={copy.title}
        body={copy.pending}
      />
    );
  }

  if (pollState === "ready") {
    return (
      <CheckoutSuccessShell
        title={copy.title}
        body={copy.ready}
      />
    );
  }

  if (pollState === "slow") {
    return (
      <CheckoutSuccessShell
        title={copy.title}
        body={copy.pending}
      >
        <button
          type="button"
          onClick={() => {
            setPollState("waiting");
            setRetryNonce((value) => value + 1);
          }}
          style={{
            marginTop: 20,
            padding: "10px 16px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "transparent",
            color: "#f5f5f4",
            cursor: "pointer",
          }}
        >
          {copy.retry}
        </button>
      </CheckoutSuccessShell>
    );
  }

  return (
    <CheckoutSuccessShell
      title={copy.title}
      body={copy.waiting}
    />
  );
}

export default function StripeCheckoutSuccessPage() {
  return (
    <Suspense fallback={(
      <main style={{ minHeight: "100dvh", background: "#09090b", color: "#fff", padding: 32 }}>
        …
      </main>
    )}
    >
      <StripeCheckoutSuccessContent />
    </Suspense>
  );
}
