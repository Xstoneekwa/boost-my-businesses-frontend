"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ArrowRight, Camera, Check, Sparkles, X } from "lucide-react";
import { buildTargetsOverview, type TargetSafeRow, type TargetsOverview } from "@/app/instagram-dashboard/targets-data";
import type {
  ClientOnboardingSession,
  ClientPublicAnalysis,
  ClientTargetingCriteria,
} from "@/lib/instagram-client/client-account-onboarding";
import { isClientAiTargetingEnabled } from "@/lib/instagram-client/ai-targeting-gate";
import ClientAccountTargetsDrawer, { type DrawerCopy } from "./ClientAccountTargetsDrawer";

type Lang = "fr" | "en";

type Props = {
  open: boolean;
  lang: Lang;
  onClose: () => void;
  onCompleted: () => Promise<void> | void;
};

type ApiEnvelope = {
  ok?: boolean;
  error?: string;
  code?: string;
  eligible_count?: number;
  required_count?: number;
  data?: { onboarding?: ClientOnboardingSession | null };
};

const STEPS = ["connection", "analysis", "targeting", "targets", "complete"] as const;

function text(lang: Lang, fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function targetCopy(lang: Lang): DrawerCopy {
  return lang === "fr" ? {
    kicker: "Cibles",
    total: "Total",
    valid: "Validées / éligibles",
    archived: "Archivées",
    searchPh: "Filtrer par pseudo ou statut…",
    chips: ["Tout", "Validées", "En attente", "Rejetées", "Archivées"],
    refresh: "Actualiser",
    export: "Exporter",
    del: "Supprimer la sélection",
    addLbl: "Ajouter une cible",
    addPh: "Nom d'utilisateur Instagram",
    addBtn: "Ajouter",
    bulkLbl: "Ajout groupé (un par ligne)",
    importBtn: "Importer",
    aiLbl: "Recherche assistée",
    cols: ["", "Compte", "Vérification", "Éligibilité", "Abonnés", "Perf", "FBR", "Envoyés", "Dernier usage", "Ajouté"],
    elig: { eligible: "Éligible", verified: "Vérifié", pending: "En attente", rejected: "Rejeté", archived: "Archivé" },
    perf: { running: "En cours", pending: "En attente" },
    found: "trouvé",
    notFound: "introuvable",
  } : {
    kicker: "Targets",
    total: "Total",
    valid: "Validated / eligible",
    archived: "Archived",
    searchPh: "Filter by username or status…",
    chips: ["All", "Validated", "Pending", "Rejected", "Archived"],
    refresh: "Refresh",
    export: "Export",
    del: "Delete selected",
    addLbl: "Add a target",
    addPh: "Instagram username",
    addBtn: "Add",
    bulkLbl: "Bulk add (one per line)",
    importBtn: "Import",
    aiLbl: "Assisted search",
    cols: ["", "Account", "Verification", "Eligibility", "Followers", "Perf", "FBR", "Sent", "Last used", "Added"],
    elig: { eligible: "Eligible", verified: "Verified", pending: "Pending", rejected: "Rejected", archived: "Archived" },
    perf: { running: "Running", pending: "Pending" },
    found: "found",
    notFound: "not found",
  };
}

function emptyCriteria(analysis: ClientPublicAnalysis | null): ClientTargetingCriteria {
  return {
    idealCustomer: analysis?.probableAudience ?? "",
    geography: analysis?.location ?? "",
    niche: analysis?.niche ?? analysis?.category ?? "",
    businessDescription: analysis?.biography ?? "",
    language: analysis?.language ?? "",
    themes: analysis?.themes ?? [],
    keywords: analysis?.themes ?? [],
  };
}

function listInput(values: string[]) {
  return values.join(", ");
}

function parseList(value: string) {
  return [...new Set(value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean))];
}

async function readEnvelope(response: Response): Promise<ApiEnvelope> {
  const payload = await response.json().catch(() => null) as ApiEnvelope | null;
  if (!payload) throw new Error(`Request failed (${response.status}).`);
  return payload;
}

