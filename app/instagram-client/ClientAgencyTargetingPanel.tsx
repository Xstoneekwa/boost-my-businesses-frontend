"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClientAgencyTargetingProjection } from "@/lib/instagram-client/client-agency-targeting-projection";

type Lang = "fr" | "en";

const AVPAL = [
  ["#f58529", "#dd2a7b"], ["#8a3ab9", "#cd486b"], ["#5a6cf5", "#e8a030"],
];

type Props = {
  lang: Lang;
  onManageAccount: (accountId: string) => void;
};

const COPY = {
  fr: {
    title: "Ciblage Agence — Tous les comptes",
    loading: "Chargement du ciblage agence…",
    error: "Impossible de charger le ciblage agence.",
    ready: "Comptes avec cibles prêtes",
    needs: "Comptes à compléter",
    collecting: "Comptes en cours de collecte",
    account: "Compte",
    package: "Formule",
    added: "CT ajoutés",
    eligible: "CT prêts campagne",
    status: "Statut",
    action: "Gérer le ciblage",
    note: "Seuls les comptes cibles prêts pour la campagne comptent pour la prospection. Les comptes ajoutés mais non éligibles ne suffisent pas.",
  },
  en: {
    title: "Agency targeting — All accounts",
    loading: "Loading agency targeting…",
    error: "Could not load agency targeting.",
    ready: "Accounts with ready targets",
    needs: "Accounts to complete",
    collecting: "Accounts collecting data",
    account: "Account",
    package: "Plan",
    added: "Targets added",
    eligible: "Campaign-ready targets",
    status: "Status",
    action: "Manage targeting",
    note: "Only campaign-ready targets count for outreach. Added but non-eligible targets are not enough.",
  },
} as const;

export default function ClientAgencyTargetingPanel(props: Props) {
  const { lang, onManageAccount } = props;
  const t = COPY[lang];
  const [data, setData] = useState<ClientAgencyTargetingProjection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/instagram-client/overview/agency-targeting", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json() as { ok?: boolean; data?: ClientAgencyTargetingProjection; error?: string };
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
    void load();
  }, [load]);

  if (loading && !data) return <p className="cd-agency-loading">{t.loading}</p>;
  if (error && !data) return <p className="cd-agency-error">{error}</p>;
  if (!data) return null;

  return (
    <div className="cd-agency-targeting">
      <h2 className="cd-agency-targeting-title">{t.title}</h2>
      <div className="cd-stats-row cd-agency-summary">
        <div className="cd-sc"><div className="cd-sc-lbl">{t.ready}</div><div className="cd-sc-val">{data.summary.readyAccounts}</div></div>
        <div className="cd-sc"><div className="cd-sc-lbl">{t.needs}</div><div className="cd-sc-val">{data.summary.needsCompletionAccounts}</div></div>
        <div className="cd-sc"><div className="cd-sc-lbl">{t.collecting}</div><div className="cd-sc-val">{data.summary.collectingAccounts}</div></div>
      </div>
      <p className="cd-agency-followers-note">{t.note}</p>
      <div className="cd-agency-table-wrap">
        <table className="cd-agency-table">
          <thead>
            <tr>
              <th>{t.account}</th>
              <th>{t.package}</th>
              <th>{t.added}</th>
              <th>{t.eligible}</th>
              <th>{t.status}</th>
              <th>{t.action}</th>
            </tr>
          </thead>
          <tbody>
            {data.accounts.map((row) => {
              const handle = row.username.replace(/^@+/, "");
              const [from, to] = AVPAL[handle.charCodeAt(0) % AVPAL.length];
              return (
                <tr key={row.accountId} className={row.needsMoreTargets ? "needs-action" : undefined}>
                  <td>
                    <span className="cd-agency-table-user">
                      <span className="cd-agency-table-av" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
                        {handle.charAt(0).toUpperCase()}
                      </span>
                      <span>@{handle}</span>
                    </span>
                  </td>
                  <td>{row.packageLabel}</td>
                  <td>{row.addedCount}</td>
                  <td>{row.eligibleCount}</td>
                  <td>{lang === "fr" ? row.statusFr : row.statusEn}</td>
                  <td>
                    <button type="button" className="cd-btn cd-btn-soft cd-agency-table-action" onClick={() => onManageAccount(row.accountId)}>
                      {t.action}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
