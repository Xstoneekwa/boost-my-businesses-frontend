"use client";

import type { ClientAgencyOverviewAccountRow } from "@/lib/instagram-client/client-agency-overview-projection";

type Lang = "fr" | "en";

const AVPAL = [
  ["#f58529", "#dd2a7b"], ["#8a3ab9", "#cd486b"], ["#5a6cf5", "#e8a030"], ["#fbbf24", "#dd2a7b"],
];

function avatarPalette(username: string) {
  return AVPAL[username.charCodeAt(0) % AVPAL.length];
}

type Props = {
  lang: Lang;
  rows: ClientAgencyOverviewAccountRow[];
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  onSelectAccount: (accountId: string) => void;
  onPageChange: (page: number) => void;
};

const COPY = {
  fr: {
    username: "Compte",
    package: "Formule",
    connection: "Connexion",
    preparation: "Préparation",
    campaign: "Campagne",
    targets: "Cibles",
    activity: "Dernière activité",
    action: "Voir le compte",
    empty: "Aucun compte à afficher.",
    pending: "Données en cours de collecte",
    page: "Page",
  },
  en: {
    username: "Account",
    package: "Plan",
    connection: "Connection",
    preparation: "Setup",
    campaign: "Campaign",
    targets: "Targets",
    activity: "Last activity",
    action: "View account",
    empty: "No accounts to display.",
    pending: "Data collection in progress",
    page: "Page",
  },
} as const;

export default function ClientAgencyAccountsTable(props: Props) {
  const { lang, rows, page, pageSize, total, loading, onSelectAccount, onPageChange } = props;
  const t = COPY[lang];
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (!rows.length && !loading) {
    return <div className="cd-agency-table-empty">{t.empty}</div>;
  }

  return (
    <div className="cd-agency-table-wrap">
      <table className="cd-agency-table">
        <thead>
          <tr>
            <th>{t.username}</th>
            <th>{t.package}</th>
            <th>{t.connection}</th>
            <th>{t.preparation}</th>
            <th>{t.campaign}</th>
            <th>{t.targets}</th>
            <th>{t.activity}</th>
            <th>{t.action}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const handle = row.username.replace(/^@+/, "");
            const [from, to] = avatarPalette(handle || "?");
            const activity = lang === "fr" ? row.lastActivityLabelFr : row.lastActivityLabelEn;
            const connection = lang === "fr" ? row.connectionLabelFr : row.connectionLabelEn;
            const preparation = lang === "fr" ? row.preparationLabelFr : row.preparationLabelEn;
            const campaign = lang === "fr" ? row.campaignLabelFr : row.campaignLabelEn;
            const targets = lang === "fr" ? row.needsTargetsLabelFr : row.needsTargetsLabelEn;
            return (
              <tr key={row.accountId} className={row.actionRequired ? "needs-action" : undefined}>
                <td>
                  <button type="button" className="cd-agency-table-user" onClick={() => onSelectAccount(row.accountId)}>
                    <span className="cd-agency-table-av" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
                      {(handle || "?").charAt(0).toUpperCase()}
                    </span>
                    <span>@{handle}</span>
                  </button>
                </td>
                <td>{row.packageLabel}</td>
                <td>{connection}</td>
                <td>{preparation}</td>
                <td>{campaign}</td>
                <td>{targets ?? "—"}</td>
                <td>{activity ?? t.pending}</td>
                <td>
                  <button type="button" className="cd-btn cd-btn-soft cd-agency-table-action" onClick={() => onSelectAccount(row.accountId)}>
                    {t.action}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {totalPages > 1 ? (
        <footer className="cd-agency-table-pagination">
          <button type="button" className="cd-btn cd-btn-soft" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>
            ←
          </button>
          <span>{t.page} {page} / {totalPages}</span>
          <button type="button" className="cd-btn cd-btn-soft" disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>
            →
          </button>
        </footer>
      ) : null}
    </div>
  );
}
