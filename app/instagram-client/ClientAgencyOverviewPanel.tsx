"use client";

import { useCallback, useEffect, useState } from "react";
import ClientAgencyAccountsTable from "./ClientAgencyAccountsTable";
import ClientOverviewRecentFeed from "./ClientOverviewRecentFeed";
import type { ClientAgencyOverviewProjection } from "@/lib/instagram-client/client-agency-overview-projection";
import type { AgencyAccountFilter } from "@/lib/instagram-client/client-agency-overview-projection";

type Lang = "fr" | "en";

type Props = {
  lang: Lang;
  onSelectAccount: (accountId: string) => void;
};

const COPY = {
  fr: {
    loading: "Chargement de la vue Agence…",
    error: "Impossible de charger la vue Agence.",
    summaryLinked: "Comptes liés",
    summaryConnected: "Connectés",
    summaryPreparing: "En préparation",
    summaryAction: "Action requise",
    summaryCampaign: "Campagne active",
    packagesTitle: "Formules de vos comptes",
    accountsTitle: "Vos comptes Instagram",
    recentTitle: "Activité récente",
    recentEmpty: "L'activité récente de vos comptes apparaîtra ici.",
    followersNote: "L'évolution des abonnés est disponible compte par compte. Sélectionnez un compte pour consulter son historique.",
    accountLabel: "Compte",
  },
  en: {
    loading: "Loading agency view…",
    error: "Could not load agency view.",
    summaryLinked: "Linked accounts",
    summaryConnected: "Connected",
    summaryPreparing: "In setup",
    summaryAction: "Action required",
    summaryCampaign: "Active campaign",
    packagesTitle: "Your account plans",
    accountsTitle: "Your Instagram accounts",
    recentTitle: "Recent activity",
    recentEmpty: "Recent activity across your accounts will appear here.",
    followersNote: "Follower evolution is available per account. Select an account to view its history.",
    accountLabel: "Account",
  },
} as const;

export default function ClientAgencyOverviewPanel(props: Props) {
  const { lang, onSelectAccount } = props;
  const t = COPY[lang];
  const [data, setData] = useState<ClientAgencyOverviewProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [tableFilter, setTableFilter] = useState<AgencyAccountFilter>("all");
  const [tableSearch, setTableSearch] = useState("");

  const loadOverview = useCallback(async (nextPage: number, filter: AgencyAccountFilter, search: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        page_size: "20",
        filter,
      });
      if (search.trim()) params.set("q", search.trim());
      const response = await fetch(`/api/instagram-client/overview/agency?${params.toString()}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json() as { ok?: boolean; data?: ClientAgencyOverviewProjection; error?: string };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || t.error);
      }
      setData(payload.data);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : t.error);
    } finally {
      setLoading(false);
    }
  }, [t.error]);

  useEffect(() => {
    void loadOverview(page, tableFilter, tableSearch);
  }, [loadOverview, page, tableFilter, tableSearch]);

  if (loading && !data) {
    return <p className="cd-agency-loading">{t.loading}</p>;
  }

  if (error && !data) {
    return <p className="cd-agency-error">{error}</p>;
  }

  if (!data) return null;

  const recentItems = data.recentFeed.map((item) => ({
    ...item,
    id: `${item.accountId}:${item.id}`,
    summaryFr: `@${item.accountUsername.replace(/^@+/, "")} · ${item.summaryFr}`,
    summaryEn: `@${item.accountUsername.replace(/^@+/, "")} · ${item.summaryEn}`,
  }));

  return (
    <div className="cd-agency-overview">
      <div className="cd-stats-row cd-agency-summary">
        {[
          { lbl: t.summaryLinked, val: String(data.summary.linkedCount) },
          { lbl: t.summaryConnected, val: String(data.summary.connectedCount) },
          { lbl: t.summaryPreparing, val: String(data.summary.preparingCount) },
          { lbl: t.summaryAction, val: String(data.summary.actionRequiredCount) },
          { lbl: t.summaryCampaign, val: String(data.summary.campaignActiveCount) },
        ].map((card) => (
          <div key={card.lbl} className="cd-sc">
            <div className="cd-sc-lbl">{card.lbl}</div>
            <div className="cd-sc-val">{card.val}</div>
          </div>
        ))}
      </div>

      <div className="cd-card cd-agency-packages">
        <div className="cd-card-hd"><h3>{t.packagesTitle}</h3></div>
        <ul className="cd-agency-package-list">
          {data.packageSummary.map((row) => (
            <li key={row.label}>
              <strong>{row.label}</strong>
              <span>{row.count} {lang === "fr" ? (row.count > 1 ? "comptes" : "compte") : (row.count > 1 ? "accounts" : "account")}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="cd-agency-followers-note">{t.followersNote}</p>

      <div className="cd-card">
        <div className="cd-card-hd">
          <h3>{t.accountsTitle}</h3>
          <div className="cd-agency-table-tools">
            <input
              className="cd-agency-table-search"
              value={tableSearch}
              placeholder={lang === "fr" ? "Filtrer @username…" : "Filter @username…"}
              onChange={(event) => { setTableSearch(event.target.value); setPage(1); }}
            />
            <select
              value={tableFilter}
              onChange={(event) => { setTableFilter(event.target.value as AgencyAccountFilter); setPage(1); }}
            >
              <option value="all">{lang === "fr" ? "Tous" : "All"}</option>
              <option value="connected">{lang === "fr" ? "Connectés" : "Connected"}</option>
              <option value="preparing">{lang === "fr" ? "Préparation" : "Setup"}</option>
              <option value="action_required">{lang === "fr" ? "Action requise" : "Action required"}</option>
            </select>
          </div>
        </div>
        <ClientAgencyAccountsTable
          lang={lang}
          rows={data.accounts}
          page={data.page}
          pageSize={data.pageSize}
          total={data.accountsTotal}
          loading={loading}
          onSelectAccount={onSelectAccount}
          onPageChange={setPage}
        />
      </div>

      <div className="cd-card">
        <div className="cd-card-hd"><h3>{t.recentTitle}</h3></div>
        <ClientOverviewRecentFeed
          items={recentItems}
          lang={lang}
          emptyLabel={t.recentEmpty}
        />
      </div>
    </div>
  );
}
