"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveClientAccountConnectionUi } from "@/lib/instagram-client/client-account-connection-ui";

export type ClientInstagramAccountView = {
  accountId: string;
  username: string;
  packageLabel: string;
  accountStatus: string;
  onboardingStatus: string;
  provisioningStatus: string;
  loginStatus: string;
  assignmentStatus: string;
  readinessLabel: string;
  connected: boolean;
};

type Props = {
  lang: "fr" | "en";
  accounts: ClientInstagramAccountView[];
};

type ActionState = {
  accountId: string;
  kind: "readiness" | "connect" | "create";
} | null;

function labelFor(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

export default function ClientAccountsSection({ lang, accounts }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(accounts);
  const [modalOpen, setModalOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [actionState, setActionState] = useState<ActionState>(null);

  const canAddAccount = useMemo(() => items.length < 5, [items.length]);
  const isEmpty = items.length === 0;

  function pushMessage(text: string, tone: "success" | "error" = "success") {
    setMessage(text);
    setMessageTone(tone);
  }

  async function handleCreateAccount(event: React.FormEvent) {
    event.preventDefault();
    if (actionState) return;
    setActionState({ accountId: "new", kind: "create" });
    setMessage("");
    try {
      const response = await fetch("/api/instagram-client/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          username,
          email,
          password,
          notes,
        }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        data?: { account?: ClientInstagramAccountView; assignment?: { status?: string; reason?: string } };
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || labelFor(lang, "Impossible d'ajouter le compte.", "Could not add account."));
      }
      const account = payload.data?.account;
      if (account) {
        setItems((current) => [...current.filter((row) => row.accountId !== account.accountId), account]);
      }
      setModalOpen(false);
      setUsername("");
      setEmail("");
      setPassword("");
      setNotes("");
      const setupPending = payload.data?.assignment?.status === "pending_assignment";
      pushMessage(
        setupPending
          ? labelFor(lang, "Compte ajouté — configuration en cours.", "Account added — setup pending.")
          : labelFor(lang, "Compte Instagram ajouté.", "Instagram account added."),
        "success",
      );
      router.refresh();
    } catch (error) {
      pushMessage(error instanceof Error ? error.message : labelFor(lang, "Impossible d'ajouter le compte.", "Could not add account."), "error");
    } finally {
      setActionState(null);
    }
  }

  async function handleCheckReadiness(accountId: string) {
    if (actionState) return;
    setActionState({ accountId, kind: "readiness" });
    try {
      const response = await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/check-readiness`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as { ok?: boolean; error?: string; data?: { message?: string; connected?: boolean } };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || labelFor(lang, "Impossible de vérifier l'état.", "Could not check readiness."));
      }
      setItems((current) => current.map((row) => row.accountId === accountId
        ? {
          ...row,
          readinessLabel: payload.data?.message || row.readinessLabel,
          connected: payload.data?.connected === true,
        }
        : row));
      pushMessage(payload.data?.message || labelFor(lang, "État mis à jour.", "Status updated."), "success");
      router.refresh();
    } catch (error) {
      pushMessage(error instanceof Error ? error.message : labelFor(lang, "Impossible de vérifier l'état.", "Could not check readiness."), "error");
    } finally {
      setActionState(null);
    }
  }

  async function handleConnect(account: ClientInstagramAccountView) {
    if (actionState) return;
    setActionState({ accountId: account.accountId, kind: "connect" });
    try {
      const response = await fetch(`/api/instagram-client/accounts/${encodeURIComponent(account.accountId)}/connect`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as { ok?: boolean; error?: string; data?: { message?: string; connected?: boolean; request_queued?: boolean } };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || labelFor(lang, "Connexion indisponible.", "Connect unavailable."));
      }
      setItems((current) => current.map((row) => row.accountId === account.accountId
        ? {
          ...row,
          readinessLabel: payload.data?.message || row.readinessLabel,
          connected: payload.data?.connected === true,
        }
        : row));
      pushMessage(payload.data?.message || labelFor(lang, "Connexion lancée.", "Connect started."), "success");
      router.refresh();
    } catch (error) {
      pushMessage(error instanceof Error ? error.message : labelFor(lang, "Connexion indisponible.", "Connect unavailable."), "error");
    } finally {
      setActionState(null);
    }
  }

  return (
    <>
      <section className="cd-card cd-accounts-panel">
        <div className="cd-card-hd">
          <h3>{labelFor(lang, "Mes comptes Instagram", "My Instagram accounts")}</h3>
          {canAddAccount && !isEmpty ? (
            <button type="button" className="cd-btn cd-btn-primary cd-btn-compact" onClick={() => setModalOpen(true)}>
              {labelFor(lang, "Ajouter un compte Instagram", "Add Instagram account")}
            </button>
          ) : null}
        </div>

        {isEmpty ? (
          <div className="cd-accounts-empty">
            <p>{labelFor(lang, "Aucun compte Instagram lié pour le moment.", "No Instagram account linked yet.")}</p>
            <button type="button" className="cd-btn cd-btn-primary" onClick={() => setModalOpen(true)}>
              {labelFor(lang, "Ajouter un compte Instagram", "Add Instagram account")}
            </button>
          </div>
        ) : (
          <div className="cd-accounts-list">
            {items.map((account) => {
              const busy = actionState?.accountId === account.accountId;
              const ui = resolveClientAccountConnectionUi(account, lang);
              return (
                <article className="cd-account-row" key={account.accountId}>
                  <div className="cd-account-main">
                    <strong>@{account.username}</strong>
                    <small>{account.packageLabel}</small>
                    <span className={`cd-account-pill cd-account-pill-${ui.badgeTone}`}>{ui.badgeLabel}</span>
                  </div>
                  <div className="cd-account-actions">
                    <button
                      type="button"
                      className={`cd-btn cd-btn-soft cd-account-state cd-account-state-${ui.readinessTone}`}
                      disabled={busy || ui.readinessDisabled}
                      onClick={() => void handleCheckReadiness(account.accountId)}
                    >
                      {busy && actionState?.kind === "readiness"
                        ? labelFor(lang, "Vérification…", "Checking…")
                        : ui.readinessLabel}
                    </button>
                    <button
                      type="button"
                      className={`cd-btn cd-account-state cd-account-state-${ui.connectTone}`}
                      disabled={busy || ui.connectDisabled}
                      onClick={() => void handleConnect(account)}
                    >
                      {busy && actionState?.kind === "connect"
                        ? labelFor(lang, "Connexion…", "Connecting…")
                        : ui.connectLabel}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {message ? <p className={`cd-accounts-message ${messageTone}`}>{message}</p> : null}
      </section>

      {modalOpen ? (
        <div className="cd-progress-overlay" role="presentation" onMouseDown={() => !actionState && setModalOpen(false)}>
          <section
            className="cd-progress-modal cd-add-account-modal"
            role="dialog"
            aria-modal="true"
            aria-label={labelFor(lang, "Ajouter un compte Instagram", "Add Instagram account")}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="cd-s-title">{labelFor(lang, "Nouveau compte", "New account")}</div>
            <h3>{labelFor(lang, "Ajouter un compte Instagram", "Add Instagram account")}</h3>
            <p className="cd-connect-copy">
              {labelFor(
                lang,
                "Ajoutez votre compte Instagram. Nous gérons automatiquement l'attribution technique — aucun téléphone ou clone à choisir.",
                "Add your Instagram account. We handle technical assignment automatically — no phone or clone to choose.",
              )}
            </p>
            <form className="cd-add-account-form" onSubmit={(event) => void handleCreateAccount(event)}>
              <label className="cd-fg">
                <span className="cd-fl">{labelFor(lang, "Nom d'utilisateur Instagram", "Instagram username")}</span>
                <input className="cd-fi-in" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="@username" required />
              </label>
              <label className="cd-fg">
                <span className="cd-fl">{labelFor(lang, "Email Instagram (optionnel)", "Instagram email (optional)")}</span>
                <input className="cd-fi-in" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
              </label>
              <label className="cd-fg">
                <span className="cd-fl">{labelFor(lang, "Mot de passe Instagram", "Instagram password")}</span>
                <input className="cd-fi-in" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
              </label>
              <label className="cd-fg">
                <span className="cd-fl">{labelFor(lang, "Notes (optionnel)", "Notes (optional)")}</span>
                <input className="cd-fi-in" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              <div className="cd-add-account-actions">
                <button type="button" className="cd-btn cd-btn-soft" disabled={Boolean(actionState)} onClick={() => setModalOpen(false)}>
                  {labelFor(lang, "Annuler", "Cancel")}
                </button>
                <button type="submit" className="cd-btn cd-btn-primary" disabled={Boolean(actionState)}>
                  {actionState?.kind === "create"
                    ? labelFor(lang, "Ajout…", "Adding…")
                    : labelFor(lang, "Ajouter le compte", "Add account")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
