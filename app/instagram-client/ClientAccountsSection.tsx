"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ClientAccountProcessModal from "./ClientAccountProcessModal";
import ClientVerificationModal from "./ClientVerificationModal";
import ClientInstagramOnboardingWizard from "./ClientInstagramOnboardingWizard";
import { resolveClientAccountConnectionUi } from "@/lib/instagram-client/client-account-connection-ui";
import type { ClientConnectProgressSnapshot } from "@/lib/instagram-client/connect-progress-projection";
import { operationPendingFromConnectResult, operationPendingFromReadinessResult } from "@/lib/instagram-client/client-account-state";
import {
  clientSafeProcessErrorMessage,
  projectAddAccountProcess,
  projectConnectProcess,
  projectReadinessProcess,
  type ClientProcessMode,
} from "@/lib/instagram-client/client-account-process-projection";
import { parseClientApiResponse } from "@/lib/instagram-client/read-api-response";
import { isActiveClientConnectStatus } from "@/lib/instagram-client/connect-operation-state";

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
  clientReadinessStatus?: string | null;
  activeConnectStatus?: string | null;
  operationPending?: boolean;
};

type Props = {
  lang: "fr" | "en";
  accounts: ClientInstagramAccountView[];
  displayMode?: "accounts" | "add_only";
};

type ActionKind = "readiness" | "connect" | "refresh" | "cancel" | null;

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
  connectProgress?: ClientConnectProgressSnapshot | null;
  connectOperationToken?: string | null;
};

const TERMINAL_CONNECT_STATUSES = new Set(["connected", "failed", "blocked", "not_created"]);

const POLL_INTERVAL_MS = 8000;
const POLL_MAX_ATTEMPTS = 12;

