"use client";

import Link from "next/link";
import type { ClientAccountNotificationView, ClientAccountNotificationsProjection } from "@/lib/instagram-client/client-account-notifications";

type Lang = "fr" | "en";

type Props = {
  lang: Lang;
  projection: ClientAccountNotificationsProjection;
  onMarkRead: (notificationId: string) => Promise<void>;
  onNavigate?: (href: string) => void;
};

function categoryLabel(category: ClientAccountNotificationView["category"], lang: Lang) {
  const labels = {
    fr: {
      needs_more_target_accounts: "Comptes cibles",
      needs_assistance: "Assistance",
      account_paused: "Pause",
      account_canceled: "Annulé",
    },
    en: {
      needs_more_target_accounts: "Target accounts",
      needs_assistance: "Assistance",
      account_paused: "Paused",
      account_canceled: "Canceled",
    },
  } as const;
  return labels[lang][category];
}

function formatDate(value: string | null, lang: Lang) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString(lang === "fr" ? "fr-FR" : "en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function NotificationCard({
  notification,
  lang,
  onMarkRead,
  onNavigate,
  resolved = false,
}: {
  notification: ClientAccountNotificationView;
  lang: Lang;
  onMarkRead: (notificationId: string) => Promise<void>;
  onNavigate?: (href: string) => void;
  resolved?: boolean;
}) {
  const username = notification.username.startsWith("@")
    ? notification.username
    : `@${notification.username}`;

  return (
    <article className={`cd-client-notif${notification.readAt ? " is-read" : ""}${resolved ? " is-resolved" : ""}`}>
      <div className="cd-client-notif-hd">
        <span className="cd-client-notif-cat">{categoryLabel(notification.category, lang)}</span>
        <span className="cd-client-notif-date">
          {formatDate(resolved ? notification.resolvedAt : notification.createdAt, lang)}
        </span>
      </div>
      <strong className="cd-client-notif-account">{username}</strong>
      <h3>{notification.title}</h3>
      <p>{notification.message}</p>
      <div className="cd-client-notif-actions">
        {notification.ctaHref && notification.ctaLabel ? (
          notification.ctaHref.startsWith("/instagram-client") ? (
            <button
              type="button"
              className="cd-btn cd-btn-primary"
              onClick={() => onNavigate?.(notification.ctaHref as string)}
            >
              {notification.ctaLabel}
            </button>
          ) : (
            <Link className="cd-btn cd-btn-primary" href={notification.ctaHref}>
              {notification.ctaLabel}
            </Link>
          )
        ) : null}
        {!resolved && notification.canMarkRead && !notification.readAt ? (
          <button
            type="button"
            className="cd-btn cd-btn-ghost"
            onClick={() => onMarkRead(notification.id)}
          >
            {lang === "fr" ? "Marquer comme lu" : "Mark as read"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function ClientNotificationsPanel({
  lang,
  projection,
  onMarkRead,
  onNavigate,
}: Props) {
  const copy = lang === "fr"
    ? {
        title: "Notifications",
        active: "Actives",
        history: "Historique récent",
        empty: "Aucune notification active pour le moment.",
      }
    : {
        title: "Notifications",
        active: "Active",
        history: "Recent history",
        empty: "No active notifications right now.",
      };

  return (
    <section className="cd-client-notifs" aria-label={copy.title}>
      <div className="cd-client-notifs-hd">
        <h2>{copy.title}</h2>
        {projection.activeCount > 0 ? (
          <span className="cd-client-notifs-badge">{projection.activeCount}</span>
        ) : null}
      </div>

      <div className="cd-client-notifs-section">
        <h3>{copy.active}</h3>
        {projection.active.length === 0 ? (
          <p className="cd-client-notifs-empty">{copy.empty}</p>
        ) : (
          <div className="cd-client-notifs-list">
            {projection.active.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                lang={lang}
                onMarkRead={onMarkRead}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>

      {projection.recentResolved.length > 0 ? (
        <div className="cd-client-notifs-section">
          <h3>{copy.history}</h3>
          <div className="cd-client-notifs-list">
            {projection.recentResolved.map((notification) => (
              <NotificationCard
                key={`${notification.id}-resolved`}
                notification={notification}
                lang={lang}
                onMarkRead={onMarkRead}
                onNavigate={onNavigate}
                resolved
              />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export type { ClientAccountNotificationsProjection };
