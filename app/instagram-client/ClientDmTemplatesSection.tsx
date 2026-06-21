"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClientDmTemplatesProjection } from "@/lib/instagram-client/client-dm-templates";
import type { ClientInstagramAccountView } from "./ClientAccountsSection";

type Lang = "fr" | "en";

type SaveState = "idle" | "saving" | "saved" | "error";

type CardKind = "welcome" | "outreach";

const COPY = {
  fr: {
    emptyTitle: "Configurez vos messages automatiques",
    emptyBody: "Ajoutez un compte Instagram pour configurer ses messages.",
    accountLabel: "Compte Instagram",
    loading: "Chargement des modèles…",
    loadError: "Impossible de charger les modèles DM.",
    saveError: "Enregistrement impossible.",
    saved: "Enregistré",
    saving: "Enregistrement…",
    usernameHint: "{{username}} disponible",
    enableWelcome: "Activer le message de bienvenue",
    enableOutreach: "Activer la prospection",
    welcomeTitle: "Message de bienvenue",
    welcomeDesc: "Envoyé automatiquement à chaque nouvel abonné lorsque le service est activé.",
    outreachTitle: "Prospection Instagram",
    outreachDesc: "Message utilisé pour contacter de nouveaux prospects lorsque la prospection est activée.",
    offerUnavailable: "L'activation de la prospection n'est pas encore disponible. Réessayez plus tard.",
  },
  en: {
    emptyTitle: "Configure your automated messages",
    emptyBody: "Add an Instagram account to configure its messages.",
    accountLabel: "Instagram account",
    loading: "Loading templates…",
    loadError: "Could not load DM templates.",
    saveError: "Could not save.",
    saved: "Saved",
    saving: "Saving…",
    usernameHint: "{{username}} available",
    enableWelcome: "Enable welcome message",
    enableOutreach: "Enable outreach",
    welcomeTitle: "Welcome message",
    welcomeDesc: "Sent automatically to each new follower when the service is enabled.",
    outreachTitle: "Instagram outreach",
    outreachDesc: "Message used to contact new prospects when outreach is enabled.",
    offerUnavailable: "Outreach activation is not available yet. Please try again later.",
  },
} as const;

function cardTitle(kind: CardKind, lang: Lang) {
  return kind === "welcome" ? COPY[lang].welcomeTitle : COPY[lang].outreachTitle;
}

function cardDesc(kind: CardKind, lang: Lang) {
  return kind === "welcome" ? COPY[lang].welcomeDesc : COPY[lang].outreachDesc;
}

function cardEnableLabel(kind: CardKind, lang: Lang) {
  return kind === "welcome" ? COPY[lang].enableWelcome : COPY[lang].enableOutreach;
}

type Props = {
  lang: Lang;
  accounts: ClientInstagramAccountView[];
  hasLinkedInstagramAccount: boolean;
};

