"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ClientAccountProcessModal from "./ClientAccountProcessModal";
import { resolveClientAccountConnectionUi } from "@/lib/instagram-client/client-account-connection-ui";
import { operationPendingFromConnectResult, operationPendingFromReadinessResult } from "@/lib/instagram-client/client-account-state";
import {
  clientSafeProcessErrorMessage,
  projectAddAccountProcess,
  projectConnectProcess,
  projectReadinessProcess,
  type ClientProcessMode,
} from "@/lib/instagram-client/client-account-process-projection";

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

type ActionKind = "readiness" | "connect" | "create" | "refresh" | null;

type AddPhase = "submitting" | "creating" | "refreshing" | "complete" | "error";
type ConnectPhase = "starting" | "submitting" | "polling" | "complete" | "error" | "long_running";

type ProcessModalState = {
  mode: ClientProcessMode;
  username: string;
  accountId?: string;
  addPhase?: AddPhase;
  connectPhase?: ConnectPhase;
  account?: ClientInstagramAccountView | null;
  errorMessage?: string | null;
  errorCode?: string | null;
  timedOut?: boolean;
};

const POLL_INTERVAL_MS = 8000;
const POLL_MAX_ATTEMPTS = 12;

function labelFor(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function isTerminalProcessAccount(account: ClientInstagramAccountView, mode: ClientProcessMode, lang: "fr" | "en") {
  const ui = resolveClientAccountConnectionUi(account, lang);
  if (ui.phase === "action_required" || ui.phase === "ready") return true;
  if (mode === "add_account" && ui.phase === "added") return true;
  if (mode === "connect" && ui.phase === "connected") return true;
  return false;
}

export default function ClientAccountsSection({ lang, accounts }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(accounts);
  const [formOpen, setFormOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [actionKind, setActionKind] = useState<ActionKind>(null);
  const [actionAccountId, setActionAccountId] = useState<string | null>(null);
  const [processModal, setProcessModal] = useState<ProcessModalState | null>(null);
  const [processRefreshing, setProcessRefreshing] = useState(false);
  const pollAttemptsRef = useRef(0);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setItems(accounts);
  }, [accounts]);

  const canAddAccount = useMemo(() => items.length < 5, [items.length]);
  const isEmpty = items.length === 0;
  const actionBusy = actionKind !== null;

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

  const processProjection = useMemo(() => {
    if (!processModal) return null;
    if (processModal.mode === "add_account") {
      return projectAddAccountProcess({
        lang,
        phase: processModal.addPhase || "submitting",
        account: processModal.account,
        errorMessage: processModal.errorMessage,
      });
    }
    const connectInput = {
      lang,
      phase: processModal.connectPhase || "starting",
      account: processModal.account,
      errorMessage: processModal.errorMessage,
      timedOut: processModal.timedOut,
    };
    if (processModal.mode === "check_readiness") return projectReadinessProcess(connectInput);
    return projectConnectProcess(connectInput);
  }, [lang, processModal]);

  const stopProcessPolling = useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const syncProcessAccount = useCallback(async (accountId: string) => {
    const refreshed = await refreshFromServer();
    return refreshed.find((row) => row.accountId === accountId) ?? null;
  }, [refreshFromServer]);

  useEffect(() => {
    if (!processModal || !processProjection?.isAsyncPending) {
      stopProcessPolling();
      return undefined;
    }
    if (!processModal.accountId) return undefined;

    pollAttemptsRef.current = 0;
    const accountId = processModal.accountId;
    const mode = processModal.mode;

    async function tick() {
      pollAttemptsRef.current += 1;
      try {
        const account = await syncProcessAccount(accountId);
        if (!account) return;
        setProcessModal((current) => {
          if (!current || current.accountId !== accountId) return current;
          const next: ProcessModalState = { ...current, account, connectPhase: "polling", addPhase: current.addPhase === "refreshing" ? "complete" : current.addPhase };
          if (isTerminalProcessAccount(account, mode, lang)) {
            stopProcessPolling();
            return { ...next, connectPhase: "complete", addPhase: "complete", timedOut: false };
          }
          if (pollAttemptsRef.current >= POLL_MAX_ATTEMPTS) {
            stopProcessPolling();
            return { ...next, connectPhase: "long_running", timedOut: true };
          }
          return next;
        });
      } catch {
        if (pollAttemptsRef.current >= POLL_MAX_ATTEMPTS) {
          setProcessModal((current) => current ? { ...current, connectPhase: "long_running", timedOut: true } : current);
          stopProcessPolling();
        }
      }
    }

    void tick();
    pollTimerRef.current = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      stopProcessPolling();
    };
  }, [processModal?.accountId, processModal?.mode, processProjection?.isAsyncPending, lang, stopProcessPolling, syncProcessAccount]);

  async function handleProcessRefresh() {
    if (!processModal?.accountId || processRefreshing) return;
    setProcessRefreshing(true);
    try {
      const account = await syncProcessAccount(processModal.accountId);
      if (account) {
        setProcessModal((current) => {
          if (!current) return current;
          const terminal = isTerminalProcessAccount(account, current.mode, lang);
          return {
            ...current,
            account,
            connectPhase: terminal ? "complete" : current.connectPhase,
            addPhase: terminal ? "complete" : current.addPhase,
            timedOut: terminal ? false : current.timedOut,
          };
        });
      }
    } catch (error) {
      pushMessage(error instanceof Error ? error.message : labelFor(lang, "Impossible d'actualiser.", "Could not refresh."), "error");
    } finally {
      setProcessRefreshing(false);
    }
  }

  function closeProcessModal() {
    stopProcessPolling();
    setProcessModal(null);
  }

  async function handleManualRefresh() {
    if (actionBusy) return;
    setActionKind("refresh");
    setActionAccountId("all");
    setMessage("");
    try {
      await refreshFromServer();
      pushMessage(labelFor(lang, "Liste actualisée.", "List refreshed."), "success");
    } catch (error) {
      pushMessage(error instanceof Error ? error.message : labelFor(lang, "Impossible d'actualiser les comptes.", "Could not refresh accounts."), "error");
    } finally {
      setActionKind(null);
      setActionAccountId(null);
    }
  }

  async function handleCreateAccount(event: React.FormEvent) {
    event.preventDefault();
    if (actionBusy || processModal) return;

    const draftUsername = username.trim();
    setFormOpen(false);
    setActionKind("create");
    setActionAccountId("new");
    setMessage("");
    setProcessModal({
      mode: "add_account",
      username: draftUsername.replace(/^@+/, ""),
      addPhase: "submitting",
    });

    try {
      setProcessModal((current) => current ? { ...current, addPhase: "creating" } : current);
      const response = await fetch("/api/instagram-client/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ username: draftUsername, email, password, notes }),
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        code?: string;
        data?: { account?: ClientInstagramAccountView };
      };

      if (!response.ok || payload.ok === false) {
        const safeMessage = clientSafeProcessErrorMessage(lang, payload.code, payload.error);
        setProcessModal((current) => current ? {
          ...current,
          addPhase: "error",
          errorMessage: safeMessage,
          errorCode: payload.code,
        } : current);
        return;
      }

      setProcessModal((current) => current ? { ...current, addPhase: "refreshing", accountId: payload.data?.account?.accountId } : current);
      const refreshed = await refreshFromServer();
      const account = refreshed.find((row) => row.accountId === payload.data?.account?.accountId) ?? payload.data?.account ?? null;
      if (!account?.accountId) {
        setProcessModal((current) => current ? {
          ...current,
          addPhase: "error",
          errorMessage: labelFor(lang, "Le compte n'apparaît pas encore dans votre espace. Actualisez dans un instant.", "The account is not visible yet. Refresh in a moment."),
        } : current);
        return;
      }

      setUsername("");
      setEmail("");
      setPassword("");
      setNotes("");
      setProcessModal({
        mode: "add_account",
        username: account.username,
        accountId: account.accountId,
        addPhase: "complete",
        account,
      });
    } catch (error) {
      setProcessModal((current) => current ? {
        ...current,
        addPhase: "error",
        errorMessage: error instanceof Error ? error.message : labelFor(lang, "Impossible d'ajouter le compte.", "Could not add account."),
      } : current);
    } finally {
      setActionKind(null);
      setActionAccountId(null);
    }
  }

  async function runConnectProcess(account: ClientInstagramAccountView, mode: "connect" | "check_readiness") {
    if (actionBusy || processModal) return;

    setActionKind(mode === "connect" ? "connect" : "readiness");
    setActionAccountId(account.accountId);
    setMessage("");
    setProcessModal({
      mode,
      username: account.username,
      accountId: account.accountId,
      account,
      connectPhase: "starting",
    });

    const endpoint = mode === "connect" ? "connect" : "check-readiness";

    try {
      setProcessModal((current) => current ? { ...current, connectPhase: "submitting" } : current);
      const response = await fetch(`/api/instagram-client/accounts/${encodeURIComponent(account.accountId)}/${endpoint}`, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      const payload = await response.json() as {
        ok?: boolean;
        error?: string;
        code?: string;
        data?: {
          account?: ClientInstagramAccountView;
          request_queued?: boolean;
          connected?: boolean;
        };
      };

      if (!response.ok || payload.ok === false) {
        setProcessModal((current) => current ? {
          ...current,
          connectPhase: "error",
          errorMessage: clientSafeProcessErrorMessage(lang, payload.code, payload.error || labelFor(lang, "Action indisponible.", "Action unavailable.")),
        } : current);
        return;
      }

      const refreshed = await refreshFromServer();
      let nextAccount = refreshed.find((row) => row.accountId === account.accountId)
        ?? payload.data?.account
        ?? account;

      if (mode === "connect") {
        const pending = payload.data?.request_queued === true
          || operationPendingFromConnectResult({
            request_queued: payload.data?.request_queued,
            status: (payload.data as { status?: string })?.status,
            connected: payload.data?.connected,
          });
        if (pending) nextAccount = { ...nextAccount, operationPending: true };
      } else {
        const pending = operationPendingFromReadinessResult({
          status: (payload.data as { status?: string })?.status,
          connected: payload.data?.connected,
        });
        if (pending) nextAccount = { ...nextAccount, operationPending: true };
      }

      const terminal = isTerminalProcessAccount(nextAccount, mode, lang);
      setProcessModal({
        mode,
        username: nextAccount.username,
        accountId: nextAccount.accountId,
        account: nextAccount,
        connectPhase: terminal ? "complete" : "polling",
        timedOut: false,
      });
    } catch (error) {
      setProcessModal((current) => current ? {
        ...current,
        connectPhase: "error",
        errorMessage: error instanceof Error ? error.message : labelFor(lang, "Action indisponible.", "Action unavailable."),
      } : current);
    } finally {
      setActionKind(null);
      setActionAccountId(null);
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
                disabled={actionBusy}
                onClick={() => void handleManualRefresh()}
              >
                {actionKind === "refresh"
                  ? labelFor(lang, "Actualisation…", "Refreshing…")
                  : labelFor(lang, "Actualiser", "Refresh")}
              </button>
            ) : null}
            {canAddAccount && !isEmpty ? (
              <button type="button" className="cd-btn cd-btn-primary cd-btn-compact" disabled={Boolean(processModal)} onClick={() => setFormOpen(true)}>
                {labelFor(lang, "Ajouter un compte Instagram", "Add Instagram account")}
              </button>
            ) : null}
          </div>
        </div>

        {isEmpty ? (
          <div className="cd-accounts-empty">
            <p>{labelFor(lang, "Aucun compte Instagram ajouté.", "No Instagram account added yet.")}</p>
            <button type="button" className="cd-btn cd-btn-primary" disabled={Boolean(processModal)} onClick={() => setFormOpen(true)}>
              {labelFor(lang, "Ajouter un compte Instagram", "Add Instagram account")}
            </button>
          </div>
        ) : (
          <div className="cd-accounts-list">
            {items.map((account) => {
              const busy = actionAccountId === account.accountId;
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
                        disabled={actionBusy}
                        onClick={() => void handleManualRefresh()}
                      >
                        {actionKind === "refresh"
                          ? labelFor(lang, "Actualisation…", "Refreshing…")
                          : labelFor(lang, "Actualiser", "Refresh")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`cd-btn cd-btn-soft cd-account-state cd-account-state-${ui.readinessTone}`}
                      disabled={busy || ui.readinessDisabled || Boolean(processModal)}
                      onClick={() => void runConnectProcess(account, "check_readiness")}
                    >
                      {busy && actionKind === "readiness"
                        ? labelFor(lang, "Vérification…", "Checking…")
                        : ui.readinessLabel}
                    </button>
                    <button
                      type="button"
                      className={`cd-btn cd-account-state cd-account-state-${ui.connectTone}`}
                      disabled={busy || ui.connectDisabled || Boolean(processModal)}
                      onClick={() => void runConnectProcess(account, "connect")}
                    >
                      {busy && actionKind === "connect"
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

      {formOpen ? (
        <div className="cd-progress-overlay" role="presentation" onMouseDown={() => !actionBusy && setFormOpen(false)}>
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
                <button type="button" className="cd-btn cd-btn-soft" disabled={actionBusy} onClick={() => setFormOpen(false)}>
                  {labelFor(lang, "Annuler", "Cancel")}
                </button>
                <button type="submit" className="cd-btn cd-btn-primary" disabled={actionBusy}>
                  {actionKind === "create"
                    ? labelFor(lang, "Ajout…", "Adding…")
                    : labelFor(lang, "Ajouter le compte", "Add account")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <ClientAccountProcessModal
        open={Boolean(processModal)}
        lang={lang}
        username={processModal?.username}
        projection={processProjection}
        refreshing={processRefreshing}
        onRefresh={() => void handleProcessRefresh()}
        onClose={closeProcessModal}
      />
    </>
  );
}
