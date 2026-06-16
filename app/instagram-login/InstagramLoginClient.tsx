"use client";

import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { instagramPostLoginPath } from "@/lib/instagram-auth/post-login-path";
import type { UserRole } from "@/lib/userContext";

const ACCENT_FROM = "#fbbf24";
const ACCENT_MID  = "#e9a23b";
const ACCENT_TO   = "#d97706";
const ACCENT_RING = "rgba(233,162,59,0.40)";
const ACCENT_INK  = "#0e0f14";
const SURFACE     = "#141720";
const LINE        = "rgba(255,255,255,0.10)";
const INK         = "#f4f0e6";
const INK_DIM     = "#b8b0a0";
const INK_MUTE    = "#7a7468";

const GRAD = `linear-gradient(135deg, ${ACCENT_FROM} 0%, ${ACCENT_MID} 55%, ${ACCENT_TO} 100%)`;

interface Props {
  fontDisplay: string;
  fontBody: string;
  fontMono: string;
}

const inputBase: CSSProperties = {
  width: "100%",
  border: `1px solid ${LINE}`,
  background: "rgba(7,17,31,0.72)",
  color: INK,
  borderRadius: 14,
  padding: "13px 16px",
  outline: "none",
  transition: "border-color 180ms ease",
};

function FieldLabel({ children, fontMono }: { children: React.ReactNode; fontMono: string }) {
  return (
    <label
      style={{
        display: "block",
        color: INK_MUTE,
        fontFamily: fontMono,
        fontSize: 10,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </label>
  );
}

export default function InstagramLoginClient({ fontDisplay, fontBody, fontMono }: Props) {
  const router = useRouter();
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [error, setError]         = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Veuillez saisir votre email et votre mot de passe.");
      return;
    }

    setSubmitting(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError || !data.session) {
        throw new Error(signInError?.message ?? "Impossible de créer la session. Réessayez.");
      }

      const res = await fetch("/api/instagram-auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }),
      });

      const payload = (await res.json()) as {
        user?: { role?: UserRole };
        error?: string;
        details?: string;
      };

      if (!res.ok) {
        throw new Error(payload.details || payload.error || "Accès refusé.");
      }

      const dashboardPath = instagramPostLoginPath(payload.user?.role);
      const topWindow = typeof window !== "undefined" ? window.top ?? window : null;
      if (topWindow && topWindow !== window) {
        topWindow.location.assign(dashboardPath);
        return;
      }

      router.refresh();
      router.push(dashboardPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion échouée. Réessayez.");
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          `radial-gradient(120% 100% at 90% -5%, rgba(233,162,59,0.22) 0%, #141720 40%, #0e0f14 80%)`,
        color: INK,
        fontFamily: fontBody,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "0 28px 80px" }}>

        {/* ── NAV ── */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            height: 72,
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/instagram-growth"
            style={{ display: "inline-flex", alignItems: "center", gap: 11, textDecoration: "none" }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: GRAD,
                color: ACCENT_INK,
                display: "grid",
                placeItems: "center",
                fontFamily: fontDisplay,
                fontWeight: 900,
                fontSize: 16,
                boxShadow: `0 6px 18px -6px ${ACCENT_RING}`,
              }}
            >
              B
            </span>
            <span>
              <span style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 17, color: INK }}>
                Boost<span style={{ color: ACCENT_MID }}>My</span>Businesses
              </span>
            </span>
          </Link>

          <Link
            href="/instagram-growth"
            style={{
              border: `1px solid ${LINE}`,
              color: INK_DIM,
              borderRadius: 999,
              padding: "9px 16px",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: fontDisplay,
              transition: "border-color 150ms, color 150ms",
            }}
          >
            ← Page service
          </Link>
        </header>

        {/* ── BODY ── */}
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))",
            gap: 48,
            alignItems: "center",
            paddingTop: "clamp(40px, 8vw, 80px)",
          }}
        >
          {/* LEFT — copy */}
          <div>
            <p
              style={{
                fontFamily: fontMono,
                fontSize: 11,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                background: GRAD,
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                marginBottom: 18,
                fontWeight: 700,
              }}
            >
              Accès client
            </p>

            <h1
              style={{
                fontFamily: fontDisplay,
                fontSize: "clamp(2.2rem, 4.8vw, 3.8rem)",
                fontWeight: 800,
                lineHeight: 1.02,
                letterSpacing: "-0.035em",
                marginBottom: 20,
                textShadow: `0 0 22px rgba(233,162,59,0.18)`,
              }}
            >
              Instagram Growth<br />
              <span
                style={{
                  background: GRAD,
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                  backgroundClip: "text",
                }}
              >
                Dashboard
              </span>
            </h1>

            <p
              style={{
                color: INK_DIM,
                fontSize: 16,
                lineHeight: 1.7,
                maxWidth: 520,
                marginBottom: 32,
              }}
            >
              Accédez à votre espace de gestion pour suivre vos campagnes de croissance,
              visualiser vos métriques en temps réel et piloter vos comptes Instagram.
            </p>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {["Analytics temps réel", "Gestion des comptes", "Suivi des campagnes", "Espace admin"].map((badge) => (
                <span
                  key={badge}
                  style={{
                    border: `1px solid ${LINE}`,
                    background: "rgba(255,255,255,0.035)",
                    borderRadius: 999,
                    color: INK_DIM,
                    padding: "8px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: fontDisplay,
                  }}
                >
                  {badge}
                </span>
              ))}
            </div>
          </div>

          {/* RIGHT — form card */}
          <form
            onSubmit={handleSubmit}
            style={{
              background: SURFACE,
              border: `1px solid ${LINE}`,
              borderRadius: 24,
              padding: "clamp(24px, 3.5vw, 36px)",
              boxShadow: "0 30px 80px -24px rgba(0,0,0,0.70)",
            }}
          >
            {/* Form header */}
            <div style={{ marginBottom: 28 }}>
              <p
                style={{
                  fontFamily: fontMono,
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  color: INK_MUTE,
                  marginBottom: 6,
                }}
              >
                Connexion
              </p>
              <p style={{ fontFamily: fontDisplay, fontWeight: 800, fontSize: 20, color: INK }}>
                Accéder à mon dashboard
              </p>
            </div>

            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <FieldLabel fontMono={fontMono}>Email</FieldLabel>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@exemple.com"
                autoComplete="email"
                style={{ ...inputBase, fontFamily: fontBody }}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 20 }}>
              <FieldLabel fontMono={fontMono}>Mot de passe</FieldLabel>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={{ ...inputBase, fontFamily: fontBody }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <Link
                  href="/restaurant-forgot-password"
                  style={{
                    background: GRAD,
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                    fontSize: 12.5,
                    fontWeight: 800,
                    fontFamily: fontDisplay,
                    textDecoration: "none",
                  }}
                >
                  Mot de passe oublié ?
                </Link>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  border: "1px solid rgba(251,113,133,0.28)",
                  background: "rgba(251,113,133,0.08)",
                  borderRadius: 14,
                  padding: "12px 14px",
                  marginBottom: 16,
                }}
              >
                <p style={{ color: "#FCA5A5", fontSize: 13, lineHeight: 1.5, fontFamily: fontBody }}>
                  {error}
                </p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              style={{
                width: "100%",
                minHeight: 52,
                background: submitting ? "rgba(255,255,255,0.08)" : GRAD,
                border: submitting ? `1px solid ${LINE}` : `1px solid ${ACCENT_RING}`,
                color: submitting ? INK_MUTE : ACCENT_INK,
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 900,
                fontFamily: fontDisplay,
                letterSpacing: "-0.01em",
                cursor: submitting ? "wait" : "pointer",
                boxShadow: submitting
                  ? "none"
                  : `0 8px 32px -8px rgba(233,162,59,0.60), 0 0 22px rgba(251,191,36,0.18)`,
                marginBottom: 14,
                transition: "box-shadow 200ms, background 200ms",
              }}
            >
              {submitting ? "Connexion…" : "Se connecter"}
            </button>

            <p
              style={{
                color: INK_MUTE,
                fontSize: 12,
                lineHeight: 1.6,
                textAlign: "center",
                fontFamily: fontBody,
              }}
            >
              Accès réservé aux administrateurs et clients autorisés.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}
