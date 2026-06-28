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
};

const COPY = {
  fr: {
    scopeLabel: "Contexte",
    agency: "Tous les comptes",
    accountPrefix: "Compte",
    search: "Rechercher @username…",
    filterAll: "Tous les statuts",
    filterConnected: "Connectés",
    filterPreparing: "Préparation en cours",
    filterAction: "Action requise",
    noMatch: "Aucun compte ne correspond à votre recherche.",
  },
  en: {
    scopeLabel: "Context",
    agency: "All accounts",
    accountPrefix: "Account",
    search: "Search @username…",
    filterAll: "All statuses",
    filterConnected: "Connected",
    filterPreparing: "Setup in progress",
    filterAction: "Action required",
    noMatch: "No account matches your search.",
  },
} as const;

function scopeLabel(scope: OverviewScope, accounts: ClientInstagramAccountView[], lang: Lang) {
  const t = COPY[lang];
  if (scope === "agency") return `${lang === "fr" ? "Vue Agence" : "Agency view"} — ${t.agency}`;
  const account = accounts.find((row) => row.accountId === scope);
  const handle = account?.username?.replace(/^@+/, "") ?? (lang === "fr" ? "compte" : "account");
  return `${t.accountPrefix} — @${handle}`;
}

export default function ClientAgencyScopeSelector(props: Props) {
  const { lang, accounts, scope, onScopeChange } = props;
  const t = COPY[lang];
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AgencyAccountFilter>("all");
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  return (
    <div className="cd-agency-scope" ref={rootRef}>
      <span className="cd-agency-scope-label">{t.scopeLabel}</span>
      <button
        type="button"
        className="cd-agency-scope-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {scopeLabel(scope, accounts, lang)}
      </button>
      {open ? (
        <div className="cd-agency-scope-panel" role="listbox">
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
            onClick={() => { onScopeChange("agency"); setOpen(false); }}
          >
            {t.agency} ({accounts.length})
          </button>
          <div className="cd-agency-scope-list">
            {filteredAccounts.map((account) => (
              <button
                key={account.accountId}
                type="button"
                className={`cd-agency-scope-option${scope === account.accountId ? " active" : ""}`}
                onClick={() => { onScopeChange(account.accountId); setOpen(false); }}
              >
                @{account.username.replace(/^@+/, "")}
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
