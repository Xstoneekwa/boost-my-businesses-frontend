"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import RestaurantLanguageToggle, { useRestaurantLanguage } from "@/components/restaurant-language/RestaurantLanguageToggle";
import { restaurantCommonCopy } from "@/lib/restaurant-language";

const AC = "#F59E0B";
const AC_TEXT = "#FBBF24";
const AC_BORDER = "rgba(245,158,11,0.24)";

type RecoveryState = "checking" | "ready" | "invalid" | "success";

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(ellipse 70% 45% at 20% 0%, rgba(245,158,11,0.14), transparent 65%), radial-gradient(ellipse 45% 35% at 100% 20%, rgba(180,83,9,0.12), transparent 58%), linear-gradient(180deg, #07111f 0%, #081226 100%)",
  color: "#f0f0ef",
  fontFamily: "'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(7,17,31,0.72)",
  color: "#f0f0ef",
  borderRadius: 14,
  padding: "13px 14px",
  font: "inherit",
  outline: "none",
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "block",
        color: "rgba(255,255,255,0.44)",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 10,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </label>
  );
}

function getHashParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

export default function RestaurantResetPasswordPage() {
  const searchParams = useSearchParams();
  const [lang, setLang] = useRestaurantLanguage();
  const t = restaurantCommonCopy[lang];
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function prepareRecoverySession() {
      const supabase = createSupabaseBrowserClient();
      const code = searchParams.get("code");
      const hashParams = getHashParams();
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      try {
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        } else if (accessToken && refreshToken) {
          const { error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (setSessionError) throw setSessionError;
        }

        const { data } = await supabase.auth.getSession();

        if (!isMounted) return;
        setRecoveryState(data.session ? "ready" : "invalid");
      } catch {
        if (!isMounted) return;
        setRecoveryState("invalid");
      }
    }

    prepareRecoverySession();

    return () => {
      isMounted = false;
    };
  }, [searchParams]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(t.reset.shortPassword);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t.reset.mismatch);
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      setRecoveryState("success");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t.reset.failed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main style={pageStyle}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "32px 24px 72px" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 18, marginBottom: 58, flexWrap: "wrap" }}>
          <Link href="/agent/restaurant-call-assistant" style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "#f0f0ef", textDecoration: "none" }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: AC, color: "#160b02", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 900 }}>
              B
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 800 }}>BoostMyBusinesses</span>
              <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{t.reset.brandSub}</span>
            </span>
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <RestaurantLanguageToggle lang={lang} onLangChange={setLang} />
            <Link href="/restaurant-login" style={{ border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.76)", borderRadius: 999, padding: "10px 15px", textDecoration: "none", fontSize: 13, fontWeight: 700 }}>
              {t.backToLogin}
            </Link>
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 390px), 1fr))", gap: 28, alignItems: "center" }}>
          <div>
            <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14 }}>
              {t.reset.eyebrow}
            </p>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(2.25rem, 5vw, 4rem)", lineHeight: 1.02, letterSpacing: "-0.045em", maxWidth: 680, marginBottom: 18 }}>
              {t.reset.title}
            </h1>
            <p style={{ color: "rgba(255,255,255,0.58)", fontSize: 16, lineHeight: 1.75, maxWidth: 610 }}>
              {t.reset.text}
            </p>
          </div>

          <div style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.035)", borderRadius: 26, padding: "clamp(20px, 3vw, 30px)", boxShadow: "0 28px 90px rgba(0,0,0,0.26)" }}>
            {recoveryState === "checking" && (
              <p style={{ color: "rgba(255,255,255,0.62)", fontSize: 14, lineHeight: 1.7 }}>
                {t.reset.checking}
              </p>
            )}

            {recoveryState === "invalid" && (
              <>
                <div style={{ border: "1px solid rgba(248,113,113,0.30)", background: "rgba(248,113,113,0.08)", borderRadius: 14, padding: 14, marginBottom: 18 }}>
                  <p style={{ color: "#FCA5A5", fontSize: 14, lineHeight: 1.6 }}>{t.reset.invalid}</p>
                </div>
                <Link href="/restaurant-login" style={{ display: "inline-flex", width: "100%", minHeight: 52, alignItems: "center", justifyContent: "center", border: `1px solid ${AC_BORDER}`, background: AC, color: "#160b02", borderRadius: 999, fontSize: 14, fontWeight: 900, textDecoration: "none", boxShadow: "0 8px 32px rgba(245,158,11,0.28)" }}>
                  {t.backToLogin}
                </Link>
              </>
            )}

            {recoveryState === "success" && (
              <>
                <div style={{ border: `1px solid ${AC_BORDER}`, background: "rgba(245,158,11,0.08)", borderRadius: 14, padding: 14, marginBottom: 18 }}>
                  <p style={{ color: AC_TEXT, fontSize: 14, lineHeight: 1.6 }}>{t.reset.success}</p>
                </div>
                <Link href="/restaurant-login" style={{ display: "inline-flex", width: "100%", minHeight: 52, alignItems: "center", justifyContent: "center", border: `1px solid ${AC_BORDER}`, background: AC, color: "#160b02", borderRadius: 999, fontSize: 14, fontWeight: 900, textDecoration: "none", boxShadow: "0 8px 32px rgba(245,158,11,0.28)" }}>
                  {t.backToLogin}
                </Link>
              </>
            )}

            {recoveryState === "ready" && (
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 18 }}>
                  <FieldLabel>{t.newPassword}</FieldLabel>
                  <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={t.reset.passwordPlaceholder} autoComplete="new-password" style={inputStyle} />
                </div>

                <div style={{ marginBottom: 18 }}>
                  <FieldLabel>{t.confirmPassword}</FieldLabel>
                  <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={t.reset.confirmPlaceholder} autoComplete="new-password" style={inputStyle} />
                </div>

                {error && (
                  <div style={{ border: "1px solid rgba(248,113,113,0.30)", background: "rgba(248,113,113,0.08)", borderRadius: 14, padding: 12, marginBottom: 18 }}>
                    <p style={{ color: "#FCA5A5", fontSize: 13, lineHeight: 1.5 }}>{error}</p>
                  </div>
                )}

                <button type="submit" disabled={isSubmitting} style={{ width: "100%", minHeight: 52, border: `1px solid ${AC_BORDER}`, background: isSubmitting ? "rgba(255,255,255,0.08)" : AC, color: isSubmitting ? "rgba(255,255,255,0.44)" : "#160b02", borderRadius: 999, fontSize: 14, fontWeight: 900, cursor: isSubmitting ? "wait" : "pointer", boxShadow: isSubmitting ? "none" : "0 8px 32px rgba(245,158,11,0.28)" }}>
                  {isSubmitting ? t.reset.loading : t.reset.submit}
                </button>
              </form>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
