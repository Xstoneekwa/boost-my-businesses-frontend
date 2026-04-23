"use client";

import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import RestaurantLanguageToggle, { useRestaurantLanguage } from "@/components/restaurant-language/RestaurantLanguageToggle";
import { restaurantCommonCopy } from "@/lib/restaurant-language";

const AC = "#F59E0B";
const AC_TEXT = "#FBBF24";
const AC_BORDER = "rgba(245,158,11,0.24)";
const PASSWORD_RESET_REDIRECT_TO = "http://localhost:3000/restaurant-reset-password";

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

export default function RestaurantForgotPasswordPage() {
  const [lang, setLang] = useRestaurantLanguage();
  const t = restaurantCommonCopy[lang];
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    if (!email.trim()) {
      setStatus("error");
      setMessage(t.forgot.emptyError);
      return;
    }

    setStatus("loading");

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: PASSWORD_RESET_REDIRECT_TO,
      });

      if (error) throw new Error(error.message);

      setStatus("success");
      setMessage(t.forgot.success);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : t.forgot.failed);
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
              <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{t.forgot.brandSub}</span>
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
              {t.forgot.eyebrow}
            </p>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(2.25rem, 5vw, 4rem)", lineHeight: 1.02, letterSpacing: "-0.045em", maxWidth: 680, marginBottom: 18 }}>
              {t.forgot.title}
            </h1>
            <p style={{ color: "rgba(255,255,255,0.58)", fontSize: 16, lineHeight: 1.75, maxWidth: 610 }}>
              {t.forgot.text}
            </p>
          </div>

          <form onSubmit={handleSubmit} style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.035)", borderRadius: 26, padding: "clamp(20px, 3vw, 30px)", boxShadow: "0 28px 90px rgba(0,0,0,0.26)" }}>
            <div style={{ marginBottom: 18 }}>
              <FieldLabel>{t.email}</FieldLabel>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="client@restaurant.com" autoComplete="email" style={inputStyle} />
            </div>

            {message && (
              <div
                style={{
                  border: status === "error" ? "1px solid rgba(248,113,113,0.30)" : `1px solid ${AC_BORDER}`,
                  background: status === "error" ? "rgba(248,113,113,0.08)" : "rgba(245,158,11,0.08)",
                  borderRadius: 14,
                  padding: 12,
                  marginBottom: 18,
                }}
              >
                <p style={{ color: status === "error" ? "#FCA5A5" : AC_TEXT, fontSize: 13, lineHeight: 1.5 }}>{message}</p>
              </div>
            )}

            <button type="submit" disabled={status === "loading"} style={{ width: "100%", minHeight: 52, border: `1px solid ${AC_BORDER}`, background: status === "loading" ? "rgba(255,255,255,0.08)" : AC, color: status === "loading" ? "rgba(255,255,255,0.44)" : "#160b02", borderRadius: 999, fontSize: 14, fontWeight: 900, cursor: status === "loading" ? "wait" : "pointer", boxShadow: status === "loading" ? "none" : "0 8px 32px rgba(245,158,11,0.28)", marginBottom: 14 }}>
              {status === "loading" ? t.forgot.loading : t.forgot.submit}
            </button>

            <p style={{ color: "rgba(255,255,255,0.46)", fontSize: 12.5, lineHeight: 1.6, textAlign: "center" }}>
              {t.forgot.helper}
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}
