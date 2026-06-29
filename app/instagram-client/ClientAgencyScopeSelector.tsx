"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientInstagramAccountView } from "./ClientAccountsSection";
import type { AgencyAccountFilter } from "@/lib/instagram-client/client-agency-overview-helpers";
import { matchesAgencyAccountSearch } from "@/lib/instagram-client/client-agency-overview-helpers";

type Lang = "fr" | "en";

export type OverviewScope = "agency" | string;

type Props = {
  lang: Lang;
  accounts: ClientInstagramAccountView[];
  scope: OverviewScope;
  onScopeChange: (scope: OverviewScope) => void;
  storageKey?: string;
};

const COPY = {
  fr: {
    scopeLabel: "Afficher les données de",
    agency: "Tous les comptes",
    agencyView: "Vue Agence",
    accountPrefix: "Compte",
    search: "Rechercher @username…",
    filterAll: "Tous les statuts",
    filterConnected: "Connectés",
    filterPreparing: "Préparation en cours",
    filterAction: "Action requise",
    noMatch: "Aucun compte ne correspond à votre recherche.",
    open: "Changer de contexte",
  },
  en: {
    scopeLabel: "Show data for",
    agency: "All accounts",
    agencyView: "Agency view",
    accountPrefix: "Account",
    search: "Search @username…",
    filterAll: "All statuses",
    filterConnected: "Connected",
    filterPreparing: "Setup in progress",
    filterAction: "Action required",
    noMatch: "No account matches your search.",
    open: "Change context",
  },
} as const;

function scopeDisplayLabel(scope: OverviewScope, accounts: ClientInstagramAccountView[], lang: Lang) {
  const t = COPY[lang];
  if (scope === "agency") return `${t.agencyView} — ${t.agency}`;
  const account = accounts.find((row) => row.accountId === scope);
  const handle = account?.username?.replace(/^@+/, "") ?? (lang === "fr" ? "compte" : "account");
  return `${t.accountPrefix} — @${handle}`;
}

export default function ClientAgencyScopeSelector(props: Props) {
  const { lang, accounts, scope, onScopeChange, storageKey } = props;
  const t = COPY[lang];
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AgencyAccountFilter>("all");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useMemo(() => `agency-scope-list-${Math.random().toString(36).slice(2)}`, []);

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = window.sessionStorage.getItem(storageKey);
      if (!saved) return;
      if (saved === "agency" || accounts.some((row) => row.accountId === saved)) {
        onScopeChange(saved);
      }
    } catch {
      // Ignore storage errors.
    }
  }, [accounts, onScopeChange, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      window.sessionStorage.setItem(storageKey, scope);
    } catch {
      // Ignore storage errors.
    }
  }, [scope, storageKey]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filteredAccounts = useMemo(() => {
    return accounts.filter((account) => {
      if (!matchesAgencyAccountSearch(account.username, search)) return false;
      if (filter === "connected") return account.connected;
      if (filter === "preparing") return !account.connected;
      if (filter === "action_required") {
        return account.loginStatus === "verification_pending"
          || account.provisioningStatus === "login_verification_pending";
      }
      return true;
    });
  }, [accounts, filter, search]);

  function selectScope(next: OverviewScope) {
    onScopeChange(next);
    setOpen(false);
  }

  return (
    <div className="cd-agency-scope-bar" ref={rootRef}>
      <label className="cd-agency-scope-label" htmlFor="cd-agency-scope-trigger">{t.scopeLabel}</label>
      <button
        id="cd-agency-scope-trigger"
        type="button"
        className="cd-agency-scope-combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="cd-agency-scope-value">{scopeDisplayLabel(scope, accounts, lang)}</span>
        <span className="cd-agency-scope-chevron" aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="cd-agency-scope-panel" id={listId} role="listbox" aria-label={t.open}>
          <input
            className="cd-agency-scope-search"
            value={search}
            placeholder={t.search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label={t.search}
          />
          <select
            className="cd-agency-scope-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as AgencyAccountFilter)}
            aria-label={t.filterAll}
          >
            <option value="all">{t.filterAll}</option>
            <option value="connected">{t.filterConnected}</option>
            <option value="preparing">{t.filterPreparing}</option>
            <option value="action_required">{t.filterAction}</option>
          </select>
          <button
            type="button"
            className={`cd-agency-scope-option${scope === "agency" ? " active" : ""}`}
            role="option"
            aria-selected={scope === "agency"}
            onClick={() => selectScope("agency")}
          >
            {t.agencyView} — {t.agency} ({accounts.length})
          </button>
          <div className="cd-agency-scope-list">
            {filteredAccounts.map((account) => (
              <button
                key={account.accountId}
                type="button"
                className={`cd-agency-scope-option${scope === account.accountId ? " active" : ""}`}
                role="option"
                aria-selected={scope === account.accountId}
                onClick={() => selectScope(account.accountId)}
              >
                {t.accountPrefix} — @{account.username.replace(/^@+/, "")}
              </button>
            ))}
            {!filteredAccounts.length ? (
              <p className="cd-agency-scope-empty">{t.noMatch}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
