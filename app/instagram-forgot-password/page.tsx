"use client";

import type { CSSProperties, FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { buildInstagramPasswordResetRedirect } from "@/lib/instagram-auth/password-recovery";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const ACCENT = "#e9a23b";
const INK = "#f4f0e6";
const DIM = "#b8b0a0";

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(7,17,31,0.72)",
  color: INK,
  borderRadius: 14,
  padding: "13px 16px",
  font: "inherit",
  outline: "none",
};

export default function InstagramForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const canonicalEmail = email.trim().toLowerCase();

    if (!canonicalEmail) {
      setStatus("error");
      setMessage("Saisis ton adresse email.");
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(canonicalEmail, {
        redirectTo: buildInstagramPasswordResetRedirect(window.location.origin),
      });

      if (error) throw error;

      setStatus("success");
      setMessage("Si cette adresse existe, un lien de récupération vient d'être envoyé.");
    } catch {
      setStatus("error");
      setMessage("Le lien de récupération n'a pas pu être envoyé. Réessaie dans quelques instants.");
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "radial-gradient(120% 100% at 90% -5%, rgba(233,162,59,0.22) 0%, #141720 40%, #0e0f14 80%)",
        color: INK,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <section style={{ width: "min(100%, 460px)" }}>
        <Link href="/instagram-login" style={{ color: DIM, textDecoration: "none", fontSize: 14 }}>
          Retour à la connexion
        </Link>

        <h1 style={{ margin: "28px 0 10px", fontSize: 34, letterSpacing: 0 }}>
          Mot de passe oublié
        </h1>
        <p style={{ color: DIM, lineHeight: 1.65, marginBottom: 24 }}>
          Entre ton email pour recevoir un lien sécurisé.
        </p>

        <form
          onSubmit={handleSubmit}
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.035)",
            borderRadius: 8,
            padding: 24,
          }}
        >
          <label htmlFor="instagram-recovery-email" style={{ display: "block", color: DIM, fontSize: 13, marginBottom: 8 }}>
            Email
          </label>
          <input
            id="instagram-recovery-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            style={inputStyle}
          />

          {message && (
            <p
              role="status"
              style={{
                color: status === "error" ? "#fca5a5" : "#fde68a",
                fontSize: 13,
                lineHeight: 1.55,
                margin: "16px 0 0",
              }}
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={status === "loading"}
            style={{
              width: "100%",
              minHeight: 48,
              border: 0,
              borderRadius: 8,
              marginTop: 18,
              background: status === "loading" ? "rgba(255,255,255,0.10)" : ACCENT,
              color: status === "loading" ? DIM : "#0e0f14",
              fontWeight: 800,
              cursor: status === "loading" ? "wait" : "pointer",
            }}
          >
            {status === "loading" ? "Envoi..." : "Envoyer le lien"}
          </button>
        </form>
      </section>
    </main>
  );
}