function labelFor(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function isTerminalConnectProgress(snapshot: ClientConnectProgressSnapshot | null | undefined) {
  if (!snapshot) return false;
  return TERMINAL_CONNECT_STATUSES.has(snapshot.connect_status);
}

function isTerminalProcessAccount(
  account: ClientInstagramAccountView,
  mode: ClientProcessMode,
  lang: "fr" | "en",
  connectProgress?: ClientConnectProgressSnapshot | null,
) {
  if (mode === "connect" && connectProgress) {
    if (connectProgress.connect_status === "connected") return true;
    if (connectProgress.failed) return true;
    if (connectProgress.connect_status === "verification_required") return false;
    if (connectProgress.connect_status === "verification_code_submitted") return false;
    if (connectProgress.connect_status === "verification_code_accepted") return false;
    if (connectProgress.connect_status === "verification_resume_active") return false;
  }
  const ui = resolveClientAccountConnectionUi(account, lang);
  if (ui.phase === "action_required" || ui.phase === "ready") return true;
  if (mode === "add_account" && ui.phase === "added") return true;
  if (mode === "connect" && ui.phase === "connected") return true;
  return false;
}

export default function ClientAccountsSection({ lang, accounts, displayMode = "accounts" }: Props) {
  const router = useRouter();
  const [items, setItems] = useState(accounts);
  const [formOpen, setFormOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [actionKind, setActionKind] = useState<ActionKind>(null);
  const [actionAccountId, setActionAccountId] = useState<string | null>(null);
  const [processModal, setProcessModal] = useState<ProcessModalState | null>(null);
  const [processRefreshing, setProcessRefreshing] = useState(false);
  const [verificationDismissed, setVerificationDismissed] = useState(false);
  const [entitlementReady, setEntitlementReady] = useState<boolean | null>(null);
  const [onboardingResumable, setOnboardingResumable] = useState(false);
  const [cancelConfirmAccount, setCancelConfirmAccount] = useState<ClientInstagramAccountView | null>(null);
  const pollAttemptsRef = useRef(0);
  const pollTimerRef = useRef<number | null>(null);
  const connectHydratedRef = useRef(false);

  useEffect(() => {
    setItems(accounts);
    connectHydratedRef.current = false;
  }, [accounts]);

  useEffect(() => {
    let cancelled = false;
    async function loadEntitlementGate() {
      try {
        const response = await fetch("/api/instagram-client/entitlements/reserved", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const payload = await response.json() as {
          ok?: boolean;
          data?: { can_add_account_directly?: boolean };
        };
        if (cancelled) return;
        setEntitlementReady(Boolean(payload.ok && payload.data?.can_add_account_directly));
      } catch {
        if (!cancelled) setEntitlementReady(false);
      }
    }
    void loadEntitlementGate();
    return () => { cancelled = true; };
  }, [items.length]);

  useEffect(() => {
    let cancelled = false;
    async function loadOnboardingResume() {
      try {
        const response = await fetch("/api/instagram-client/onboarding", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        const payload = await response.json() as {
          ok?: boolean;
          data?: { onboarding?: { status?: string; currentStep?: string } | null };
        };
        const onboarding = payload.ok ? payload.data?.onboarding : null;
        const resumable = Boolean(onboarding && onboarding.status !== "completed");
        if (cancelled) return;
        setOnboardingResumable(resumable);
        if (resumable) setFormOpen(true);
      } catch {
        if (!cancelled) setOnboardingResumable(false);
      }
    }
    void loadOnboardingResume();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!entitlementReady) return;
    const onboardingRequested = new URLSearchParams(window.location.search).get("onboarding") === "1";
    if (!onboardingRequested && items.length > 0) return;

    setFormOpen(true);
    if (onboardingRequested) {
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.delete("onboarding");
      router.replace(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, { scroll: false });
    }
  }, [entitlementReady, items.length, router]);

  const actionBusy = actionKind !== null;
  const isEmpty = items.length === 0;
  const addOnly = displayMode === "add_only";

  function handleAddAccountClick() {
    if (entitlementReady || onboardingResumable) {
      setFormOpen(true);
      return;
    }
    router.push("/instagram-client/choose-plan");
  }

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

  async function confirmCancelRestart() {
    if (!cancelConfirmAccount) return;
    setActionKind("cancel");
    setActionAccountId(cancelConfirmAccount.accountId);
    try {
      const response = await fetch(
        `/api/instagram-client/accounts/${encodeURIComponent(cancelConfirmAccount.accountId)}/connect/cancel-attempt`,
        { method: "POST", headers: { Accept: "application/json" } },
      );
      const payload = await parseClientApiResponse<{ canceled?: boolean }>(response, lang);
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || payload.error || labelFor(lang, "Impossible d'annuler la tentative.", "Could not cancel the attempt."));
      }
      stopProcessPolling();
      setProcessModal(null);
      setVerificationDismissed(true);
      connectHydratedRef.current = false;
      await refreshFromServer();
      setMessage(labelFor(lang, "Tentative annulée. Vous pouvez vérifier la préparation.", "Attempt canceled. You can check readiness."));
      setMessageTone("success");
    } catch (cancelError) {
      setMessage(cancelError instanceof Error ? cancelError.message : labelFor(lang, "Impossible d'annuler la tentative.", "Could not cancel the attempt."));
      setMessageTone("error");
    } finally {
      setCancelConfirmAccount(null);
      setActionKind(null);
      setActionAccountId(null);
    }
  }

  const processProjection = useMemo(() => {
    if (!processModal) return null;
    if (processModal.mode === "add_account") {
      return projectAddAccountProcess({
        lang,
        phase: processModal.addPhase || "submitting",
        account: processModal.account,
        errorMessage: processModal.errorMessage,
        errorCode: processModal.errorCode,
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

  const syncConnectProgress = useCallback(async (accountId: string, connectOperationToken?: string | null) => {
    const tokenQuery = (connectOperationToken || "").trim()
      ? `&connect_operation_token=${encodeURIComponent((connectOperationToken || "").trim())}`
      : "";
    const response = await fetch(
      `/api/instagram-client/accounts/${encodeURIComponent(accountId)}/connect/progress?lang=${lang}${tokenQuery}`,
      { headers: { Accept: "application/json" }, cache: "no-store" },
    );
    const payload = await parseClientApiResponse<ClientConnectProgressSnapshot>(response, lang);
    if (!response.ok || payload.ok === false || !payload.data) {
      throw new Error(payload.message || payload.error || labelFor(lang, "Impossible de charger la progression.", "Could not load progress."));
    }
    return payload.data;
  }, [lang]);

  const resumeActiveConnect = useCallback(async (account: ClientInstagramAccountView, openVerification = false) => {
    const progress = await syncConnectProgress(account.accountId);
    if (!isActiveClientConnectStatus(progress.connect_status)) {
      setItems((current) => current.map((row) => (
        row.accountId === account.accountId
          ? {
              ...row,
              activeConnectStatus: null,
              operationPending: false,
            }
          : row
      )));
      setProcessModal((current) => (current?.accountId === account.accountId ? null : current));
      setVerificationDismissed(true);
      return null;
    }
    setItems((current) => current.map((row) => (
      row.accountId === account.accountId
        ? {
            ...row,
            activeConnectStatus: progress.connect_status,
            operationPending: true,
            clientReadinessStatus: row.clientReadinessStatus === "ready_to_connect" ? null : row.clientReadinessStatus,
          }
        : row
    )));
    setProcessModal({
      mode: "connect",
      username: account.username,
      accountId: account.accountId,
      account: {
        ...account,
        activeConnectStatus: progress.connect_status,
        operationPending: true,
      },
      connectPhase: "polling",
      connectProgress: progress,
      timedOut: false,
    });
    if (openVerification || progress.connect_status === "verification_required") {
      setVerificationDismissed(false);
    }
    return progress;
  }, [syncConnectProgress]);

  useEffect(() => {
    if (processModal || connectHydratedRef.current) return undefined;

    const candidate = items.find((row) => isActiveClientConnectStatus(row.activeConnectStatus));
    if (!candidate) return undefined;

    connectHydratedRef.current = true;
    let cancelled = false;

    void resumeActiveConnect(candidate, true).catch(() => {
      if (!cancelled) connectHydratedRef.current = false;
    });

    return () => {
      cancelled = true;
    };
  }, [items, processModal, resumeActiveConnect]);

  const syncProcessAccount = useCallback(async (accountId: string) => {
    const refreshed = await refreshFromServer();
    return refreshed.find((row) => row.accountId === accountId) ?? null;
  }, [refreshFromServer]);

  const verificationModalOpen = Boolean(
    processModal?.mode === "connect"
    && (
      processModal.connectProgress?.connect_status === "verification_required"
      || processModal.connectProgress?.connect_status === "verification_code_accepted"
      || processModal.connectProgress?.connect_status === "verification_resume_active"
    )
    && processModal.connectProgress.action_required
    && !verificationDismissed,
  );

  useEffect(() => {
    const connectPollingActive = processModal?.mode === "connect"
      && (
        processModal.connectPhase === "polling"
        || processModal.connectPhase === "long_running"
        || isActiveClientConnectStatus(processModal.connectProgress?.connect_status)
      )
      && !isTerminalConnectProgress(processModal.connectProgress);
    if (!processModal || (!processProjection?.isAsyncPending && !connectPollingActive)) {
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
        let connectProgress = processModal?.connectProgress ?? null;
        if (mode === "connect") {
          connectProgress = await syncConnectProgress(accountId, processModal?.connectOperationToken);
        }
        const account = await syncProcessAccount(accountId);
        if (!account) return;
        setProcessModal((current) => {
          if (!current || current.accountId !== accountId) return current;
          const next: ProcessModalState = {
            ...current,
            account,
            connectProgress: mode === "connect" ? connectProgress : current.connectProgress,
            connectPhase: isActiveClientConnectStatus(connectProgress?.connect_status) ? "polling" : "polling",
            addPhase: current.addPhase === "refreshing" ? "complete" : current.addPhase,
          };
          if (mode === "connect" && connectProgress && !isActiveClientConnectStatus(connectProgress.connect_status)) {
            stopProcessPolling();
            setVerificationDismissed(true);
            return null;
          }
          if (mode === "connect" && connectProgress?.connect_status === "verification_required") {
            setVerificationDismissed(false);
          }
          if (mode === "connect" && connectProgress) {
            const activeStatus = connectProgress.connect_status;
            setItems((currentItems) => currentItems.map((row) => (
              row.accountId === accountId
                ? {
                    ...row,
                    activeConnectStatus: isActiveClientConnectStatus(activeStatus) ? activeStatus : row.activeConnectStatus,
                    operationPending: isActiveClientConnectStatus(activeStatus),
                  }
                : row
            )));
          }
          if (isTerminalProcessAccount(account, mode, lang, connectProgress)) {
            stopProcessPolling();
            return { ...next, connectPhase: "complete", addPhase: "complete", timedOut: false };
          }
          if (mode === "connect" && isTerminalConnectProgress(connectProgress)) {
            stopProcessPolling();
            return { ...next, connectPhase: "complete", timedOut: false };
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
  }, [processModal?.accountId, processModal?.mode, processModal?.connectProgress, processProjection?.isAsyncPending, lang, stopProcessPolling, syncConnectProgress, syncProcessAccount]);

  async function handleProcessRefresh() {
    if (!processModal?.accountId || processRefreshing) return;
    setProcessRefreshing(true);
    try {
      const accountId = processModal.accountId;
      const connectProgress = processModal.mode === "connect"
        ? await syncConnectProgress(accountId, processModal.connectOperationToken)
        : processModal.connectProgress ?? null;
      const account = await syncProcessAccount(accountId);
      if (account) {
        setProcessModal((current) => {
          if (!current) return current;
          const terminal = isTerminalProcessAccount(account, current.mode, lang, connectProgress);
          if (connectProgress?.connect_status === "verification_required") {
            setVerificationDismissed(false);
          }
          return {
            ...current,
            account,
            connectProgress: current.mode === "connect" ? connectProgress : current.connectProgress,
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
    if (processModal?.connectProgress?.connect_status === "verification_required") {
      setVerificationDismissed(true);
    } else {
      setVerificationDismissed(false);
    }
    setProcessModal(null);
  }

  async function handleReopenVerification(account: ClientInstagramAccountView) {
    if (actionBusy) return;
    setActionKind("connect");
    setActionAccountId(account.accountId);
    try {
      await resumeActiveConnect(account, true);
    } catch (error) {
      pushMessage(error instanceof Error ? error.message : labelFor(lang, "Impossible de rouvrir la vérification.", "Could not reopen verification."), "error");
    } finally {
      setActionKind(null);
      setActionAccountId(null);
    }
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

  async function runConnectProcess(account: ClientInstagramAccountView, mode: "connect" | "check_readiness") {
    if (actionBusy || processModal) return;

    if (mode === "connect") {
      const confirmed = window.confirm(
        labelFor(
          lang,
          "Vous allez lancer la connexion Instagram sur le téléphone déjà préparé pour votre compte. Cette étape démarre la connexion réelle. Continuer ?",
          "You are about to start the real Instagram connection on the phone already prepared for your account. Continue?",
        ),
      );
      if (!confirmed) return;
    }

    setActionKind(mode === "connect" ? "connect" : "readiness");
    setActionAccountId(account.accountId);
    setMessage("");
    setVerificationDismissed(false);
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
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          mode === "check_readiness"
            ? { dry_run: true, mode: "readiness_only" }
            : { dry_run: false, mode: "connect_enqueue" },
        ),
      });
      type ConnectResponseData = {
        account?: ClientInstagramAccountView & { clientReadinessStatus?: string };
        request_queued?: boolean;
        connected?: boolean;
        status?: string;
        connectStatus?: string;
        message?: string;
        client_readiness_status?: string;
        connect_operation_token?: string;
      };

      const payload = await parseClientApiResponse<ConnectResponseData>(response, lang);

      const responseData: ConnectResponseData = payload.data ?? {};
      const connectStatus = typeof payload.status === "string" ? payload.status : responseData.connectStatus;

      if (!response.ok || payload.ok === false) {
        const safeMessage = responseData?.message
          || clientSafeProcessErrorMessage(lang, payload.code, payload.message || payload.error || labelFor(lang, "Action indisponible.", "Action unavailable."));
        setProcessModal((current) => current ? {
          ...current,
          connectPhase: "error",
          errorMessage: safeMessage,
          connectProgress: null,
        } : current);
        if (mode === "connect" && payload.code === "connect_readiness_not_satisfied") {
          pushMessage(safeMessage, "error");
        }
        return;
      }

      const refreshed = await refreshFromServer();
      const readinessStatus = responseData?.status
        || responseData?.client_readiness_status
        || payload.client_readiness_status
        || responseData?.account?.clientReadinessStatus
        || null;
      let nextAccount = refreshed.find((row) => row.accountId === account.accountId)
        ?? responseData?.account
        ?? account;
      if (readinessStatus) {
        nextAccount = { ...nextAccount, clientReadinessStatus: readinessStatus };
        setItems((current) => current.map((row) => (
          row.accountId === nextAccount.accountId
            ? { ...row, clientReadinessStatus: readinessStatus }
            : row
        )));
      }

      if (mode === "connect") {
        const pending = responseData?.request_queued === true
          || operationPendingFromConnectResult({
            request_queued: responseData?.request_queued,
            status: (responseData as { status?: string })?.status,
            connectStatus: connectStatus || responseData?.connectStatus,
            connected: responseData?.connected,
          });
        if (pending) nextAccount = { ...nextAccount, operationPending: true };
        const connectOperationToken = typeof responseData?.connect_operation_token === "string"
          ? responseData.connect_operation_token.trim()
          : "";
        let connectProgress: ClientConnectProgressSnapshot | null = null;
        try {
          connectProgress = await syncConnectProgress(account.accountId, connectOperationToken || null);
        } catch {
          connectProgress = null;
        }
        const terminal = connectProgress
          ? isTerminalConnectProgress(connectProgress) || isTerminalProcessAccount(nextAccount, mode, lang, connectProgress)
          : isTerminalProcessAccount(nextAccount, mode, lang);
        setProcessModal({
          mode,
          username: nextAccount.username,
          accountId: nextAccount.accountId,
          account: nextAccount,
          connectPhase: terminal ? "complete" : "polling",
          connectProgress,
          connectOperationToken: connectOperationToken || null,
          timedOut: false,
        });
        return;
      }

      const pending = operationPendingFromReadinessResult({
        status: readinessStatus || (payload.data as { status?: string })?.status,
        connected: payload.data?.connected,
      });
      if (pending) nextAccount = { ...nextAccount, operationPending: true };

      const terminal = mode === "check_readiness"
        ? true
        : isTerminalProcessAccount(nextAccount, mode, lang);
      setProcessModal({
        mode,
        username: nextAccount.username,
        accountId: nextAccount.accountId,
        account: nextAccount,
        connectPhase: terminal ? "complete" : "polling",
        timedOut: false,
      });
    } catch {
      setProcessModal((current) => current ? {
        ...current,
        connectPhase: "error",
        errorMessage: labelFor(lang, "La connexion n'a pas pu être lancée pour le moment.", "Connection could not be started right now."),
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
            {!addOnly && showGlobalRefresh ? (
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
            {addOnly || !isEmpty ? (
              <button type="button" className="cd-btn cd-btn-primary cd-btn-compact" disabled={Boolean(processModal) || entitlementReady === null} onClick={handleAddAccountClick}>
                {labelFor(lang, "Ajouter un compte Instagram", "Add Instagram account")}
              </button>
            ) : null}
          </div>
        </div>

        {addOnly ? null : isEmpty ? (
          <div className="cd-accounts-empty">
            <p>{labelFor(lang, "Aucun compte Instagram ajouté.", "No Instagram account added yet.")}</p>
            <button type="button" className="cd-btn cd-btn-primary" disabled={Boolean(processModal) || entitlementReady === null} onClick={handleAddAccountClick}>
              {labelFor(lang, "Ajouter un compte Instagram", "Add Instagram account")}
            </button>
          </div>
        ) : (
          <div className="cd-accounts-list">
            {items.map((account) => {
              const busy = actionAccountId === account.accountId;
              const ui = resolveClientAccountConnectionUi({
                ...account,
                clientReadinessStatus: account.clientReadinessStatus,
                activeConnectStatus: account.activeConnectStatus,
                operationPending: account.operationPending,
              }, lang);
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
                    {ui.showVerificationReopen ? (
                      <button
                        type="button"
                        className="cd-btn cd-btn-primary cd-btn-compact"
                        disabled={busy || Boolean(processModal)}
                        onClick={() => void handleReopenVerification(account)}
                      >
                        {ui.verificationReopenLabel}
                      </button>
                    ) : null}
                    {ui.connectPrimary ? (
                      <button
                        type="button"
                        className={`cd-btn cd-btn-primary cd-account-state cd-account-state-${ui.connectTone}`}
                        disabled={busy || ui.connectDisabled || Boolean(processModal)}
                        onClick={() => void runConnectProcess(account, "connect")}
                      >
                        {busy && actionKind === "connect"
                          ? labelFor(lang, "Connexion…", "Connecting…")
                          : ui.connectLabel}
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
                    {ui.showRecheckReadiness ? (
                      <button
                        type="button"
                        className="cd-btn cd-btn-soft cd-btn-compact"
                        disabled={busy || Boolean(processModal)}
                        onClick={() => void runConnectProcess(account, "check_readiness")}
                      >
                        {busy && actionKind === "readiness"
                          ? labelFor(lang, "Vérification…", "Checking…")
                          : ui.recheckReadinessLabel}
                      </button>
                    ) : null}
                    {!ui.connectPrimary ? (
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
                    ) : null}
                    {ui.showCancelRestart ? (
                      <button
                        type="button"
                        className="cd-btn cd-btn-soft cd-btn-compact"
                        disabled={busy || Boolean(processModal)}
                        onClick={() => setCancelConfirmAccount(account)}
                      >
                        {busy && actionKind === "cancel"
                          ? labelFor(lang, "Annulation…", "Canceling…")
                          : ui.cancelRestartLabel}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {message ? <p className={`cd-accounts-message ${messageTone}`}>{message}</p> : null}
      </section>

      <ClientInstagramOnboardingWizard
        open={formOpen}
        lang={lang}
        onClose={() => setFormOpen(false)}
        onCompleted={async () => {
          setOnboardingResumable(false);
          await refreshFromServer();
          pushMessage(labelFor(lang, "Ciblage enregistré. La connexion Instagram reste à effectuer.", "Targeting saved. Instagram connection is still pending."));
        }}
      />

      <ClientAccountProcessModal
        open={Boolean(processModal)}
        lang={lang}
        username={processModal?.username}
        projection={processProjection}
        connectProgress={processModal?.mode === "connect" ? processModal.connectProgress ?? null : null}
        refreshing={processRefreshing}
        onRefresh={() => void handleProcessRefresh()}
        onClose={closeProcessModal}
        onOpenVerification={() => setVerificationDismissed(false)}
      />

      <ClientVerificationModal
        open={verificationModalOpen}
        lang={lang}
        username={processModal?.username ?? ""}
        accountId={processModal?.accountId ?? ""}
        action={processModal?.connectProgress?.action_required ?? null}
        connectStatus={processModal?.connectProgress?.connect_status ?? null}
        onClose={() => setVerificationDismissed(true)}
        onSubmitted={() => {
          if (!processModal?.accountId) return;
          void syncConnectProgress(processModal.accountId, processModal.connectOperationToken).then((snapshot) => {
            setProcessModal((current) => current ? { ...current, connectProgress: snapshot } : current);
          });
          void syncProcessAccount(processModal.accountId);
        }}
      />

      {cancelConfirmAccount ? (
        <div className="cd-progress-overlay" role="presentation" onMouseDown={() => !actionBusy && setCancelConfirmAccount(null)}>
          <section
            className="cd-progress-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cd-cancel-restart-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h3 id="cd-cancel-restart-title">
              {labelFor(lang, "Annuler et recommencer ?", "Cancel and start over?")}
            </h3>
            <p className="cd-connect-copy">
              {labelFor(
                lang,
                "La tentative de connexion en cours sera annulée. Vous pourrez ensuite vérifier la préparation avant de reconnecter le compte.",
                "The current connection attempt will be canceled. You can then check readiness before connecting the account again.",
              )}
            </p>
            <div className="cd-connect-actions">
              <button
                type="button"
                className="cd-btn cd-btn-primary"
                disabled={actionBusy}
                onClick={() => void confirmCancelRestart()}
              >
                {actionKind === "cancel"
                  ? labelFor(lang, "Annulation…", "Canceling…")
                  : labelFor(lang, "Annuler et recommencer", "Cancel and start over")}
              </button>
              <button
                type="button"
                className="cd-btn cd-btn-soft"
                disabled={actionBusy}
                onClick={() => setCancelConfirmAccount(null)}
              >
                {labelFor(lang, "Retour", "Back")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
