"use client";

import { useEffect, useRef, useState } from "react";
import { parseClientApiResponse } from "@/lib/instagram-client/read-api-response";

export type ClientPasswordUpdateTarget = {
  accountId: string;
  actionId: string;
  username: string;
};

type Props = {
  open: boolean;
  lang: "fr" | "en";
  target: ClientPasswordUpdateTarget | null;
  onClose: () => void;
  onSuccess: (result: { accountId: string; actionId: string; credentialsVersion: number }) => void;
  onRestart: (accountId: string) => void;
};

type SubmitState = "idle" | "submitting" | "error" | "success";

function labelFor(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

export default function ClientPasswordUpdateModal({ open, lang, target, onClose, onSuccess, onRestart }: Props) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  function clearSecret() {
    setPassword("");
    setShowPassword(false);
  }

  function close() {
    if (inFlightRef.current) return;
    clearSecret();
    setSubmitState("idle");
    setMessage(null);
    onClose();
  }

  useEffect(() => {
    setPassword("");
    setShowPassword(false);
    setSubmitState("idle");
    setMessage(null);
    return () => {
      inFlightRef.current = false;
    };
  }, [open, target?.actionId]);

  if (!open || !target) return null;

  async function submitPassword() {
    const submittedTarget = target;
    if (!submittedTarget) return;
    if (inFlightRef.current || password.length < 6) return;
    inFlightRef.current = true;
    setSubmitState("submitting");
    setMessage(null);
    try {
      const response = await fetch(
        `/api/instagram-client/accounts/${encodeURIComponent(submittedTarget.accountId)}/credentials/update-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ action_id: submittedTarget.actionId, password }),
        },
      );
      const payload = await parseClientApiResponse<{
        account_id: string;
        action_id: string;
        credentials_version: number;
        message?: string;
      }>(response, lang);
      clearSecret();
      if (!response.ok || payload.ok === false || !payload.data) {
        setSubmitState("error");
        setMessage(payload.message || payload.error || labelFor(
          lang,
          "Le mot de passe n’a pas pu être enregistré. Réessayez.",
          "The password could not be saved. Try again.",
        ));
        return;
      }
      setSubmitState("success");
      setMessage(payload.data.message || labelFor(
        lang,
        "Mot de passe enregistré. Relancez maintenant la connexion Instagram.",
        "Password saved. Restart the Instagram connection now.",
      ));
      onSuccess({
        accountId: payload.data.account_id,
        actionId: payload.data.action_id,
        credentialsVersion: payload.data.credentials_version,
      });
    } catch {
      clearSecret();
      setSubmitState("error");
      setMessage(labelFor(
        lang,
        "Le mot de passe n’a pas pu être enregistré. Réessayez.",
        "The password could not be saved. Try again.",
      ));
    } finally {
      inFlightRef.current = false;
    }
  }

  return (
    <div className="cd-progress-overlay" role="presentation" onMouseDown={close}>
      <section
        className="cd-progress-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cd-password-update-title"
        data-modal-type="password_update"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="cd-progress-head">
          <div>
            <span>@{target.username} · Instagram</span>
            <h3 id="cd-password-update-title">
              {labelFor(lang, "Mettre à jour le mot de passe Instagram", "Update Instagram password")}
            </h3>
            <p>
              {labelFor(
                lang,
                "Instagram a refusé le mot de passe enregistré. Saisissez votre nouveau mot de passe pour reprendre la connexion.",
                "Instagram rejected the saved password. Enter the new password to resume the connection.",
              )}
            </p>
          </div>
          <em className={submitState === "success" ? "status-connected" : "status-action_required"}>
            {submitState === "success"
              ? labelFor(lang, "Enregistré", "Saved")
              : labelFor(lang, "Action requise", "Action required")}
          </em>
        </header>

        {submitState !== "success" ? (
          <>
            <label className="cd-verification-label" htmlFor="cd-instagram-new-password">
              {labelFor(lang, "Nouveau mot de passe", "New password")}
            </label>
            <div className="cd-password-update-field">
              <input
                id="cd-instagram-new-password"
                className="cd-verification-input"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitState === "submitting"}
                autoFocus
              />
              <button type="button" className="cd-btn cd-btn-soft" disabled={submitState === "submitting"} onClick={() => setShowPassword((current) => !current)}>
                {showPassword ? labelFor(lang, "Masquer", "Hide") : labelFor(lang, "Afficher", "Show")}
              </button>
            </div>
            <p className="cd-verification-hint">
              {labelFor(
                lang,
                "Le mot de passe est transmis au stockage sécurisé. Il n’est jamais affiché ni conservé dans cette interface.",
                "The password is sent to secure storage. It is never displayed or retained by this interface.",
              )}
            </p>
          </>
        ) : null}

        {message ? (
          <p className={submitState === "error" ? "cd-verification-error" : "cd-progress-action cd-progress-action-success"}>{message}</p>
        ) : null}

        <div className="cd-connect-actions">
          {submitState !== "success" ? (
            <>
              <button type="button" className="cd-btn cd-btn-soft" disabled={submitState === "submitting"} onClick={close}>
                {labelFor(lang, "Annuler", "Cancel")}
              </button>
              <button type="button" className="cd-btn cd-btn-primary" disabled={submitState === "submitting" || password.length < 6} onClick={() => void submitPassword()}>
                {submitState === "submitting" ? labelFor(lang, "Mise à jour…", "Updating…") : labelFor(lang, "Mettre à jour", "Update")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="cd-btn cd-btn-soft" onClick={close}>{labelFor(lang, "Fermer", "Close")}</button>
              <button
                type="button"
                className="cd-btn cd-btn-primary"
                onClick={() => {
                  const accountId = target.accountId;
                  close();
                  onRestart(accountId);
                }}
              >
                {labelFor(lang, "Relancer la connexion Instagram", "Restart Instagram connection")}
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