export default function ClientDmTemplatesSection(props: Props) {
  const { lang, accounts, hasLinkedInstagramAccount } = props;
  const t = COPY[lang];
  const liveAccounts = hasLinkedInstagramAccount ? accounts : [];
  const [selectedAccountId, setSelectedAccountId] = useState(liveAccounts[0]?.accountId ?? "");
  const [projection, setProjection] = useState<ClientDmTemplatesProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [outreachMessage, setOutreachMessage] = useState("");
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [outreachEnabled, setOutreachEnabled] = useState(false);
  const [welcomeSave, setWelcomeSave] = useState<SaveState>("idle");
  const [outreachSave, setOutreachSave] = useState<SaveState>("idle");
  const [welcomeSaveError, setWelcomeSaveError] = useState<string | null>(null);
  const [outreachSaveError, setOutreachSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!liveAccounts.length) {
      setSelectedAccountId("");
      return;
    }
    if (!liveAccounts.some((row) => row.accountId === selectedAccountId)) {
      setSelectedAccountId(liveAccounts[0]?.accountId ?? "");
    }
  }, [liveAccounts, selectedAccountId]);

  const selectedAccount = useMemo(
    () => liveAccounts.find((row) => row.accountId === selectedAccountId) ?? null,
    [liveAccounts, selectedAccountId],
  );

  const loadProjection = useCallback(async (accountId: string) => {
    if (!accountId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/dm-templates`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json() as { ok?: boolean; data?: ClientDmTemplatesProjection; error?: string };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || t.loadError);
      }
      setProjection(payload.data);
      setWelcomeMessage(payload.data.welcome.message);
      setOutreachMessage(payload.data.outreach.message);
      setWelcomeEnabled(payload.data.welcome.enabled);
      setOutreachEnabled(payload.data.outreach.enabled);
      setWelcomeSave("idle");
      setOutreachSave("idle");
      setWelcomeSaveError(null);
      setOutreachSaveError(null);
    } catch (error) {
      setProjection(null);
      setLoadError(error instanceof Error ? error.message : t.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.loadError]);

  useEffect(() => {
    if (!selectedAccountId) return;
    void loadProjection(selectedAccountId);
  }, [selectedAccountId, loadProjection]);

  async function saveCard(kind: CardKind, patch: { enabled?: boolean; message?: string }) {
    if (!selectedAccountId) return;
    const setSave = kind === "welcome" ? setWelcomeSave : setOutreachSave;
    const setSaveError = kind === "welcome" ? setWelcomeSaveError : setOutreachSaveError;
    setSave("saving");
    setSaveError(null);
    try {
      const response = await fetch(
        `/api/instagram-client/accounts/${encodeURIComponent(selectedAccountId)}/dm-templates/${kind}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const payload = await response.json() as {
        ok?: boolean;
        data?: ClientDmTemplatesProjection;
        error?: string;
        code?: string;
      };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || t.saveError);
      }
      setProjection(payload.data);
      setWelcomeMessage(payload.data.welcome.message);
      setOutreachMessage(payload.data.outreach.message);
      setWelcomeEnabled(payload.data.welcome.enabled);
      setOutreachEnabled(payload.data.outreach.enabled);
      setSave("saved");
      window.setTimeout(() => setSave("idle"), 1800);
    } catch (error) {
      setSave("error");
      setSaveError(error instanceof Error ? error.message : t.saveError);
    }
  }

  if (!liveAccounts.length) {
    return (
      <section className="cd-dm-empty">
        <h2 className="cd-dm-empty-title">{t.emptyTitle}</h2>
        <p className="cd-dm-empty-body">{t.emptyBody}</p>
      </section>
    );
  }

  return (
    <section className="cd-dm-wrap">
      <div className="cd-dm-toolbar">
        <label className="cd-dm-account-label" htmlFor="cd-dm-account-select">
          {t.accountLabel}
        </label>
        <select
          id="cd-dm-account-select"
          className="cd-dm-account-select"
          value={selectedAccountId}
          onChange={(event) => setSelectedAccountId(event.target.value)}
        >
          {liveAccounts.map((account) => (
            <option key={account.accountId} value={account.accountId}>
              @{account.username.replace(/^@+/, "")}
            </option>
          ))}
        </select>
        {selectedAccount?.packageLabel ? (
          <span className="cd-dm-pack-pill">{selectedAccount.packageLabel}</span>
        ) : null}
      </div>

      {loadError ? <p className="cd-setup-note" role="alert">{loadError}</p> : null}
      {loading ? <p className="cd-setup-note">{t.loading}</p> : null}

      {!loading && projection ? (
        <div className="cd-dm-cards">
          <DmTemplateCard
            lang={lang}
            kind="welcome"
            card={projection.welcome}
            enabled={welcomeEnabled}
            message={welcomeMessage}
            saveState={welcomeSave}
            saveError={welcomeSaveError}
            onEnabledChange={(value) => {
              setWelcomeEnabled(value);
              void saveCard("welcome", { enabled: value, message: welcomeMessage });
            }}
            onMessageChange={setWelcomeMessage}
            onMessageBlur={() => {
              if (projection.welcome.canConfigure && welcomeMessage !== projection.welcome.message) {
                void saveCard("welcome", { enabled: welcomeEnabled, message: welcomeMessage });
              }
            }}
          />
          <DmTemplateCard
            lang={lang}
            kind="outreach"
            card={projection.outreach}
            enabled={outreachEnabled}
            message={outreachMessage}
            saveState={outreachSave}
            saveError={outreachSaveError}
            offerUnavailable={projection.outreachUnavailableReason === "outreach_offer_not_configured"}
            onEnabledChange={(value) => {
              setOutreachEnabled(value);
              void saveCard("outreach", { enabled: value, message: outreachMessage });
            }}
            onMessageChange={setOutreachMessage}
            onMessageBlur={() => {
              if (projection.outreach.canConfigure && outreachMessage !== projection.outreach.message) {
                void saveCard("outreach", { enabled: outreachEnabled, message: outreachMessage });
              }
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

type CardProps = {
  lang: Lang;
  kind: CardKind;
  card: ClientDmTemplatesProjection["welcome"];
  enabled: boolean;
  message: string;
  saveState: SaveState;
  saveError: string | null;
  offerUnavailable?: boolean;
  onEnabledChange: (value: boolean) => void;
  onMessageChange: (value: string) => void;
  onMessageBlur: () => void;
};

function DmTemplateCard(props: CardProps) {
  const {
    lang,
    kind,
    card,
    enabled,
    message,
    saveState,
    saveError,
    offerUnavailable,
    onEnabledChange,
    onMessageChange,
    onMessageBlur,
  } = props;
  const t = COPY[lang];
  const locked = card.locked;
  const cardClass = kind === "welcome" ? "cd-dm-card cd-dm-card-welcome" : "cd-dm-card cd-dm-card-outreach";
  const statusLabel = saveState === "saving"
    ? t.saving
    : saveState === "saved"
      ? t.saved
      : saveState === "error"
        ? (saveError || t.saveError)
        : "";

  return (
    <article className={`${cardClass}${locked ? " cd-dm-card-locked" : ""}`}>
      <header className="cd-dm-card-head">
        <div>
          <h3>{cardTitle(kind, lang)}</h3>
          <p>{cardDesc(kind, lang)}</p>
        </div>
        {statusLabel ? <span className={`cd-dm-save-status cd-dm-save-${saveState}`}>{statusLabel}</span> : null}
      </header>

      {locked ? (
        <div className="cd-dm-locked-panel">
          <p className="cd-dm-locked-copy">{lang === "fr" ? card.lockedBodyFr : card.lockedBodyEn}</p>
          {card.ctaPath && !offerUnavailable ? (
            <Link className="cd-dm-cta" href={card.ctaPath}>
              {lang === "fr" ? card.ctaLabelFr : card.ctaLabelEn}
            </Link>
          ) : null}
          {offerUnavailable ? <p className="cd-dm-offer-unavailable">{t.offerUnavailable}</p> : null}
        </div>
      ) : null}

      <div className={`cd-dm-fields${locked ? " cd-dm-fields-disabled" : ""}`}>
        <textarea
          className="cd-dm-textarea"
          rows={6}
          value={message}
          disabled={locked || saveState === "saving"}
          placeholder={lang === "fr" ? "Votre message…" : "Your message…"}
          onChange={(event) => onMessageChange(event.target.value)}
          onBlur={onMessageBlur}
        />
        <p className="cd-dm-var-hint">{t.usernameHint}</p>
        <label className="cd-dm-toggle-row">
          <input
            type="checkbox"
            checked={enabled}
            disabled={locked || saveState === "saving"}
            onChange={(event) => onEnabledChange(event.target.checked)}
          />
          <span>{cardEnableLabel(kind, lang)}</span>
        </label>
      </div>
    </article>
  );
}
