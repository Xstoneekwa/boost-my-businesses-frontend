"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPasswordRecoveryAuthEvent } from "@/lib/instagram-auth/password-recovery";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const ACCENT = "#e9a23b";
const INK = "#f4f0e6";
const DIM = "#b8b0a0";

type RecoveryState = "checking" | "ready" | "invalid" | "success";

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

export default function InstagramResetPasswordPage() {
  const router = useRouter();
  const recoveryClient = useRef<SupabaseClient | null>(null);
  const [recoveryState, setRecoveryState] = useState<RecoveryState>("checking");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const supabase = createSupabaseBrowserClient();
    recoveryClient.current = supabase;

    const invalidTimer = window.setTimeout(() => {
      if (isMounted) setRecoveryState("invalid");
    }, 8000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted || !isPasswordRecoveryAuthEvent(event, Boolean(session))) return;

      window.clearTimeout(invalidTimer);
      window.history.replaceState(window.history.state, "", "/instagram-reset-password");
      setRecoveryState("ready");
    });

    return () => {
      isMounted = false;
      window.clearTimeout(invalidTimer);
      subscription.unsubscribe();
      recoveryClient.current = null;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    const supabase = recoveryClient.current;
    if (!supabase || recoveryState !== "ready") {
      setRecoveryState("invalid");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      setNewPassword("");
      setConfirmPassword("");

      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) throw signOutError;

      setRecoveryState("success");
      window.setTimeout(() => router.replace("/instagram-login"), 900);
    } catch {
      setError("Le mot de passe n'a pas pu être mis à jour. Demande un nouveau lien et réessaie.");
    } finally {
      setIsSubmitting(false);
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
          Nouveau mot de passe
        </h1>
        <p style={{ color: DIM, lineHeight: 1.65, marginBottom: 24 }}>
          Choisis un nouveau mot de passe pour ton espace Instagram Growth.
        </p>

        <div
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.035)",
            borderRadius: 8,
            padding: 24,
          }}
        >
          {recoveryState === "checking" && <p style={{ color: DIM }}>Vérification du lien...</p>}

          {recoveryState === "invalid" && (
            <div>
              <p role="alert" style={{ color: "#fca5a5", lineHeight: 1.6 }}>
                Ce lien de récupération est invalide ou expiré.
              </p>
              <Link href="/instagram-forgot-password" style={{ color: "#fde68a" }}>
                Demander un nouveau lien
              </Link>
            </div>
          )}

          {recoveryState === "success" && (
            <p role="status" style={{ color: "#fde68a", lineHeight: 1.6 }}>
              Mot de passe mis à jour. Retour à la connexion...
            </p>
          )}

          {recoveryState === "ready" && (
            <form onSubmit={handleSubmit}>
              <label htmlFor="instagram-new-password" style={{ display: "block", color: DIM, fontSize: 13, marginBottom: 8 }}>
                Nouveau mot de passe
              </label>
              <input
                id="instagram-new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                style={inputStyle}
              />

              <label htmlFor="instagram-confirm-password" style={{ display: "block", color: DIM, fontSize: 13, margin: "18px 0 8px" }}>
                Confirmation
              </label>
              <input
                id="instagram-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                style={inputStyle}
              />

              {error && <p role="alert" style={{ color: "#fca5a5", fontSize: 13, lineHeight: 1.55 }}>{error}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                style={{
                  width: "100%",
                  minHeight: 48,
                  border: 0,
                  borderRadius: 8,
                  marginTop: 18,
                  background: isSubmitting ? "rgba(255,255,255,0.10)" : ACCENT,
                  color: isSubmitting ? DIM : "#0e0f14",
                  fontWeight: 800,
                  cursor: isSubmitting ? "wait" : "pointer",
                }}
              >
                {isSubmitting ? "Mise à jour..." : "Mettre à jour le mot de passe"}
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
