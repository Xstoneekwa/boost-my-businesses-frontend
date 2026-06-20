"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  operationPending?: boolean;
};

type Props = {
  lang: "fr" | "en";
  accounts: ClientInstagramAccountView[];
};

type ActionState = {
  accountId: string;
  kind: "readiness" | "connect" | "create" | "refresh";
} | null;

const POLL_INTERVAL_MS = 8000;
const POLL_MAX_ATTEMPTS = 12;

function labelFor(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function mergeAccountRow(
  current: ClientInstagramAccountView,
  next: Partial<ClientInstagramAccountView> & { accountId: string },
): ClientInstagramAccountView {
  return {
    ...current,
    ...next,
    accountId: next.accountId,
  };
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
  const [polling, setPolling] = useState(false);
  const pollAttemptsRef = useRef(0);

  useEffect(() => {
    setItems(accounts);
  }, [accounts]);

  const canAddAccount = useMemo(() => items.length < 5, [items.length]);
  const isEmpty = items.length === 0;

  function pushMessage(text: string, tone: "success" | "error" = "success") {
    setMessage(text);
    setMessageTone(tone);
  }

  const refreshFromServer = useCallback(async () => {
    const response = await fetch("/api/instagram-client/accounts", {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json() as {
      ok?: boolean;
      error?: string;
      data?: { accounts?: ClientInstagramAccountView[] };
    };
    if (!response.ok || payload.ok === false || !Array.isArray(payload.data?.accounts)) {
      throw new Error(payload.error || labelFor(lang, "Impossible d'actualiser les comptes.", "Could not refresh accounts."));
    }
    setItems(payload.data.accounts);
    router.refresh();
    return payload.data.accounts;
  }, [lang, router]);

  const startBoundedPolling = useCallback(() => {
    pollAttemptsRef.current = 0;
    setPolling(true);
  }, []);

  useEffect(() => {
    if (!polling) return undefined;

    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      pollAttemptsRef.current += 1;
      try {
        await refreshFromServer();
      } catch {
        // Keep polling until the bounded window ends.
      }
      if (pollAttemptsRef.current >= POLL_MAX_ATTEMPTS) {
        setPolling(false);
      }
    };

    void tick();
    const intervalId = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [polling, refreshFromServer]);

  function applyServerAccount(account: ClientInstagramAccountView | null | undefined) {
    if (!account?.accountId) return null;
    setItems((current) => {
      const existing = current.find((row) => row.accountId === account.accountId);
      if (!existing) return [...current, account];
      return current.map((row) => (row.accountId === account.accountId ? mergeAccountRow(row, account) : row));
    });
    return account;
  }

  function messageForAccount(account: ClientInstagramAccountView | null | undefined) {
    if (!account) {
      return labelFor(lang, "État mis à jour.", "Status updated.");
    }
    const ui = resolveClientAccountConnectionUi(account, lang);
    if (ui.phase === "preparing") {
      return labelFor(lang, "Préparation en cours. Nous vérifions votre compte.", "Setup in progress. We are verifying your account.");
    }
    if (ui.phase === "ready") {
      return labelFor(lang, "Compte connecté et prêt.", "Account connected and ready.");
    }
    if (ui.phase === "action_required") {
      return labelFor(lang, "Une vérification est nécessaire.", "A verification is required.");
    }
    if (ui.phase === "connected") {
      return labelFor(lang, "Compte connecté.", "Account connected.");
    }
    return labelFor(lang, "Compte Instagram ajouté.", "Instagram account added.");
  }

  async function handleManualRefresh() {
    if (actionState) return;
    setActionState({ accountId: "all", kind: "refresh" });
    setMessage("");
    try {
      const refreshed = await refreshFromServer();
      const stillPending = refreshed.some((account) => resolveClientAccountConnectionUi(account, lang).isAsyncPending);
      if (stillPending) startBoundedPolling();
      pushMessage(labelFor(lang, "Liste actualisée.", "List refreshed."), "success");
    } catch (error) {
      pushMessage(error instanceof Error ? error.message : labelFor(lang, "Impossible d'actualiser les comptes.", "Could not refresh accounts."), "error");
    } finally {
      setActionState(null);
    }
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

      const refreshed = await refreshFromServer();
      const account = refreshed.find((row) => row.accountId === payload.data?.account?.accountId)
        ?? applyServerAccount(payload.data?.account);
      setModalOpen(false);
      setUsername("");
      setEmail("");
      setPassword("");
      setNotes("");
      pushMessage(messageForAccount(account ?? payload.data?.account ?? null), "success");
      if (account && resolveClientAccountConnectionUi(account, lang).isAsyncPending) {
        startBoundedPolling();
      }
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
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        data?: { account?: ClientInstagramAccountView; message?: string; connected?: boolean };
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || labelFor(lang, "Impossible de vérifier l'état.", "Could not check readiness."));
      }

      const refreshed = await refreshFromServer();
      const account = refreshed.find((row) => row.accountId === accountId)
        ?? applyServerAccount(payload.data?.account);
      pushMessage(messageForAccount(account ?? null), "success");
      if (account && resolveClientAccountConnectionUi(account, lang).isAsyncPending) {
        startBoundedPolling();
      }
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
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        data?: { account?: ClientInstagramAccountView; message?: string; connected?: boolean; request_queued?: boolean };
      };
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || labelFor(lang, "Connexion indisponible.", "Connect unavailable."));
      }

      const refreshed = await refreshFromServer();
      const nextAccount = refreshed.find((row) => row.accountId === account.accountId)
        ?? applyServerAccount(payload.data?.account);
      pushMessage(messageForAccount(nextAccount ?? null), "success");
      if (nextAccount && resolveClientAccountConnectionUi(nextAccount, lang).isAsyncPending) {
        startBoundedPolling();
      }
    } catch (error) {
      pushMessage(error instanceof Error ? error.message : labelFor(lang, "Connexion indisponible.", "Connect unavailable."), "error");
    } finally {
      setActionState(null);
    }
  }

  const showGlobalRefresh = useMemo(
    () => items.some((account) => resolveClientAccountConnectionUi(account, lang).showRefresh),
    [items, lang],
  );

  return (
    <>
      <section className="cd-card cd-accounts-panel">
        <div className="cd-card-hd">
          <h3>{labelFor(lang, "Mes comptes Instagram", "My Instagram accounts")}</h3>
          <div className="cd-accounts-header-actions">
            {showGlobalRefresh ? (
              <button
                type="button"
                className="cd-btn cd-btn-soft cd-btn-compact"
                disabled={Boolean(actionState)}
                onClick={() => void handleManualRefresh()}
              >
                {actionState?.kind === "refresh"
                  ? labelFor(lang, "Actualisation…", "Refreshing…")
                  : labelFor(lang, "Actualiser", "Refresh")}
              </button>
            ) : null}
            {canAddAccount && !isEmpty ? (
              <button type="button" className="cd-btn cd-btn-primary cd-btn-compact" onClick={() => setModalOpen(true)}>
                {labelFor(lang, "Ajouter un compte Instagram", "Add Instagram account")}
              </button>
            ) : null}
          </div>
        </div>

        {isEmpty ? (
          <div className="cd-accounts-empty">
            <p>{labelFor(lang, "Aucun compte Instagram ajouté.", "No Instagram account added yet.")}</p>
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
                    {ui.subtext ? <p className="cd-account-subtext">{ui.subtext}</p> : null}
                  </div>
                  <div className="cd-account-actions">
                    {ui.showRefresh ? (
                      <button
                        type="button"
                        className="cd-btn cd-btn-soft cd-btn-compact"
                        disabled={Boolean(actionState)}
                        onClick={() => void handleManualRefresh()}
                      >
                        {actionState?.kind === "refresh"
                          ? labelFor(lang, "Actualisation…", "Refreshing…")
                          : labelFor(lang, "Actualiser", "Refresh")}
                      </button>
                    ) : null}
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
                "Ajoutez votre compte Instagram. Nous préparons ensuite la connexion automatiquement — aucune configuration technique de votre côté.",
                "Add your Instagram account. We then prepare the connection automatically — no technical setup on your side.",
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