export default function ClientInstagramOnboardingWizard({ open, lang, onClose, onCompleted }: Props) {
  const [session, setSession] = useState<ClientOnboardingSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [analysis, setAnalysis] = useState<ClientPublicAnalysis | null>(null);
  const [criteria, setCriteria] = useState<ClientTargetingCriteria>(emptyCriteria(null));
  const [targets, setTargets] = useState<TargetsOverview | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const idempotencyKeyRef = useRef("");
  const targetDrawerAutoOpenedRef = useRef("");

  const step = session?.canRestart ? null : (session?.currentStep ?? "connection");
  const stepIndex = Math.max(0, STEPS.indexOf(step ?? "connection"));
  const eligibleCount = targets?.summary.validEligible ?? session?.eligibleTargetCount ?? 0;
  const requiredCount = session?.requiredTargetCount ?? 15;

  const loadTargets = useCallback(async (accountId: string) => {
    const response = await fetch(`/api/instagram-client/accounts/${encodeURIComponent(accountId)}/targets`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json() as { ok?: boolean; data?: TargetSafeRow[]; error?: string };
    if (!response.ok || !payload.ok || !Array.isArray(payload.data)) {
      throw new Error(payload.error || text(lang, "Impossible de charger les comptes cibles.", "Could not load target accounts."));
    }
    setTargets(buildTargetsOverview(payload.data));
  }, [lang]);

  const hydrate = useCallback((next: ClientOnboardingSession | null) => {
    setSession(next);
    if (!next) {
      idempotencyKeyRef.current = "";
      return;
    }
    idempotencyKeyRef.current = next.idempotencyKey;
    setUsername(next.requestedUsername);
    setAnalysis(next.publicAnalysis);
    setCriteria(next.targetingCriteria ?? emptyCriteria(next.publicAnalysis));
    if (next.accountId && (next.currentStep === "targets" || next.currentStep === "complete")) {
      void loadTargets(next.accountId).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : text(lang, "Chargement indisponible.", "Loading unavailable."));
      });
    }
  }, [lang, loadTargets]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetch("/api/instagram-client/onboarding", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(readEnvelope)
      .then((payload) => {
        if (cancelled) return;
        if (!payload.ok) throw new Error(payload.error || text(lang, "Impossible de reprendre l'onboarding.", "Could not resume onboarding."));
        hydrate(payload.data?.onboarding ?? null);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : text(lang, "Chargement indisponible.", "Loading unavailable."));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [hydrate, lang, open]);

  useEffect(() => {
    if (!open) {
      setPassword("");
      setShowPassword(false);
      setDrawerOpen(false);
      targetDrawerAutoOpenedRef.current = "";
    }
  }, [open]);

  useEffect(() => {
    if (!open || step !== "targets" || !session?.accountId) return;
    if (targetDrawerAutoOpenedRef.current === session.id) return;
    targetDrawerAutoOpenedRef.current = session.id;
    setDrawerOpen(true);
  }, [open, session?.accountId, session?.id, step]);

  const sourceLabel = useCallback((field: string) => {
    const source = analysis?.sources?.[field];
    if (source === "public") return text(lang, "Donnée publique", "Public data");
    if (source === "suggested") return text(lang, "Suggestion", "Suggestion");
    if (source === "user_confirmed") return text(lang, "Confirmé par vous", "Confirmed by you");
    return text(lang, "Non détecté", "Not detected");
  }, [analysis?.sources, lang]);

  async function startOnboarding(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/instagram-client/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ idempotency_key: idempotencyKeyRef.current, username: username.trim(), email: email.trim(), password }),
      });
      const payload = await readEnvelope(response);
      setPassword("");
      setShowPassword(false);
      if (!response.ok || !payload.ok || !payload.data?.onboarding) {
        throw new Error(payload.error || text(lang, "Les identifiants n'ont pas pu être enregistrés.", "Credentials could not be recorded."));
      }
      hydrate(payload.data.onboarding);
    } catch (submitError) {
      setPassword("");
      setShowPassword(false);
      setError(submitError instanceof Error ? submitError.message : text(lang, "Enregistrement indisponible.", "Saving unavailable."));
    } finally {
      setSaving(false);
    }
  }

  async function restartOnboarding() {
    if (!session?.canRestart || saving) return;
    const idempotencyKey = crypto.randomUUID();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/instagram-client/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ restart_session_id: session.id, idempotency_key: idempotencyKey }),
      });
      const payload = await readEnvelope(response);
      if (!response.ok || !payload.ok || !payload.data?.onboarding) {
        throw new Error(payload.error || text(lang, "La reprise a échoué.", "Could not restart onboarding."));
      }
      hydrate(payload.data.onboarding);
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : text(lang, "La reprise a échoué.", "Could not restart onboarding."));
    } finally {
      setSaving(false);
    }
  }

  async function patchSession(action: "save_analysis" | "save_targeting" | "complete", value?: unknown) {
    if (!session || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/instagram-client/onboarding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ session_id: session.id, action, value }),
      });
      const payload = await readEnvelope(response);
      if (!response.ok || !payload.ok || !payload.data?.onboarding) {
        if (payload.code === "target_minimum_not_met") {
          throw new Error(text(lang, `${payload.eligible_count ?? eligibleCount} / ${payload.required_count ?? requiredCount} comptes cibles validés.`, `${payload.eligible_count ?? eligibleCount} / ${payload.required_count ?? requiredCount} validated target accounts.`));
        }
        throw new Error(payload.error || text(lang, "Cette étape n'a pas pu être enregistrée.", "This step could not be saved."));
      }
      hydrate(payload.data.onboarding);
      if (action === "complete") await onCompleted();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : text(lang, "Enregistrement indisponible.", "Saving unavailable."));
    } finally {
      setSaving(false);
    }
  }

  const progressLabels = useMemo(() => [
    text(lang, "Connexion", "Connection"), text(lang, "Analyse", "Analysis"), text(lang, "Ciblage", "Targeting"),
    text(lang, "Comptes cibles", "Target accounts"), text(lang, "Terminé", "Complete"),
  ], [lang]);
  const aiEnabled = isClientAiTargetingEnabled(session?.packageCode ?? "growth");
  const packageLabel = session?.packageCode
    ? session.packageCode.charAt(0).toUpperCase() + session.packageCode.slice(1)
    : text(lang, "Package à confirmer", "Package pending");

  if (!open) return null;

  return (
    <div className="cd-progress-overlay" role="presentation">
      <section className="cio-shell" role="dialog" aria-modal="true" aria-labelledby="cio-title">
        <div className="cio-accent" aria-hidden="true" />
        <header className="cio-header">
          <div className="cio-brand">
            <span className="cio-brand-icon"><Camera size={22} /></span>
            <div><p>{text(lang, "ONBOARDING INSTAGRAM", "INSTAGRAM ONBOARDING")}</p><h2 id="cio-title">{text(lang, "Préparer votre nouveau compte", "Prepare your new account")}</h2></div>
          </div>
          <div className="cio-header-meta">
            <span className="cio-package">{packageLabel}</span>
            {session ? <span className={`cio-ai-state ${aiEnabled ? "active" : "locked"}`}><Sparkles size={13} />{aiEnabled ? text(lang, "Recherche IA active", "AI search active") : text(lang, "IA verrouillée", "AI locked")}</span> : null}
            <button type="button" className="cio-icon-btn" onClick={onClose} disabled={saving} aria-label={text(lang, "Fermer", "Close")}><X size={18} /></button>
          </div>
        </header>
        <ol className="cio-progress" aria-label={text(lang, "Progression", "Progress")}>{progressLabels.map((label, index) => <li key={label} className={index < stepIndex ? "done" : index === stepIndex ? "active" : ""}><span>{index + 1}</span>{label}</li>)}</ol>
        <div className="cio-body">
          {loading ? <p className="cio-state">{text(lang, "Chargement de votre progression…", "Loading your progress…")}</p> : null}
          {error ? <p className="cio-error" role="alert">{error}</p> : null}
          {!loading && session?.canRestart ? <div className="cio-complete"><span aria-hidden="true">↻</span><h3>{text(lang, "Onboarding à reprendre", "Onboarding needs to be restarted")}</h3><p>{session.status === "expired" ? text(lang, "Cette session a expiré. Tu peux reprendre à partir de la dernière étape enregistrée sans recréer le compte ni ressaisir les identifiants.", "This session expired. You can resume from the last saved step without recreating the account or entering credentials again.") : text(lang, "Cette session a été abandonnée. Tu peux la reprendre sans recréer le compte ni ressaisir les identifiants.", "This session was abandoned. You can restart it without recreating the account or entering credentials again.")}</p><button className="cd-btn cd-btn-primary" type="button" disabled={saving} onClick={() => void restartOnboarding()}>{saving ? text(lang, "Reprise…", "Restarting…") : text(lang, "Reprendre l'onboarding", "Restart onboarding")}</button></div> : null}
          {!loading && !session?.canRestart && step === "connection" ? <form className="cio-form" onSubmit={(event) => void startOnboarding(event)}><div className="cio-intro"><h3>{text(lang, "Enregistrer les identifiants", "Record credentials")}</h3><p>{text(lang, "Vos identifiants sont transmis au coffre sécurisé existant. Cette étape ne connecte pas encore le compte à un téléphone.", "Your credentials are sent to the existing secure vault. This step does not connect the account to a phone yet.")}</p></div><label><span>{text(lang, "Identifiant Instagram", "Instagram username")}</span><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="@username" required /></label><label><span>{text(lang, "Email Instagram (optionnel)", "Instagram email (optional)")}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" /></label><label><span>{text(lang, "Mot de passe Instagram", "Instagram password")}</span><div className="cio-password"><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? text(lang, "Masquer", "Hide") : text(lang, "Afficher", "Show")}</button></div></label><div className="cio-actions"><button className="cd-btn cd-btn-primary" type="submit" disabled={saving}>{saving ? text(lang, "Enregistrement…", "Saving…") : text(lang, "Enregistrer les identifiants", "Save credentials")}</button></div></form> : null}
          {!loading && !session?.canRestart && step === "analysis" && analysis ? <div className="cio-form"><div className="cio-intro"><h3>{text(lang, "Vérifier le profil public", "Review the public profile")}</h3><p>{text(lang, "Les champs non détectés restent vides jusqu'à votre confirmation.", "Fields that were not detected remain empty until you confirm them.")}</p></div><div className="cio-profile">{analysis.avatarUrl ? <Image src={analysis.avatarUrl} alt="" width={56} height={56} unoptimized /> : <span className="cio-avatar">@</span>}<div><strong>@{analysis.username}</strong><p>{analysis.displayName || text(lang, "Nom non détecté", "Name not detected")}</p><small>{analysis.followersCount == null ? text(lang, "Abonnés non détectés", "Followers not detected") : `${analysis.followersCount.toLocaleString()} ${text(lang, "abonnés", "followers")}`}</small></div></div><label><span>{text(lang, "Nom public", "Public name")} · {sourceLabel("displayName")}</span><input value={analysis.displayName ?? ""} placeholder={text(lang, "Non détecté", "Not detected")} onChange={(event) => setAnalysis({ ...analysis, displayName: event.target.value })} /></label><label><span>Bio · {sourceLabel("biography")}</span><textarea value={analysis.biography ?? ""} placeholder={text(lang, "Non détecté", "Not detected")} onChange={(event) => setAnalysis({ ...analysis, biography: event.target.value })} rows={3} /></label><div className="cio-grid">{(["category", "niche", "location", "language"] as const).map((field) => <label key={field}><span>{text(lang, field === "category" ? "Catégorie" : field === "niche" ? "Niche / secteur" : field === "location" ? "Localisation" : "Langue", field === "category" ? "Category" : field === "niche" ? "Niche / industry" : field === "location" ? "Location" : "Language")} · {sourceLabel(field)}</span><input value={analysis[field] ?? ""} placeholder={text(lang, "Non détecté", "Not detected")} onChange={(event) => setAnalysis({ ...analysis, [field]: event.target.value })} /></label>)}</div><label><span>{text(lang, "Audience probable", "Likely audience")} · {sourceLabel("probableAudience")}</span><input value={analysis.probableAudience ?? ""} placeholder={text(lang, "Non détecté", "Not detected")} onChange={(event) => setAnalysis({ ...analysis, probableAudience: event.target.value })} /></label><label><span>{text(lang, "Thèmes (séparés par des virgules)", "Themes (comma-separated)")} · {sourceLabel("themes")}</span><input value={listInput(analysis.themes)} placeholder={text(lang, "Non détecté", "Not detected")} onChange={(event) => setAnalysis({ ...analysis, themes: parseList(event.target.value) })} /></label><div className="cio-actions"><button className="cd-btn cd-btn-primary" type="button" disabled={saving} onClick={() => void patchSession("save_analysis", analysis)}>{text(lang, "Confirmer l'analyse", "Confirm analysis")}</button></div></div> : null}
          {!loading && step === "targeting" ? <div className="cio-form"><div className="cio-intro"><h3>{text(lang, "Définir le ciblage", "Define targeting")}</h3><p>{text(lang, "Ces critères préparent la recherche. Ils ne sont pas encore des comptes cibles validés.", "These criteria prepare the search. They are not validated target accounts yet.")}</p></div><label><span>{text(lang, "Client idéal / audience recherchée", "Ideal customer / target audience")}</span><input value={criteria.idealCustomer} onChange={(event) => setCriteria({ ...criteria, idealCustomer: event.target.value })} /></label><div className="cio-grid"><label><span>{text(lang, "Zone géographique", "Geographic area")}</span><input value={criteria.geography} onChange={(event) => setCriteria({ ...criteria, geography: event.target.value })} /></label><label><span>{text(lang, "Langue", "Language")}</span><input value={criteria.language} onChange={(event) => setCriteria({ ...criteria, language: event.target.value })} /></label></div><label><span>{text(lang, "Niche", "Niche")}</span><input value={criteria.niche} onChange={(event) => setCriteria({ ...criteria, niche: event.target.value })} /></label><label><span>{text(lang, "Description de l'activité", "Business description")}</span><textarea rows={4} value={criteria.businessDescription} onChange={(event) => setCriteria({ ...criteria, businessDescription: event.target.value })} /></label><label><span>{text(lang, "Thèmes", "Themes")}</span><input value={listInput(criteria.themes)} onChange={(event) => setCriteria({ ...criteria, themes: parseList(event.target.value) })} /></label><label><span>{text(lang, "Mots-clés", "Keywords")}</span><input value={listInput(criteria.keywords)} onChange={(event) => setCriteria({ ...criteria, keywords: parseList(event.target.value) })} /></label><div className="cio-actions"><button className="cd-btn cd-btn-primary" type="button" disabled={saving} onClick={() => void patchSession("save_targeting", criteria)}>{text(lang, "Enregistrer et choisir les cibles", "Save and choose targets")}</button></div></div> : null}
          {!loading && step === "targets" && session?.accountId ? <div className="cio-form cio-confirmation"><div className="cio-intro"><span className="cio-kicker"><Check size={14} />{text(lang, "CONFIRMATION DES CIBLES", "TARGET CONFIRMATION")}</span><h3>{text(lang, "Valider les comptes cibles", "Validate target accounts")}</h3><p>{text(lang, "Le drawer complet est l'espace de travail commun à tous les packages. Cette vue confirme ensuite le résultat serveur.", "The full drawer is the shared workspace for every package. This view then confirms the server result.")}</p></div><div className={`cio-target-count ${eligibleCount >= requiredCount ? "ready" : ""}`}><strong>{eligibleCount} / {requiredCount}</strong><span>{text(lang, "comptes cibles validés", "validated target accounts")}</span></div><div className="cio-target-summary"><span>{text(lang, "En attente", "Pending")}: {targets?.summary.pendingReview ?? 0}</span><span>{text(lang, "Rejetés", "Rejected")}: {targets?.summary.rejected ?? 0}</span><span>{text(lang, "Archivés", "Archived")}: {targets?.summary.archivedCount ?? 0}</span></div><div className="cio-actions split"><button className="cio-secondary" type="button" onClick={() => setDrawerOpen(true)}>{text(lang, "Gérer les comptes cibles", "Manage target accounts")}</button><button className="cio-primary" type="button" disabled={saving || eligibleCount < requiredCount} onClick={() => void patchSession("complete")}>{text(lang, "Terminer l'onboarding", "Complete onboarding")}<ArrowRight size={16} /></button></div></div> : null}
          {!loading && step === "complete" ? <div className="cio-complete"><span aria-hidden="true">✓</span><h3>{text(lang, "Ciblage terminé", "Targeting complete")}</h3><p>{text(lang, "Identifiants reçus, analyse vérifiée, critères confirmés et 15 comptes cibles validés.", "Credentials received, analysis reviewed, criteria confirmed, and 15 target accounts validated.")}</p><p className="cio-note">{session?.assignmentStatus === "assigned" ? text(lang, "Le téléphone est affecté et la connexion reste en attente. Auto Login démarrera uniquement après ton clic explicite depuis le tableau de bord.", "The phone is assigned and login remains pending. Auto Login will start only after your explicit click from the dashboard.") : text(lang, "L'affectation reste en attente de capacité. Aucune connexion, action ou run n'a été lancé.", "Assignment is waiting for capacity. No login, action, or run has been started.")}</p><button className="cd-btn cd-btn-primary" type="button" onClick={onClose}>{text(lang, "Retour au tableau de bord", "Return to dashboard")}</button></div> : null}
        </div>
      </section>
      {session?.accountId ? <ClientAccountTargetsDrawer variant="onboarding" open={drawerOpen} onClose={() => { setDrawerOpen(false); void loadTargets(session.accountId!); }} lang={lang} copy={targetCopy(lang)} accountId={session.accountId} accountUsername={session.requestedUsername} packageCode={session.packageCode} overview={targets} onOverviewChange={setTargets} onReload={() => loadTargets(session.accountId!)} aiInitialCriteria={{ niche: criteria.niche, location: criteria.geography }} /> : null}
      <style jsx>{`
        .cio-shell{--cio-bg:#080b1b;--cio-panel:#10162b;--cio-panel-2:#151d34;--cio-border:#2a3350;--cio-text:#f7f8fc;--cio-muted:#9aa5bf;--cio-pink:#d95cff;--cio-orange:#ff9d57;--cio-green:#4ee2a0;width:min(1040px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;position:relative;background:var(--cio-bg);color:var(--cio-text);border:1px solid #303956;border-radius:8px;box-shadow:0 28px 90px rgba(1,3,14,.72)}
        .cio-accent{height:3px;background:linear-gradient(90deg,var(--cio-pink),#f36fa9 42%,var(--cio-orange));position:sticky;top:0;z-index:5}
        .cio-header{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:22px 26px;border-bottom:1px solid var(--cio-border);background:rgba(9,13,30,.96)}
        .cio-brand{display:flex;align-items:center;gap:13px}.cio-brand-icon{width:40px;height:40px;display:grid;place-items:center;border:1px solid rgba(217,92,255,.48);border-radius:8px;color:#fff;background:linear-gradient(145deg,rgba(217,92,255,.28),rgba(255,157,87,.16))}.cio-header p{margin:0 0 5px;color:#bd86df;font-size:.7rem;font-weight:800;letter-spacing:.08em}.cio-header h2{margin:0;font-size:1.25rem;letter-spacing:0}.cio-header-meta{display:flex;align-items:center;gap:8px}.cio-package,.cio-ai-state{display:inline-flex;align-items:center;gap:5px;padding:6px 9px;border:1px solid var(--cio-border);border-radius:6px;color:#d7dced;background:#131a30;font-size:.72rem;font-weight:750}.cio-ai-state.active{border-color:rgba(78,226,160,.35);color:#7ff2b9;background:rgba(78,226,160,.08)}.cio-ai-state.locked{border-color:rgba(255,184,92,.3);color:#ffc478;background:rgba(255,157,87,.08)}.cio-icon-btn{width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--cio-border);border-radius:6px;background:#11172a;color:#d7dced;cursor:pointer}.cio-icon-btn:hover{border-color:#59627e;color:#fff}
        .cio-progress{list-style:none;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin:0;padding:18px 26px;border-bottom:1px solid var(--cio-border);background:#0d1225}.cio-progress li{position:relative;display:flex;align-items:center;gap:8px;color:#747f9c;font-size:.72rem;font-weight:700;min-width:0}.cio-progress li:not(:last-child)::after{content:"";position:absolute;height:1px;background:#29324c;left:calc(100% - 2px);width:16px}.cio-progress li span{display:grid;place-items:center;width:25px;height:25px;border:1px solid #3b4563;border-radius:50%;flex:0 0 auto;color:#8993ae;background:#11172a}.cio-progress li.active{color:#fff}.cio-progress li.active span{border-color:#e56ccb;background:linear-gradient(135deg,#bf4ee8,#ef8a75);color:#fff;box-shadow:0 0 18px rgba(217,92,255,.24)}.cio-progress li.done{color:#74dcae}.cio-progress li.done span{background:rgba(78,226,160,.12);border-color:rgba(78,226,160,.55);color:#76efb5}
        .cio-body{padding:26px;background:radial-gradient(circle at 80% 0,rgba(151,71,214,.08),transparent 34%)}.cio-form{display:grid;gap:16px;padding:22px;border:1px solid var(--cio-border);border-radius:8px;background:linear-gradient(180deg,rgba(21,29,52,.98),rgba(15,21,40,.98))}.cio-intro h3{margin:0 0 7px;font-size:1.22rem}.cio-intro p,.cio-note{margin:0;color:var(--cio-muted);line-height:1.55}.cio-kicker{display:inline-flex;align-items:center;gap:6px;margin-bottom:8px;color:#df7cd7;font-size:.7rem;font-weight:800;letter-spacing:.08em}.cio-form label{display:grid;gap:7px}.cio-form label>span{font-size:.76rem;font-weight:750;color:#c1c9db}.cio-form input,.cio-form textarea{width:100%;box-sizing:border-box;border:1px solid #36405d;border-radius:6px;background:#0c1123;color:#f7f8fc;padding:11px 12px;font:inherit;letter-spacing:0;outline:none}.cio-form input:focus,.cio-form textarea:focus{border-color:#c65bdd;box-shadow:0 0 0 3px rgba(198,91,221,.12)}.cio-form textarea{resize:vertical}.cio-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px}
        .cio-password{display:grid;grid-template-columns:1fr auto}.cio-password input{border-radius:6px 0 0 6px}.cio-password button{border:1px solid #36405d;border-left:0;border-radius:0 6px 6px 0;background:#171e35;color:#cdd4e5;padding:0 13px;font-weight:700}.cio-actions{display:flex;justify-content:flex-end;margin-top:4px}.cio-actions.split{justify-content:space-between;gap:12px}.cio-primary,.cio-secondary{min-height:42px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:6px;padding:0 16px;font:inherit;font-size:.83rem;font-weight:800;cursor:pointer}.cio-primary{border:0;color:#fff;background:linear-gradient(95deg,#b64ee7,#ed6f9f 52%,#f39a54);box-shadow:0 8px 25px rgba(211,84,184,.18)}.cio-primary:disabled{opacity:.45;cursor:not-allowed}.cio-secondary{border:1px solid #414c6a;color:#e4e7f0;background:#171e34}.cio-error{padding:11px 13px;border:1px solid rgba(255,106,116,.4);border-radius:6px;background:rgba(255,71,87,.09);color:#ff9ca3}.cio-state{text-align:center;color:var(--cio-muted);padding:30px}
        .cio-profile{display:flex;gap:13px;align-items:center;padding:14px;border:1px solid var(--cio-border);border-radius:7px;background:#10162a}.cio-profile img,.cio-avatar{width:56px;height:56px;border-radius:50%;object-fit:cover;background:#1d263d;display:grid;place-items:center;font-weight:800}.cio-profile p,.cio-profile small{margin:3px 0 0;color:var(--cio-muted)}.cio-target-count{display:flex;align-items:baseline;gap:10px;padding:20px;border:1px solid rgba(255,157,87,.35);border-radius:7px;background:rgba(255,157,87,.07)}.cio-target-count.ready{border-color:rgba(78,226,160,.42);background:rgba(78,226,160,.07)}.cio-target-count strong{font-size:1.75rem;color:#fff}.cio-target-count span{color:var(--cio-muted)}.cio-target-summary{display:flex;gap:10px;flex-wrap:wrap;color:#aeb7ca;font-size:.78rem}.cio-target-summary span{padding:6px 9px;border:1px solid #313b57;border-radius:6px;background:#10162a}
        .cio-complete{text-align:center;display:grid;justify-items:center;gap:13px;padding:34px 20px;border:1px solid var(--cio-border);border-radius:8px;background:linear-gradient(180deg,#151d34,#0f1528)}.cio-complete>span{display:grid;place-items:center;width:58px;height:58px;border-radius:50%;background:linear-gradient(145deg,#31d99a,#8d72ed);color:#fff;font-size:1.8rem;box-shadow:0 0 30px rgba(78,226,160,.18)}.cio-complete h3,.cio-complete p{margin:0}.cio-complete p{max-width:620px;line-height:1.55;color:var(--cio-muted)}
        @media(max-width:760px){.cio-shell{width:calc(100vw - 16px);max-height:calc(100vh - 16px)}.cio-header{padding:16px}.cio-header-meta{align-items:flex-end}.cio-package,.cio-ai-state{display:none}.cio-progress{grid-template-columns:1fr;padding:14px 18px;gap:7px}.cio-progress li:not(.active):not(.done){display:none}.cio-progress li::after{display:none}.cio-grid{grid-template-columns:1fr}.cio-body{padding:16px}.cio-form{padding:17px}.cio-actions.split{flex-direction:column}.cio-actions.split button{width:100%}}
      `}</style>
    </div>
  );
}
