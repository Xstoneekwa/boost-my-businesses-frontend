"use client";

import type { ClientOverviewRecentFeedItem } from "@/lib/instagram-client/client-overview-recent-feed-projection";
import { formatOverviewRecentFeedBusinessDate } from "@/lib/instagram-client/client-overview-recent-feed-projection";

type Lang = "fr" | "en";

const AVPAL = [
  ["#f58529", "#dd2a7b"], ["#8a3ab9", "#cd486b"], ["#5a6cf5", "#e8a030"], ["#fbbf24", "#dd2a7b"],
  ["#34d399", "#5a6cf5"], ["#dd2a7b", "#fbbf24"], ["#e8a030", "#8a3ab9"], ["#5851db", "#e1306c"],
];

function avatarPalette(username: string) {
  return AVPAL[username.charCodeAt(0) % AVPAL.length];
}

function FeedIcon({ kind }: { kind: ClientOverviewRecentFeedItem["iconKind"] }) {
  if (kind === "li") {
    return (
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/>
      </svg>
    );
  }
  if (kind === "dm") {
    return (
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    );
  }
  if (kind === "st") {
    return (
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
      </svg>
    );
  }
  if (kind === "uf") {
    return (
      <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>
    </svg>
  );
}

function SummaryText({ text, count, lang }: { text: string; count: number; lang: Lang }) {
  const formatted = count.toLocaleString(lang === "fr" ? "fr-FR" : "en-US");
  const idx = text.indexOf(formatted);
  if (idx < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, idx)}
      <strong className="cd-orf-highlight">{formatted}</strong>
      {text.slice(idx + formatted.length)}
    </span>
  );
}

function MiniAvatar({ username }: { username: string }) {
  const normalized = username.replace(/^@+/, "");
  const [from, to] = avatarPalette(normalized || "?");
  const initial = (normalized || "?").charAt(0).toUpperCase();
  return (
    <span
      className="cd-orf-av"
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      title={`@${normalized}`}
    >
      {initial}
    </span>
  );
}

export default function ClientOverviewRecentFeed({
  items,
  lang,
  emptyLabel,
}: {
  items: ClientOverviewRecentFeedItem[];
  lang: Lang;
  emptyLabel: string;
}) {
  if (!items.length) {
    return <div className="cd-orf-empty">{emptyLabel}</div>;
  }

  return (
    <div className="cd-orf">
      {items.map((item, index) => (
        <div key={item.id} className="cd-orf-item">
          <div className="cd-orf-rail">
            {index < items.length - 1 ? <span className="cd-orf-line" aria-hidden="true" /> : null}
            <span className={`cd-orf-icon cd-orf-icon-${item.iconKind}`}>
              <FeedIcon kind={item.iconKind} />
            </span>
          </div>
          <div className="cd-orf-body">
            <div className="cd-orf-summary">
              <SummaryText text={lang === "en" ? item.summaryEn : item.summaryFr} count={item.count} lang={lang} />
            </div>
            <div className="cd-orf-meta">{formatOverviewRecentFeedBusinessDate(item.businessDayKey, lang)}</div>
            <div className="cd-orf-foot">
              <span className={`cd-orf-pill cd-orf-pill-${item.iconKind}`}>
                {lang === "en" ? item.categoryLabelEn : item.categoryLabelFr}
              </span>
              {item.touchedUsernames.length > 0 || item.overflowCount > 0 ? (
                <div className="cd-orf-avatars">
                  {item.touchedUsernames.map((username) => (
                    <MiniAvatar key={`${item.id}-${username}`} username={username} />
                  ))}
                  {item.overflowCount > 0 ? (
                    <span className="cd-orf-more">+{item.overflowCount.toLocaleString(lang === "fr" ? "fr-FR" : "en-US")}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
