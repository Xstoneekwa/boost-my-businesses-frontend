"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import ClientNotificationsPanel from "./ClientNotificationsPanel";
import ClientAccountsSection, { type ClientInstagramAccountView } from "./ClientAccountsSection";
import ClientAgencyModeBanner from "./ClientAgencyModeBanner";
import type { ClientAccountNotificationsProjection } from "@/lib/instagram-client/client-account-notifications";
import ClientAccountTargetsDrawer, { mainTargetingItems } from "./ClientAccountTargetsDrawer";
import ClientActivityPanel from "./ClientActivityPanel";
import ClientDmTemplatesSection from "./ClientDmTemplatesSection";
import ClientOverviewRecentFeed from "./ClientOverviewRecentFeed";
import TargetAvatar from "./TargetAvatar";
import { buildTargetsOverview, isArchivedOrDeletedTarget, type TargetSafeRow, type TargetsOverview } from "@/app/instagram-dashboard/targets-data";
import { normalizeTargetUsername } from "@/lib/instagram-targets";
import type { ClientAccountInsights } from "@/lib/instagram-client/load-account-insights";
import type { LoadClientFollowerGrowthResult } from "@/lib/instagram-client/load-client-follower-growth";
import type { ClientLinkedInstagramAccount, ClientWorkspaceView } from "@/lib/instagram-client/workspace-data";
import {
  buildAccountManagerOverview,
  buildOverviewStats,
  buildSubscriptionOverviewCard,
} from "@/lib/instagram-client/client-overview-projection";
import {
  buildFollowerChartTitle,
  buildFollowerChartViews,
  type FollowerChartPeriod,
  type FollowerChartView,
} from "@/lib/instagram-client/client-follower-chart-projection";

// ─── Types ────────────────────────────────────────────────────────────────────
type Lang = "fr" | "en";
type Theme = "dark" | "light";
type View = "overview" | "activity" | "targeting" | "dm-templates" | "account";

type ClientDashboardActionNotification = {
  id: string;
  accountId: string;
  username: string;
  type: "password_update_required";
  status: string;
  message: string;
  createdAt: string | null;
  actionHref: string;
};
type ClientInstagramAccount = ClientInstagramAccountView;
type ClientProgressSnapshot = {
  account_id: string;
  request_id: string | null;
  run_id: string | null;
  status: "unknown" | "queued" | "claimed" | "running" | "action_required" | "connected" | "failed" | "stopped";
  reason: string | null;
  action_required: null | { title: string; message: string; status: string };
  steps: Array<{ id: string; label: string; subtitle: string; status: "pending" | "running" | "done" | "failed" | "action_required" | "skipped" }>;
  process_log: Array<{ id: string; timestamp: string; phase: string; message: string }>;
};

interface Props {
  userId: string;
  tenantId: string;
  loginEmail?: string;
  initialNotifications?: ClientDashboardActionNotification[];
  initialAccountNotifications?: ClientAccountNotificationsProjection;
  initialAccounts?: ClientInstagramAccount[];
  initialWorkspace?: ClientWorkspaceView | null;
  initialAccountInsights?: ClientAccountInsights | null;
  initialFollowerGrowth?: LoadClientFollowerGrowthResult | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const LANG_KEY = "bmb_dash_lang";
const THEME_KEY = "bmb_th";

const INIT_TARGETS = ["mode_paris_fr","luxeboutique_fr","styliste_officiel","fashionweek_fr","createur_mode","parisienne_style","atelier_couture_fr","galerie_lafayette"];
const INIT_WHITE   = ["demo_protected","demo_vip","demo_partner"];
const INIT_BLACK   = ["spam_follow4follow","giveaway_daily","dropship_eushop","bot_network_99"];

const AVPAL = [
  ["#f58529","#dd2a7b"],["#8a3ab9","#cd486b"],["#5a6cf5","#e8a030"],["#fbbf24","#dd2a7b"],
  ["#34d399","#5a6cf5"],["#dd2a7b","#fbbf24"],["#e8a030","#8a3ab9"],["#5851db","#e1306c"],
];
function avPal(h: string) { return AVPAL[h.charCodeAt(0) % AVPAL.length]; }

function matchesTargetSearch(username: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase().replace(/^@+/, "");
  if (!normalizedQuery) return true;
  return username.trim().toLowerCase().replace(/^@+/, "").includes(normalizedQuery);
}

// ─── i18n ─────────────────────────────────────────────────────────────────────
const T = {
  fr: {
    views: { overview:"Vue d'ensemble", activity:"Activité", targeting:"Ciblage", "dm-templates":"DM Templates", account:"Mon compte" },
    nav: { dashboard:"Tableau de bord", campaign:"Campagne", myaccount:"Mon compte" },
    topbar: { active:"Campagne active" },
    stats: [
      { lbl:"Ce mois-ci",     val:"+342",  sub:"▲ 12% vs mois dernier" },
      { lbl:"Total gagné",    val:"+1 847",sub:"depuis jan. 2026" },
      { lbl:"Aujourd'hui",    val:"94",    sub:"follows + likes + stories" },
      { lbl:"Moy. / jour",    val:"14,3",  sub:"abonnés qualifiés réels" },
    ],
    chart: { title:"Abonnés", all:"Tout", d30:"30 jours", daily:"Quotidien" },
    feed: { title:"Activité récente", seeAll:"Tout voir →" },
    plan: { name:"Pro", price:"197€", period:"/mois", growth:"Croissance estimée", growthVal:"300–500 / mois", nextBill:"Prochain prélèvement", nextBillVal:"3 juil. 2026", support:"Support", supportVal:"7j / 7", manage:"Gérer mon abonnement" },
    mgr: { name:"Mythyl E.", sub:"Votre account manager", text:"Votre manager dédié surveille votre campagne chaque jour, ajuste le paramétrage chaque semaine et est disponible pour répondre à vos questions 7j/7.", email:"Envoyer un email", call:"Prendre RDV" },
    activity: {
      title:"Journal complet · 30 derniers jours",
      emptyTitle:"Activité",
      emptyBody:"Aucune activité disponible pour le moment",
      emptyNote:"Connectez un compte Instagram pour afficher l'activité de votre campagne.",
    },
    targeting: {
      intro:"Organisez votre campagne : les comptes que nous ciblons, votre liste blanche protégée et la liste noire que nous excluons.",
      detailBtn:"Ajouter les comptes cibles",
      searchPh:"Rechercher un compte cible…",
      searchEmpty:"Aucun compte ne correspond à votre recherche.",
      targets:"Comptes cibles", white:"Liste blanche", black:"Liste noire",
      placeholderW:"compte_protege", placeholderB:"compte_exclu",
      emptyT:"Aucun compte cible configuré pour le moment.", emptyW:"Aucun compte en liste blanche.", emptyB:"Aucun compte exclu.",
      emptyTitle:"Ciblage",
      emptyBody:"Ajoutez ou connectez un compte Instagram pour configurer le ciblage",
      emptyNote:"Rendez-vous dans Vue d'ensemble pour lier votre compte, puis revenez ici pour organiser vos listes.",
    },
    account: {
      profile:"Mon profil", subscription:"Abonnement",
      fname:"Prénom", lname:"Nom", phone:"Numéro de téléphone", email:"Email", ig:"Compte Instagram",
      save:"Enregistrer les modifications",
      planLabel:"Formule active", planVal:"Pro — 197€/mois",
      since:"Membre depuis", sinceVal:"15 janvier 2026",
      next:"Prochain prélèvement", nextVal:"3 juillet 2026 — 197€",
      periodEnd:"Échéance de l'abonnement",
      pay:"Moyen de paiement", payVal:"•••• •••• •••• 4242",
      changePlan:"Changer de formule",
      connectTitle:"Connexion Instagram",
      connectBody:"Nous connectons votre compte Instagram en toute sécurité. Ne fermez pas cette fenêtre pendant la connexion.",
      connectProgress:"Voir la progression",
      connectCheck:"Vérifier à nouveau",
      connectActionRequired:"Action requise : Instagram demande un code ou une confirmation.",
      connectActionHelp:"Terminez la confirmation sur le téléphone, puis cliquez sur Vérifier à nouveau.",
      emailHint:"Email de connexion — non modifiable ici",
      nextPending:"À configurer",
      managePayment:"Gérer le paiement",
      billingTitle:"Moyen de paiement",
      billingSoon:"Gestion du paiement bientôt disponible",
      billingNoMethod:"Aucun moyen de paiement lié pour le moment",
      billingInvoicesSoon:"Les factures seront disponibles ici après activation du paiement.",
      changePlanHelp:"Contactez le support pour modifier votre formule",
    },
    drawer: {
      kicker:"Cibles", title:"Comptes cibles",
      total:"Total", valid:"Valides / éligibles", archived:"Archivés",
      searchPh:"Filtrer par nom, santé, statut…",
      chips:["Tout","Actifs / valides","En attente","Rejetés","Archivés"],
      refresh:"Actualiser", export:"Exporter", del:"Supprimer la sélection",
      addLbl:"Ajouter une cible", addPh:"Nom d'utilisateur Instagram", addBtn:"Ajouter",
      bulkLbl:"Ajout groupé (un par ligne)", importBtn:"Importer",
      aiLbl:"Trouver mes comptes cibles avec l'IA", aiBtn:"Lancer la recherche avec l'IA",
      cols:["","Compte","Vérification","Éligibilité","Abonnés","Perf","FBR","Envoyés","Dern. usage","Ajouté"],
      elig:{ eligible:"Éligible", verified:"Vérifié", pending:"En attente", rejected:"Rejeté", archived:"Archivé" },
      perf:{ running:"En cours", pending:"En attente" },
      found:"trouvé", notFound:"introuvable",
    },
    servicePage:"Page du service",
    preview:"Aperçu démo — liez votre compte Instagram pour activer les données réelles de votre campagne.",
  },
  en: {
    views: { overview:"Overview", activity:"Activity", targeting:"Targeting", "dm-templates":"DM Templates", account:"My account" },
    nav: { dashboard:"Dashboard", campaign:"Campaign", myaccount:"Account" },
    topbar: { active:"Campaign active" },
    stats: [
      { lbl:"This month",   val:"+342",  sub:"▲ 12% vs last month" },
      { lbl:"Total gained", val:"+1 847",sub:"since Jan 2026" },
      { lbl:"Today",        val:"94",    sub:"follows + likes + stories" },
      { lbl:"Daily avg.",   val:"14.3",  sub:"real qualified followers" },
    ],
    chart: { title:"Followers", all:"All time", d30:"30 days", daily:"Daily" },
    feed: { title:"Recent activity", seeAll:"View all →" },
    plan: { name:"Pro", price:"€197", period:"/mo", growth:"Estimated growth", growthVal:"300–500 / mo", nextBill:"Next billing", nextBillVal:"Jul 3, 2026", support:"Support", supportVal:"7 days / week", manage:"Manage plan" },
    mgr: { name:"Mythyl E.", sub:"Your account manager", text:"Your dedicated manager monitors your campaign daily, fine-tunes settings weekly, and is available to answer your questions 7 days a week.", email:"Send email", call:"Book a call" },
    activity: {
      title:"Full activity log · last 30 days",
      emptyTitle:"Activity",
      emptyBody:"No activity available yet",
      emptyNote:"Connect an Instagram account to display your campaign activity.",
    },
    targeting: {
      intro:"Organise your campaign: the accounts we target, your protected whitelist, and the blacklist we exclude.",
      detailBtn:"Add target accounts",
      searchPh:"Search a target account…",
      searchEmpty:"No accounts match your search.",
      targets:"Target accounts", white:"Whitelist", black:"Blacklist",
      placeholderW:"protected_account", placeholderB:"excluded_account",
      emptyT:"No target accounts yet.", emptyW:"No whitelist accounts.", emptyB:"No excluded accounts.",
      emptyTitle:"Targeting",
      emptyBody:"Add or connect an Instagram account to configure targeting",
      emptyNote:"Go to Overview to link your account, then return here to manage your lists.",
    },
    account: {
      profile:"My profile", subscription:"Subscription",
      fname:"First name", lname:"Last name", phone:"Phone number", email:"Email", ig:"Instagram handle",
      save:"Save changes",
      planLabel:"Active plan", planVal:"Pro — €197/mo",
      since:"Member since", sinceVal:"January 15, 2026",
      next:"Next billing", nextVal:"July 3, 2026 — €197",
      periodEnd:"Subscription end date",
      pay:"Billing method", payVal:"•••• •••• •••• 4242",
      changePlan:"Change plan",
      connectTitle:"Instagram connection",
      connectBody:"We're connecting your Instagram account. Do not close this window while connection is in progress.",
      connectProgress:"View progress",
      connectCheck:"Check again",
      connectActionRequired:"Action required: Instagram is asking for a code or confirmation.",
      connectActionHelp:"Please complete the confirmation on the phone, then click Check again.",
      emailHint:"Login email — cannot be changed here",
      nextPending:"To be configured",
      managePayment:"Manage payment",
      billingTitle:"Payment method",
      billingSoon:"Payment management coming soon",
      billingNoMethod:"No payment method linked yet",
      billingInvoicesSoon:"Invoices will appear here after payment activation.",
      changePlanHelp:"Contact support to change your plan",
    },
    drawer: {
      kicker:"Targets", title:"Target accounts",
      total:"Total", valid:"Valid / eligible", archived:"Archived",
      searchPh:"Filter by username, health, status…",
      chips:["All","Active / valid","Pending","Rejected","Archived / deleted"],
      refresh:"Refresh", export:"Export", del:"Delete selected",
      addLbl:"Add target", addPh:"Instagram username", addBtn:"Add",
      bulkLbl:"Bulk add (one per line)", importBtn:"Import",
      aiLbl:"Find my target accounts with AI", aiBtn:"Launch AI search",
      cols:["","Username","Verification","Eligibility","Followers","Perf","FBR","Sent","Last used","Added"],
      elig:{ eligible:"Eligible", verified:"Verified", pending:"Pending", rejected:"Rejected", archived:"Archived" },
      perf:{ running:"Running", pending:"Pending" },
      found:"found", notFound:"not found",
    },
    servicePage:"Service page",
    preview:"Demo preview — link your Instagram account to activate your real campaign data.",
  },
};

// ─── Chart helpers ────────────────────────────────────────────────────────────
function smoothPath(pts: [number,number][]) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i-1)], p1 = pts[i], p2 = pts[i+1], p3 = pts[Math.min(pts.length-1, i+2)];
    const t = 0.18;
    const c1x = p1[0] + (p2[0]-p0[0])*t, c1y = p1[1] + (p2[1]-p0[1])*t;
    const c2x = p2[0] - (p3[0]-p1[0])*t, c2y = p2[1] - (p3[1]-p1[1])*t;
    d += `C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function formatLinkedAccountLine(account: ClientLinkedInstagramAccount, lang: Lang) {
  const status = account.connected
    ? (lang === "fr" ? "Connecté" : "Connected")
    : account.statusLabel === "Ready"
      ? (lang === "fr" ? "Prêt" : "Ready")
      : account.statusLabel === "Verification required"
        ? (lang === "fr" ? "Vérification requise" : "Verification required")
        : (lang === "fr" ? "Configuration en cours" : "Setup pending");
  return `@${account.username} · ${account.packageLabel} · ${status}`;
}

function PaymentBillingDrawer({ open, onClose, lang, t, billing }: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  t: typeof T["fr"];
  billing: ClientWorkspaceView["billing"] | null;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <>
      <div className={`cd-dwr-scrim${open ? " open" : ""}`} onClick={onClose}/>
      <aside className={`cd-dwr cd-billing-dwr${open ? " open" : ""}`} aria-hidden={!open}>
        <header className="cd-dwr-hd">
          <div className="cd-dwr-hd-l">
            <div>
              <div className="cd-dwr-kicker">{t.account.subscription}</div>
              <div className="cd-dwr-title">{t.account.billingTitle}</div>
            </div>
          </div>
          <button className="cd-dwr-x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" width={17} height={17} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>
        <div className="cd-dwr-body">
          <section className="cd-card cd-setup-required">
            <div className="cd-s-title">{billing?.status === "configured" ? t.account.managePayment : t.account.billingSoon}</div>
            <h2>{billing?.paymentMethodLabel || t.account.billingNoMethod}</h2>
            <p className="cd-setup-note">{t.account.billingInvoicesSoon}</p>
          </section>
        </div>
      </aside>
    </>
  );
}

function fmtPointLabel(capturedAt: string, lang: Lang) {
  const d = new Date(capturedAt);
  if (Number.isNaN(d.getTime())) return "";
  const MFR = ["jan","fév","mar","avr","mai","jun","jui","aoû","sep","oct","nov","déc"];
  const MEN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return lang === "en"
    ? `${MEN[d.getMonth()]} ${d.getDate()}`
    : `${d.getDate()} ${MFR[d.getMonth()]}`;
}

function followerDeltaStyles(tone: FollowerChartView["deltaTone"]) {
  if (tone === "positive") {
    return { color: "var(--good)", background: "var(--good-bg)", borderColor: "var(--good-line)" };
  }
  if (tone === "negative") {
    return { color: "var(--bad)", background: "var(--bad-bg)", borderColor: "var(--bad-line)" };
  }
  if (tone === "neutral") {
    return { color: "var(--ink-mute)", background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" };
  }
  return { color: "var(--ink-mute)", background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" };
}

function FollowerChart({ period, lang, onPeriodChange, title, views }: {
  period: FollowerChartPeriod;
  lang: Lang;
  onPeriodChange: (period: FollowerChartPeriod) => void;
  title: string;
  views: Record<FollowerChartPeriod, FollowerChartView>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(800);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const view = views[period];
  const data = view.points.map((point) => point.followersCount);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(e.contentRect.width || 400, 400)));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setHoverIdx(null);
  }, [period, view.points.length]);

  const H = 240;
  const padL = 44;
  const padR = 18;
  const padT = 14;
  const padB = 34;
  const cw = W - padL - padR;
  const ch = H - padT - padB;
  const showChart = view.showChart && data.length >= 2;
  const rawMin = showChart ? Math.min(...data) : 0;
  const rawMax = showChart ? Math.max(...data) : 0;
  const pad = showChart ? Math.max(1, Math.round((rawMax - rawMin) * 0.12)) : 1;
  const minV = rawMin - pad;
  const maxV = rawMax + pad;
  const rng = maxV - minV || 1;
  const xp = (i: number) => padL + (data.length <= 1 ? 0 : i * cw / (data.length - 1));
  const yp = (v: number) => padT + (1 - (v - minV) / rng) * ch;

  const pts = showChart ? data.map((v, i) => [xp(i), yp(v)] as [number, number]) : [];
  const linePath = showChart ? smoothPath(pts) : "";
  const areaPath = showChart
    ? `${linePath} L${xp(data.length - 1)},${padT + ch} L${xp(0)},${padT + ch} Z`
    : "";
  const activeIdx = hoverIdx ?? Math.max(0, data.length - 1);
  const diff = showChart && activeIdx > 0
    ? data[activeIdx] - data[activeIdx - 1]
    : 0;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!showChart) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    setHoverIdx(Math.max(0, Math.min(Math.round(relX * (data.length - 1)), data.length - 1)));
  };

  const gridSteps = 4;
  const gridLines = showChart
    ? Array.from({ length: gridSteps + 1 }, (_, i) => {
      const v = minV + i * (rng / gridSteps);
      return { v, y: yp(v) };
    })
    : [];

  const xTicks = showChart ? Math.min(7, data.length) : 0;
  const xLabels = showChart
    ? Array.from({ length: xTicks }, (_, xi) => {
      const idx = Math.round(xi * (data.length - 1) / Math.max(xTicks - 1, 1));
      const anchor = xi === 0 ? "start" : xi === xTicks - 1 ? "end" : "middle";
      return {
        idx,
        anchor,
        label: fmtPointLabel(view.points[idx]?.capturedAt ?? "", lang),
      };
    })
    : [];

  const tipLeftPct = showChart ? (xp(activeIdx) / W * 100) : 0;
  const tipLeft = tipLeftPct > 75 ? `${tipLeftPct - 22}%` : `${tipLeftPct}%`;
  const deltaStyles = followerDeltaStyles(view.deltaTone);
  const showDeltaBadge = view.deltaDisplay !== null;
  const deltaPrefix = view.deltaTone === "negative" ? "" : view.deltaTone === "positive" ? "" : "";

  return (
    <div className="cd-chart-card">
      <div className="cd-c-hd">
        <div className="cd-c-hd-left">
          <div className="cd-c-titlerow">
            <span className="cd-c-badge">
              <svg viewBox="0 0 24 24" fill="none" width={18} height={18}><path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/><circle cx="9.5" cy="7" r="4" stroke="#fff" strokeWidth={2}/><path d="M19 8v6M22 11h-6" stroke="#fff" strokeWidth={2} strokeLinecap="round"/></svg>
            </span>
            <h3 className="cd-c-title">{title}</h3>
          </div>
          <div className="cd-c-bignum">
            <span className="cd-c-foll-n">{view.mainValue}</span>
            {showDeltaBadge ? (
              <span className="cd-c-delta" style={deltaStyles}>
                {view.deltaTone === "unknown" ? null : (
                  <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" style={{ transform: view.deltaTone === "negative" ? "scaleY(-1)" : "none" }}><polyline points="6 14 12 8 18 14"/></svg>
                )}
                {deltaPrefix}{view.deltaDisplay}
              </span>
            ) : null}
          </div>
          {view.subtitle ? <div className="cd-c-sub">{view.subtitle}</div> : null}
        </div>
        <div className="cd-range-tabs">
          {(["all", "30d", "daily"] as FollowerChartPeriod[]).map((key) => {
            const label = key === "all"
              ? (lang === "fr" ? "Tout" : "All")
              : key === "30d"
                ? (lang === "fr" ? "30 jours" : "30 days")
                : (lang === "fr" ? "Quotidien" : "Daily");
            return (
              <button key={key} className={period === key ? "on" : ""} onClick={() => onPeriodChange(key)}>{label}</button>
            );
          })}
        </div>
      </div>
      <div ref={containerRef} style={{ position: "relative", marginTop: 8 }}>
        {showChart ? (
          <svg
            viewBox={`0 0 ${W} ${H}`}
            style={{ display: "block", width: "100%", overflow: "visible" }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id="cd-lg" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f7a52b"/>
                <stop offset="34%" stopColor="#f4506b"/>
                <stop offset="62%" stopColor="#d23db0"/>
                <stop offset="100%" stopColor="#8b3df5"/>
              </linearGradient>
              <linearGradient id="cd-ag" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#f4506b" stopOpacity={0.16}/>
                <stop offset="100%" stopColor="#8b3df5" stopOpacity={0}/>
              </linearGradient>
            </defs>
            {gridLines.map(({ v, y }) => (
              <g key={v}>
                <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth={1}/>
                <text x={padL - 10} y={y + 4} textAnchor="end" fontSize={11} fill="var(--ink-mute)" fontFamily="var(--font-d)" fontWeight={600}>
                  {Math.round(v).toLocaleString(lang === "fr" ? "fr-FR" : "en-US")}
                </text>
              </g>
            ))}
            <path d={areaPath} fill="url(#cd-ag)"/>
            <path d={linePath} fill="none" stroke="url(#cd-lg)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"/>
            {pts.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={4} fill="#fff" stroke="url(#cd-lg)" strokeWidth={2.4}/>
            ))}
            <circle cx={xp(activeIdx)} cy={yp(data[activeIdx])} r={6} fill="#fff" stroke="url(#cd-lg)" strokeWidth={3}/>
            {xLabels.map(({ idx, anchor, label }) => (
              <text key={idx} x={xp(idx)} y={H - 8} textAnchor={anchor as "start" | "middle" | "end"} fontSize={11} fill="var(--ink-mute)" fontFamily="var(--font-d)" fontWeight={600}>
                {label}
              </text>
            ))}
          </svg>
        ) : (
          <div className="cd-chart-empty" style={{ minHeight: H, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ color: "var(--ink-mute)", fontSize: 13 }}>
              {lang === "fr" ? "Courbe disponible après collecte d'historique" : "Chart available once history is collected"}
            </span>
          </div>
        )}
        {showChart && hoverIdx !== null && (
          <div className="cd-chart-tip" style={{ opacity: 1, left: tipLeft, top: 8 }}>
            <span className="cd-tv">{(diff >= 0 ? "+" : "") + diff.toLocaleString(lang === "fr" ? "fr-FR" : "en-US")}</span>
            <span>{fmtPointLabel(view.points[activeIdx]?.capturedAt ?? "", lang)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function ClientDashboard({
  userId: _userId,
  tenantId: _tenantId,
  loginEmail = "",
  initialNotifications = [],
  initialAccountNotifications = { featureAvailable: true, active: [], recentResolved: [], activeCount: 0, unreadActiveCount: 0 },
  initialAccounts = [],
  initialWorkspace = null,
  initialAccountInsights = null,
  initialFollowerGrowth = null,
}: Props) {
  const [activeView, setActiveView]     = useState<View>("overview");
  const [lang,       setLang]           = useState<Lang>("fr");
  const [theme,      setTheme]          = useState<Theme>("dark");
  const [chartPeriod, setChartPeriod]   = useState<FollowerChartPeriod>("all");
  const [drawerOpen, setDrawerOpen]     = useState(false);
  const [billingDrawerOpen, setBillingDrawerOpen] = useState(false);
  const [loggingOut, setLoggingOut]     = useState(false);
  const [connectProgress, setConnectProgress] = useState<{ account: ClientInstagramAccount; snapshot: ClientProgressSnapshot | null; message: string } | null>(null);
  const [workspace, setWorkspace] = useState<ClientWorkspaceView | null>(initialWorkspace);
  const [accountInsights] = useState<ClientAccountInsights | null>(initialAccountInsights);
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    firstName: initialWorkspace?.firstName || "",
    lastName: initialWorkspace?.lastName || "",
    phone: initialWorkspace?.phone || "",
    email: initialWorkspace?.authEmail || initialWorkspace?.contactEmail || loginEmail,
  });
  const [addW, setAddW] = useState("");
  const [addB, setAddB] = useState("");
  const router = useRouter();

  const hasLinkedInstagramAccount = initialAccounts.length > 0
    || initialNotifications.length > 0
    || (initialWorkspace?.linkedInstagramAccounts?.length ?? 0) > 0
    || (workspace?.linkedInstagramAccounts?.length ?? 0) > 0;
  const hasOverviewInsights = Boolean(accountInsights);
  const demoMode = !hasLinkedInstagramAccount;

  const [targetingOverview, setTargetingOverview] = useState<TargetsOverview | null>(null);
  const [demoTargetList, setDemoTargetList] = useState(INIT_TARGETS);
  const [whitelist, setWhitelist] = useState(hasOverviewInsights ? accountInsights!.whitelist : INIT_WHITE);
  const [blacklist, setBlacklist] = useState(hasOverviewInsights ? accountInsights!.blacklist : INIT_BLACK);
  const [targetingLoading, setTargetingLoading] = useState(false);
  const [targetingMessage, setTargetingMessage] = useState<string | null>(null);
  const [targetSearchQuery, setTargetSearchQuery] = useState("");
  const [accountNotifications, setAccountNotifications] = useState(initialAccountNotifications);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const t = T[lang];
  const linkedAccountsForAccountTab: ClientLinkedInstagramAccount[] = workspace?.linkedInstagramAccounts?.length
    ? workspace.linkedInstagramAccounts
    : initialAccounts.map((account) => ({
        accountId: account.accountId,
        username: account.username,
        packageLabel: account.packageLabel,
        statusLabel: account.connected ? "Connected" : account.readinessLabel,
        connected: account.connected,
      }));
  const primaryAccount = linkedAccountsForAccountTab[0]
    ? {
        accountId: linkedAccountsForAccountTab[0].accountId,
        username: linkedAccountsForAccountTab[0].username,
        packageLabel: linkedAccountsForAccountTab[0].packageLabel,
        accountStatus: "",
        onboardingStatus: "",
        provisioningStatus: "",
        loginStatus: linkedAccountsForAccountTab[0].connected ? "connected" : "unknown",
        assignmentStatus: "",
        readinessLabel: linkedAccountsForAccountTab[0].statusLabel,
        connected: linkedAccountsForAccountTab[0].connected,
      }
    : (initialNotifications[0] ? {
      accountId: initialNotifications[0].accountId,
      username: initialNotifications[0].username,
    } as ClientInstagramAccount : null);

  const targetingAccountId = primaryAccount?.accountId || accountInsights?.accountId || "";
  const targetingUsername = primaryAccount?.username || accountInsights?.username || "";
  const targetingPackageCode = accountInsights?.packageCode || primaryAccount?.packageLabel?.toLowerCase() || "growth";
  const useLiveTargeting = hasLinkedInstagramAccount && Boolean(targetingAccountId);
  const useLiveData = useLiveTargeting;
  const demoTargets = demoTargetList;
  const targetingItems = useLiveData ? mainTargetingItems(targetingOverview) : demoTargets.map((username) => ({
    id: username,
    targetUsername: username,
    avatarUrl: null,
    avatarAvailable: false,
  }));
  const filteredTargetingItems = useMemo(
    () => targetingItems.filter((item) => matchesTargetSearch(item.targetUsername, targetSearchQuery)),
    [targetingItems, targetSearchQuery],
  );
  const targets = targetingItems.map((item) => item.targetUsername);

  const reloadTargeting = useCallback(async () => {
    if (!targetingAccountId || !useLiveData) return;
    setTargetingLoading(true);
    setTargetingMessage(null);
    try {
      const [targetsResponse, filtersResponse] = await Promise.all([
        fetch(`/api/instagram-client/accounts/${encodeURIComponent(targetingAccountId)}/targets`, {
          headers: { Accept: "application/json" },
        }),
        fetch(`/api/instagram-client/accounts/${encodeURIComponent(targetingAccountId)}/filters`, {
          headers: { Accept: "application/json" },
        }),
      ]);
      const targetsPayload = await targetsResponse.json() as { ok?: boolean; data?: TargetSafeRow[]; error?: string };
      const filtersPayload = await filtersResponse.json() as { ok?: boolean; data?: { whitelist?: string[]; blacklist?: string[] }; error?: string };
      if (!targetsResponse.ok || !targetsPayload.ok || !Array.isArray(targetsPayload.data)) {
        throw new Error(targetsPayload.error || "Could not load targets.");
      }
      if (!filtersResponse.ok || !filtersPayload.ok || !filtersPayload.data) {
        throw new Error(filtersPayload.error || "Could not load filters.");
      }
      setTargetingOverview(buildTargetsOverview(targetsPayload.data));
      setWhitelist(filtersPayload.data.whitelist ?? []);
      setBlacklist(filtersPayload.data.blacklist ?? []);
    } catch (error) {
      setTargetingMessage(error instanceof Error ? error.message : "Could not load targeting data.");
    } finally {
      setTargetingLoading(false);
    }
  }, [targetingAccountId, useLiveData]);

  useEffect(() => {
    if (useLiveData && targetingAccountId) {
      void reloadTargeting();
    }
  }, [useLiveData, targetingAccountId, reloadTargeting]);

  async function persistFilterLists(nextWhitelist: string[], nextBlacklist: string[]) {
    if (!targetingAccountId || !useLiveData) return;
    const response = await fetch(`/api/instagram-client/accounts/${encodeURIComponent(targetingAccountId)}/filters`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ whitelist: nextWhitelist, blacklist: nextBlacklist }),
    });
    const payload = await response.json() as { ok?: boolean; data?: { whitelist?: string[]; blacklist?: string[] }; error?: string };
    if (!response.ok || !payload.ok || !payload.data) {
      throw new Error(payload.error || "Could not save filters.");
    }
    setWhitelist(payload.data.whitelist ?? nextWhitelist);
    setBlacklist(payload.data.blacklist ?? nextBlacklist);
  }

  async function archiveTargetByUsername(username: string) {
    if (!targetingAccountId || !useLiveData || !targetingOverview) return;
    const normalized = normalizeTargetUsername(username);
    const item = targetingOverview.items.find(
      (row) => row.targetUsername === normalized && !isArchivedOrDeletedTarget(row),
    );
    if (!item) return;
    const response = await fetch(`/api/instagram-client/accounts/${encodeURIComponent(targetingAccountId)}/targets`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ ids: [item.id] }),
    });
    const payload = await response.json() as { ok?: boolean; error?: string };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Could not archive target.");
    }
    await reloadTargeting();
  }

  useEffect(() => {
    const accountId = connectProgress?.account.accountId;
    if (!accountId) return undefined;
    const scopedAccountId = accountId;
    let cancelled = false;

    async function pollClientProgress() {
      try {
        const response = await fetch(`/api/instagram-dashboard/runs/progress?account_id=${encodeURIComponent(scopedAccountId)}&audience=client`, {
          headers: { Accept: "application/json" },
        });
        const payload = await response.json() as { ok?: boolean; data?: ClientProgressSnapshot; error?: string };
        if (!response.ok || !payload.ok || !payload.data) {
          throw new Error(payload.error || "Could not load connection progress.");
        }
        if (!cancelled) {
          setConnectProgress((current) => current ? { ...current, snapshot: payload.data ?? null, message: payload.data?.reason || current.message } : current);
        }
      } catch (progressError) {
        if (!cancelled) {
          setConnectProgress((current) => current ? {
            ...current,
            message: progressError instanceof Error ? progressError.message : "Could not load connection progress.",
          } : current);
        }
      }
    }

    void pollClientProgress();
    const interval = window.setInterval(() => {
      void pollClientProgress();
    }, 6000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [connectProgress?.account.accountId]);

  useEffect(() => {
    const l = localStorage.getItem(LANG_KEY) as Lang|null;
    if (l === "fr" || l === "en") setLang(l);
    const th = localStorage.getItem(THEME_KEY) as Theme|null;
    if (th === "dark" || th === "light") setTheme(th);
  }, []);

  useEffect(() => { localStorage.setItem(LANG_KEY, lang); }, [lang]);
  useEffect(() => { localStorage.setItem(THEME_KEY, theme); }, [theme]);

  useEffect(() => {
    if (activeView !== "account") return undefined;
    let cancelled = false;
    async function refreshWorkspace() {
      try {
        const response = await fetch("/api/instagram-client/workspace", { headers: { Accept: "application/json" } });
        const payload = await response.json() as { ok?: boolean; data?: ClientWorkspaceView; error?: string };
        if (cancelled || !response.ok || !payload.ok || !payload.data) return;
        setWorkspace(payload.data);
        setProfileForm({
          firstName: payload.data.firstName,
          lastName: payload.data.lastName,
          phone: payload.data.phone,
          email: payload.data.authEmail || payload.data.contactEmail,
        });
      } catch {
        // Keep server-rendered workspace if refresh fails.
      }
    }
    void refreshWorkspace();
    return () => {
      cancelled = true;
    };
  }, [activeView]);

  const handleNavigate = useCallback((view: View) => setActiveView(view), []);

  const handleNotificationNavigate = useCallback((href: string) => {
    try {
      const url = new URL(href, window.location.origin);
      const view = url.searchParams.get("view");
      if (view === "overview" || view === "activity" || view === "targeting" || view === "dm-templates" || view === "account") {
        setActiveView(view);
      }
    } catch {
      // Ignore malformed deep links.
    }
    setNotificationsOpen(false);
  }, []);

  const handleMarkNotificationRead = useCallback(async (notificationId: string) => {
    const response = await fetch("/api/instagram-client/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ notification_id: notificationId, action: "mark_read" }),
    });
    const payload = await response.json() as { ok?: boolean; data?: ClientAccountNotificationsProjection["active"][number] };
    if (!response.ok || !payload.ok || !payload.data) return;
    setAccountNotifications((current) => {
      const active = current.active.map((row) => (
        row.id === notificationId ? { ...row, readAt: payload.data?.readAt ?? new Date().toISOString() } : row
      ));
      return {
        ...current,
        active,
        activeCount: active.length,
        unreadActiveCount: active.filter((row) => !row.readAt).length,
      };
    });
  }, []);

  useEffect(() => {
    try {
      const view = new URLSearchParams(window.location.search).get("view");
      if (view === "overview" || view === "activity" || view === "targeting" || view === "dm-templates" || view === "account") {
        setActiveView(view);
      }
    } catch {
      // Ignore malformed query strings.
    }
  }, []);

  const sidebarName = workspace?.displayName || [profileForm.firstName, profileForm.lastName].filter(Boolean).join(" ") || "Client";
  const sidebarPlan = workspace?.clientPlanLabel || accountInsights?.packageLabel || "—";
  const activityBadge = hasOverviewInsights && accountInsights?.recentFeed.length
    ? accountInsights.recentFeed.reduce((sum, item) => sum + item.count, 0)
    : undefined;
  const notificationsFeatureAvailable = accountNotifications.featureAvailable !== false;
  const notificationBadge = notificationsFeatureAvailable && accountNotifications.activeCount > 0
    ? accountNotifications.activeCount
    : undefined;
  const overviewRecentFeed = hasOverviewInsights ? (accountInsights?.recentFeed ?? []) : [];
  const overviewStats = buildOverviewStats(accountInsights, lang);
  const followerChartUsername = primaryAccount?.username || accountInsights?.username || initialFollowerGrowth?.username || null;
  const followerChartTitle = buildFollowerChartTitle(followerChartUsername, lang);
  const followerChartViews = useMemo(() => {
    if (!initialFollowerGrowth?.bundle) {
      const emptySeries = {
        period: "all" as const,
        businessTimezone: "Africa/Johannesburg",
        clientLinkedAt: null,
        currentFollowers: null,
        currentCapturedAt: null,
        periodStartFollowers: null,
        periodStartCapturedAt: null,
        delta: null,
        deltaStatus: "unknown" as const,
        historyStartDate: null,
        points: [],
        coverageStatus: "none" as const,
      };
      const emptyBundle = { all: emptySeries, d30: { ...emptySeries, period: "30d" as const }, daily: { ...emptySeries, period: "daily" as const } };
      return buildFollowerChartViews(emptyBundle, lang);
    }
    return buildFollowerChartViews(initialFollowerGrowth.bundle, lang);
  }, [initialFollowerGrowth, lang]);
  const subscriptionPlanValue = workspace?.clientPlanLabel || accountInsights?.packageLabel || "";
  const subscriptionCard = buildSubscriptionOverviewCard(workspace, subscriptionPlanValue, lang);
  const accountManagerCard = buildAccountManagerOverview(workspace, lang, {
    subtitle: t.mgr.sub,
    text: t.mgr.text,
    emailLabel: t.mgr.email,
    bookingLabel: t.mgr.call,
  });
  const memberSinceValue = workspace?.memberSince
    ? new Date(workspace.memberSince).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const billingDateLabel = workspace?.billingDisplayMode === "next_billing"
    ? t.account.next
    : t.account.periodEnd;
  const billingDateIso = workspace?.billing?.nextBillingLabel || workspace?.subscriptionPeriodEnd || "";
  const billingDateValue = billingDateIso
    ? new Date(billingDateIso).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", { year: "numeric", month: "long", day: "numeric" })
    : t.account.nextPending;
  const paymentMethodValue = workspace?.paymentMethodDisplay || t.account.billingNoMethod;
  const instagramSummary = linkedAccountsForAccountTab.length
    ? linkedAccountsForAccountTab.map((account) => formatLinkedAccountLine(account, lang)).join("\n")
    : (lang === "fr" ? "Aucun compte lié" : "No linked account");

  async function handleSaveProfile() {
    if (accountSaving) return;
    setAccountSaving(true);
    setAccountMessage(null);
    try {
      const response = await fetch("/api/instagram-client/workspace", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          first_name: profileForm.firstName,
          last_name: profileForm.lastName,
          phone: profileForm.phone,
          preferred_language: lang,
        }),
      });
      const payload = await response.json() as { ok?: boolean; data?: ClientWorkspaceView; error?: string };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error || "Could not save profile.");
      }
      setWorkspace(payload.data);
      setProfileForm({
        firstName: payload.data.firstName,
        lastName: payload.data.lastName,
        phone: payload.data.phone,
        email: payload.data.authEmail || payload.data.contactEmail,
      });
      setAccountMessage(lang === "fr" ? "Profil enregistré." : "Profile saved.");
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Could not save profile.");
    } finally {
      setAccountSaving(false);
    }
  }

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/instagram-auth/session", { method: "DELETE" });
    } finally {
      router.push("/instagram-login");
    }
  }

  function tgClean(v: string) { return v.trim().replace(/^@+/, "").replace(/\s+/g, "").toLowerCase(); }

  function addToList(list: "white"|"black", value: string) {
    const h = tgClean(value);
    if (!h) return;
    void (async () => {
      try {
        if (list === "white") {
          if (whitelist.includes(h)) return;
          const next = [h, ...whitelist];
          if (useLiveData) await persistFilterLists(next, blacklist);
          else setWhitelist(next);
          setAddW("");
        } else {
          if (blacklist.includes(h)) return;
          const next = [h, ...blacklist];
          if (useLiveData) await persistFilterLists(whitelist, next);
          else setBlacklist(next);
          setAddB("");
        }
      } catch (error) {
        setTargetingMessage(error instanceof Error ? error.message : "Could not update filters.");
      }
    })();
  }

  async function removeFromFilterList(list: "white"|"black", username: string) {
    try {
      if (list === "white") {
        const next = whitelist.filter((row) => row !== username);
        if (useLiveData) await persistFilterLists(next, blacklist);
        else setWhitelist(next);
      } else {
        const next = blacklist.filter((row) => row !== username);
        if (useLiveData) await persistFilterLists(whitelist, next);
        else setBlacklist(next);
      }
    } catch (error) {
      setTargetingMessage(error instanceof Error ? error.message : "Could not update filters.");
    }
  }

  async function removeTargetFromList(username: string) {
    try {
      if (useLiveData) await archiveTargetByUsername(username);
      else setDemoTargetList((current) => current.filter((row) => row !== username));
    } catch (error) {
      setTargetingMessage(error instanceof Error ? error.message : "Could not archive target.");
    }
  }

  const navItems: { view: View; label: string; icon: React.ReactNode; badge?: number; section?: string }[] = [
    { view:"overview",  label:t.views.overview,  section:t.nav.dashboard, icon:<svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg> },
    { view:"activity",  label:t.views.activity,  icon:<svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>, badge:activityBadge },
    { view:"targeting", label:t.views.targeting, section:t.nav.campaign, icon:<svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg> },
    { view:"dm-templates", label:t.views["dm-templates"], icon:<svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><line x1="9" y1="10" x2="15" y2="10"/><line x1="9" y1="14" x2="13" y2="14"/></svg> },
    { view:"account",   label:t.views.account,   section:t.nav.myaccount, icon:<svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
  ];

  return (
    <div className={`cd-shell${theme === "light" ? " cd-light" : ""}`}>
      <style>{CSS}</style>

      {/* ── SIDEBAR ── */}
      <aside className="cd-sidebar">
        <div className="cd-sb-brand">
          <div className="cd-sb-mark"><span className="cd-sb-mark-b">B</span></div>
          <div className="cd-sb-name">
            <div className="cd-sb-name-main">Boost<span>My</span>Businesses</div>
            <div className="cd-sb-name-sub" style={{color:"var(--accent)"}}>Espace client</div>
          </div>
        </div>
        <nav className="cd-sb-nav">
          {navItems.map((item) => (
            <span key={item.view}>
              {item.section && <span className="cd-nl">{item.section}</span>}
              <a className={`cd-nav-link${activeView === item.view ? " active" : ""}`} href="#" onClick={e => { e.preventDefault(); handleNavigate(item.view); }}>
                {item.icon}
                <span>{item.label}</span>
                {item.badge && <span className="cd-bdg">{item.badge}</span>}
              </a>
            </span>
          ))}
          <a className="cd-nav-link" href="/instagram-growth" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            <span>{t.servicePage}</span>
          </a>
        </nav>
        <div className="cd-sb-logout-wrap">
          <button className="cd-sb-logout" onClick={handleLogout} disabled={loggingOut}>
            <LogOut size={15} strokeWidth={1.8} />
            <span>{loggingOut ? (lang === "fr" ? "Déconnexion…" : "Signing out…") : (lang === "fr" ? "Se déconnecter" : "Sign out")}</span>
          </button>
        </div>
        <div className="cd-sb-foot">
          <div className="cd-sb-acct">
            <div className="cd-sb-av">{sidebarName.charAt(0).toUpperCase()}</div>
            <div>
              <div className="cd-sb-aname">{sidebarName}</div>
              <div className="cd-sb-aplan">{sidebarPlan}</div>
            </div>
            <div className="cd-sb-live"><div className="cd-sb-dot"/></div>
          </div>
        </div>
      </aside>

      {/* ── TOPBAR ── */}
      <header className="cd-topbar">
        <h1 className="cd-tb-title">{t.views[activeView]}</h1>
        <div className="cd-tb-right">
          {notificationsFeatureAvailable ? (
            <button
              type="button"
              className={`cd-ic-btn cd-notif-btn${notificationsOpen ? " on" : ""}`}
              onClick={() => setNotificationsOpen((open) => !open)}
              aria-label={lang === "fr" ? "Notifications" : "Notifications"}
              title={lang === "fr" ? "Notifications" : "Notifications"}
            >
              <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {notificationBadge ? <span className="cd-notif-count">{notificationBadge}</span> : null}
            </button>
          ) : null}
          <div className="cd-stat-pill"><span className="cd-dot"/><span>{workspace?.campaignActive || accountInsights?.campaignActive ? t.topbar.active : (lang === "fr" ? "Espace client" : "Client workspace")}</span></div>
          <button className="cd-ic-btn" onClick={() => setTheme(th => th === "dark" ? "light" : "dark")} title="Toggle theme">
            <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </button>
          <div className="cd-lang-t">
            {(["fr","en"] as Lang[]).map(l => (
              <button key={l} className={lang === l ? "on" : ""} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
            ))}
          </div>
        </div>
      </header>

      {/* ── MAIN ── */}
      <main className="cd-main">
        {notificationsFeatureAvailable && notificationsOpen ? (
          <ClientNotificationsPanel
            lang={lang}
            projection={accountNotifications}
            onMarkRead={handleMarkNotificationRead}
            onNavigate={handleNotificationNavigate}
          />
        ) : null}

        {initialNotifications.length > 0 && (
          <section className="cd-action-alerts" aria-label="Required account actions">
            {initialNotifications.map((notification) => (
              <article className="cd-action-alert" key={notification.id}>
                <div className="cd-action-alert-ic">
                  <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="7.5" cy="15.5" r="4.5" />
                    <path d="M11 12l9-9" />
                    <path d="M15 7l2 2" />
                    <path d="M17 5l2 2" />
                  </svg>
                </div>
                <div>
                  <span>{lang === "fr" ? "Action requise" : "Action required"} · {notification.status}</span>
                  <strong>{lang === "fr" ? "Mise à jour du mot de passe Instagram requise" : "Instagram password update required"}</strong>
                  <p>{notification.message}</p>
                </div>
                <button className="cd-btn cd-btn-primary" onClick={() => handleNavigate("account")}>
                  {lang === "fr" ? "Mettre à jour" : "Update password"}
                </button>
              </article>
            ))}
          </section>
        )}

        {activeView === "overview" && (
          <div className="cd-view">
            <ClientAgencyModeBanner lang={lang} />
            <ClientAccountsSection lang={lang} accounts={hasLinkedInstagramAccount ? initialAccounts : []} />
            {demoMode ? (
              <p className="cd-preview-banner" role="note">{t.preview}</p>
            ) : null}
            {/* Stats */}
            <div className="cd-stats-row">
              {overviewStats.map((s, i) => (
                <div key={i} className="cd-sc">
                  <div className="cd-sc-lbl">{s.lbl}</div>
                  <div className={`cd-sc-val${s.highlight ? " cd-grad" : ""}`}>{s.val}</div>
                  <div className="cd-sc-sub"><span className={s.highlight ? "cd-up" : ""}>{s.sub}</span></div>
                </div>
              ))}
            </div>

            {/* Chart */}
            <FollowerChart
              period={chartPeriod}
              lang={lang}
              onPeriodChange={setChartPeriod}
              title={followerChartTitle}
              views={followerChartViews}
            />

            {/* Two-col */}
            <div className="cd-two-col">
              <div className="cd-card">
                <div className="cd-card-hd">
                  <h3>{t.feed.title}</h3>
                  <a href="#" onClick={e => { e.preventDefault(); handleNavigate("activity"); }}>{t.feed.seeAll}</a>
                </div>
                <ClientOverviewRecentFeed
                  items={overviewRecentFeed}
                  lang={lang}
                  emptyLabel={lang === "fr"
                    ? "Les premières activités de votre campagne apparaîtront ici."
                    : "Your campaign activity will appear here once it starts."}
                />
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                {/* Plan card */}
                <div className="cd-card cd-plan-wrap">
                  <div className="cd-plan-top">
                    <div className="cd-plan-name">{subscriptionCard.planName}</div>
                    <span className="cd-plan-tag">{subscriptionCard.statusLabel}</span>
                  </div>
                  <div className="cd-plan-price">{subscriptionCard.price}<small>{subscriptionCard.period}</small></div>
                  <div className="cd-plan-rows">
                    <div className="cd-pr"><span className="cd-pr-l">{t.plan.growth}</span><span className="cd-pr-v cd-a">{subscriptionCard.growthEstimate}</span></div>
                    <div className="cd-pr"><span className="cd-pr-l">{subscriptionCard.billingDateLabel}</span><span className="cd-pr-v">{subscriptionCard.nextBilling}</span></div>
                    <div className="cd-pr"><span className="cd-pr-l">{t.plan.support}</span><span className="cd-pr-v cd-g">{subscriptionCard.support}</span></div>
                  </div>
                  <button className="cd-btn cd-btn-primary cd-btn-full" onClick={() => handleNavigate("account")}>
                    <svg viewBox="0 0 24 24" width={13} height={13} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    {t.plan.manage}
                  </button>
                </div>
                {/* Manager card */}
                <div className="cd-manager-card">
                  <div className="cd-mgr-hd">
                    <div className="cd-mgr-av">{accountManagerCard.initial}</div>
                    <div><div className="cd-mgr-name">{accountManagerCard.name}</div><div className="cd-mgr-sub">{accountManagerCard.subtitle}</div></div>
                  </div>
                  <p className="cd-mgr-text">{accountManagerCard.text}</p>
                  <div className="cd-mgr-btns">
                    {accountManagerCard.emailHref ? (
                      <a className="cd-btn cd-btn-soft" style={{fontSize:".78rem",padding:"7px 13px"}} href={accountManagerCard.emailHref}>
                        <svg viewBox="0 0 24 24" width={13} height={13} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        {accountManagerCard.emailLabel}
                      </a>
                    ) : (
                      <button className="cd-btn cd-btn-soft" style={{fontSize:".78rem",padding:"7px 13px"}} disabled>
                        <svg viewBox="0 0 24 24" width={13} height={13} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        {accountManagerCard.emailLabel}
                      </button>
                    )}
                    {accountManagerCard.bookingHref ? (
                      <a className="cd-btn cd-btn-primary" style={{fontSize:".78rem",padding:"7px 13px"}} href={accountManagerCard.bookingHref} target="_blank" rel="noreferrer">
                        <svg viewBox="0 0 24 24" width={13} height={13} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        {accountManagerCard.bookingLabel}
                      </a>
                    ) : (
                      <button className="cd-btn cd-btn-primary" style={{fontSize:".78rem",padding:"7px 13px"}} disabled>
                        <svg viewBox="0 0 24 24" width={13} height={13} stroke="currentColor" fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        {accountManagerCard.bookingLabel}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ACTIVITY */}
        {activeView === "activity" && (
          <>
            {demoMode ? (
              <p className="cd-preview-banner" role="note">{t.preview}</p>
            ) : null}
            <ClientActivityPanel
              accountId={useLiveTargeting ? targetingAccountId : null}
              lang={lang}
              enabled={useLiveTargeting && Boolean(targetingAccountId)}
            />
          </>
        )}

        {/* TARGETING */}
        {activeView === "targeting" && (
          <div className="cd-view">
            {demoMode ? (
              <p className="cd-preview-banner" role="note">{t.preview}</p>
            ) : null}
            <div className="cd-tg2-topbar">
              <p className="cd-tg2-intro">
                {useLiveData && targetingUsername
                  ? `${t.targeting.intro} · @${targetingUsername.replace(/^@+/, "")}`
                  : t.targeting.intro}
              </p>
              <div className="cd-tg2-topbar-actions">
                <input
                  type="search"
                  className="cd-tg2-search"
                  value={targetSearchQuery}
                  onChange={(event) => setTargetSearchQuery(event.target.value)}
                  placeholder={t.targeting.searchPh}
                  aria-label={t.targeting.searchPh}
                  disabled={!useLiveData && demoMode}
                />
                <button className="cd-tg2-detailbtn" onClick={() => setDrawerOpen(true)} disabled={!useLiveData || !targetingAccountId}>
                  <svg viewBox="0 0 24 24" width={14} height={14} stroke="currentColor" fill="none" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
                  {t.targeting.detailBtn}
                </button>
              </div>
            </div>
            {targetingMessage ? <p className="cd-setup-note" role="status">{targetingMessage}</p> : null}
            {targetingLoading && useLiveData ? (
              <p className="cd-setup-note">{lang === "fr" ? "Chargement du ciblage…" : "Loading targeting…"}</p>
            ) : null}

            <div className="cd-tg2-cols">
              {/* Cibles */}
              <div className="cd-tg2-col cd-col-cibles">
                <div className="cd-tg2-col-hd">
                  <span className="cd-tg2-col-ic"><svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" fill="none" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/></svg></span>
                  <span className="cd-tg2-col-ttl">{t.targeting.targets}</span>
                  <span className="cd-tg2-col-ct">{targets.length}</span>
                </div>
                <div className="cd-tg2-col-rows">
                  {targetingItems.length === 0 ? (
                    <div className="cd-tg2-col-empty">{t.targeting.emptyT}</div>
                  ) : filteredTargetingItems.length === 0 ? (
                    <div className="cd-tg2-col-empty">{t.targeting.searchEmpty}</div>
                  ) : filteredTargetingItems.map((item) => (
                    <div key={item.id} className="cd-tg2-li">
                      <TargetAvatar
                        accountId={targetingAccountId}
                        targetId={item.id}
                        username={item.targetUsername}
                        avatarUrl={item.avatarUrl}
                        avatarAvailable={item.avatarAvailable}
                      />
                      <span className="cd-tg2-handle">@{item.targetUsername}</span>
                      <button className="cd-tg2-li-x" onClick={() => void removeTargetFromList(item.targetUsername)} title="Retirer" disabled={targetingLoading}>
                        <svg viewBox="0 0 24 24" width={13} height={13} stroke="currentColor" fill="none" strokeWidth={2.3} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Whitelist */}
              <div className="cd-tg2-col cd-col-white">
                <div className="cd-tg2-col-hd">
                  <span className="cd-tg2-col-ic"><svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" fill="none" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 9"/></svg></span>
                  <span className="cd-tg2-col-ttl">{t.targeting.white}</span>
                  <span className="cd-tg2-col-ct">{whitelist.length}</span>
                </div>
                <div className="cd-tg2-col-add">
                  <input type="text" placeholder={t.targeting.placeholderW} value={addW} onChange={e => setAddW(e.target.value)} onKeyDown={e => e.key === "Enter" && addToList("white", addW)}/>
                  <button onClick={() => addToList("white", addW)}>+</button>
                </div>
                <div className="cd-tg2-col-rows">
                  {whitelist.length === 0 ? <div className="cd-tg2-col-empty">{t.targeting.emptyW}</div> : whitelist.map(h => (
                    <div key={h} className="cd-tg2-li">
                      <span className="cd-tg2-av" style={{background:`linear-gradient(135deg,${avPal(h)[0]},${avPal(h)[1]})`}}><i>{h.charAt(0).toUpperCase()}</i></span>
                      <span className="cd-tg2-handle">@{h}</span>
                      <button className="cd-tg2-li-x" onClick={() => void removeFromFilterList("white", h)} title="Retirer">
                        <svg viewBox="0 0 24 24" width={13} height={13} stroke="currentColor" fill="none" strokeWidth={2.3} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Blacklist */}
              <div className="cd-tg2-col cd-col-black">
                <div className="cd-tg2-col-hd">
                  <span className="cd-tg2-col-ic"><svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" fill="none" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg></span>
                  <span className="cd-tg2-col-ttl">{t.targeting.black}</span>
                  <span className="cd-tg2-col-ct">{blacklist.length}</span>
                </div>
                <div className="cd-tg2-col-add">
                  <input type="text" placeholder={t.targeting.placeholderB} value={addB} onChange={e => setAddB(e.target.value)} onKeyDown={e => e.key === "Enter" && addToList("black", addB)}/>
                  <button onClick={() => addToList("black", addB)}>+</button>
                </div>
                <div className="cd-tg2-col-rows">
                  {blacklist.length === 0 ? <div className="cd-tg2-col-empty">{t.targeting.emptyB}</div> : blacklist.map(h => (
                    <div key={h} className="cd-tg2-li">
                      <span className="cd-tg2-av" style={{background:`linear-gradient(135deg,${avPal(h)[0]},${avPal(h)[1]})`}}><i>{h.charAt(0).toUpperCase()}</i></span>
                      <span className="cd-tg2-handle">@{h}</span>
                      <button className="cd-tg2-li-x" onClick={() => void removeFromFilterList("black", h)} title="Retirer">
                        <svg viewBox="0 0 24 24" width={13} height={13} stroke="currentColor" fill="none" strokeWidth={2.3} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DM TEMPLATES */}
        {activeView === "dm-templates" && (
          <div className="cd-view">
            <ClientDmTemplatesSection
              lang={lang}
              accounts={hasLinkedInstagramAccount ? initialAccounts : []}
              hasLinkedInstagramAccount={hasLinkedInstagramAccount}
            />
          </div>
        )}

        {/* ACCOUNT */}
        {activeView === "account" && (
          <div className="cd-view">
            {primaryAccount && !primaryAccount.connected ? (
              <section className="cd-card cd-connect-card">
                <div className="cd-s-title">{t.account.connectTitle}</div>
                <p className="cd-connect-copy">{t.account.connectBody}</p>
                <div className="cd-connect-actions">
                  <button
                    className="cd-btn cd-btn-primary"
                    onClick={() => setConnectProgress({
                      account: primaryAccount,
                      snapshot: null,
                      message: t.account.connectBody,
                    })}
                  >
                    {t.account.connectProgress}
                  </button>
                </div>
              </section>
            ) : null}
            <div className="cd-acc-grid">
              <div className="cd-card">
                <div className="cd-s-title">{t.account.profile}</div>
                {[
                  { lbl:t.account.fname, key:"firstName" as const, ro:false },
                  { lbl:t.account.lname, key:"lastName" as const, ro:false },
                  { lbl:t.account.phone, key:"phone" as const, ro:false },
                ].map(({ lbl, key, ro }) => (
                  <div key={lbl} className="cd-fg">
                    <label className="cd-fl">{lbl}</label>
                    <input
                      className="cd-fi-in"
                      value={profileForm[key]}
                      readOnly={ro}
                      onChange={(event) => setProfileForm((current) => ({ ...current, [key]: event.target.value }))}
                    />
                  </div>
                ))}
                <div className="cd-fg">
                  <label className="cd-fl">{t.account.email}</label>
                  <input className="cd-fi-in" value={profileForm.email} readOnly />
                  <p className="cd-setup-note">{t.account.emailHint}</p>
                </div>
                <div className="cd-fg">
                  <label className="cd-fl">{t.account.ig}</label>
                  <textarea className="cd-fi-in cd-fi-textarea" value={instagramSummary} readOnly rows={Math.max(2, linkedAccountsForAccountTab.length)} />
                </div>
                {accountMessage ? <p className={`cd-accounts-message${accountMessage.includes("enregistr") || accountMessage.includes("saved") ? " success" : " error"}`}>{accountMessage}</p> : null}
                <button className="cd-btn cd-btn-primary" onClick={handleSaveProfile} disabled={accountSaving}>
                  {accountSaving ? (lang === "fr" ? "Enregistrement…" : "Saving…") : t.account.save}
                </button>
              </div>
              <div className="cd-card">
                <div className="cd-s-title">{t.account.subscription}</div>
                {[
                  { lbl:t.account.planLabel, val:subscriptionPlanValue || (lang === "fr" ? "Non renseigné" : "Not available") },
                  { lbl:t.account.since,     val:memberSinceValue || (lang === "fr" ? "Non renseigné" : "Not available") },
                  { lbl:billingDateLabel,    val:billingDateValue },
                ].map(({ lbl, val }) => (
                  <div key={lbl} className="cd-fg">
                    <label className="cd-fl">{lbl}</label>
                    <input className="cd-fi-in" value={val} readOnly/>
                  </div>
                ))}
                <div className="cd-fg">
                  <label className="cd-fl">{t.account.pay}</label>
                  <input className="cd-fi-in" value={paymentMethodValue} readOnly/>
                  <button className="cd-btn cd-btn-soft cd-btn-full" type="button" onClick={() => setBillingDrawerOpen(true)}>
                    {t.account.managePayment}
                  </button>
                </div>
                <a className="cd-btn cd-btn-soft" href="/instagram-client/change-plan">{t.account.changePlan}</a>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── DRAWER ── */}
      {useLiveData && targetingAccountId ? (
        <ClientAccountTargetsDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          lang={lang}
          copy={t.drawer}
          accountId={targetingAccountId}
          accountUsername={targetingUsername}
          packageCode={targetingPackageCode}
          overview={targetingOverview}
          onOverviewChange={setTargetingOverview}
          onReload={reloadTargeting}
        />
      ) : null}
      <PaymentBillingDrawer open={billingDrawerOpen} onClose={() => setBillingDrawerOpen(false)} lang={lang} t={t} billing={workspace?.billing ?? null} />

      {connectProgress ? (
        <div className="cd-progress-overlay" role="presentation" onMouseDown={() => setConnectProgress(null)}>
          <section className="cd-progress-modal" role="dialog" aria-modal="true" aria-labelledby="cd-progress-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="cd-progress-header">
              <div>
                <span>@{connectProgress.account.username} · Instagram</span>
                <h3 id="cd-progress-title">{t.account.connectTitle}</h3>
                <p>{connectProgress.snapshot?.status === "action_required" ? t.account.connectActionRequired : t.account.connectBody}</p>
              </div>
              <em className={`status-${connectProgress.snapshot?.status || "running"}`}>
                {connectProgress.snapshot?.status === "connected" ? (lang === "fr" ? "Connecté" : "Connected")
                  : connectProgress.snapshot?.status === "action_required" ? (lang === "fr" ? "Action requise" : "Action required")
                    : connectProgress.snapshot?.status === "failed" ? (lang === "fr" ? "Échec" : "Failed")
                      : (lang === "fr" ? "En cours" : "In progress")}
              </em>
            </header>
            <section className="cd-progress-steps">
              {(connectProgress.snapshot?.steps ?? [
                { id: "connecting", label: lang === "fr" ? "Connexion en cours" : "Connecting", subtitle: t.account.connectBody, status: "running" as const },
              ]).slice(0, 4).map((step) => (
                <div key={step.id} className={`cd-progress-step status-${step.status}`}>
                  <span aria-hidden="true">{step.status === "done" ? "✓" : step.status === "failed" ? "!" : "…"}</span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.subtitle}</small>
                  </div>
                </div>
              ))}
            </section>
            {connectProgress.snapshot?.action_required ? (
              <p className="cd-progress-action">{connectProgress.snapshot.action_required.message || t.account.connectActionRequired}</p>
            ) : null}
            {connectProgress.snapshot?.status === "action_required" ? (
              <p className="cd-progress-action">{t.account.connectActionHelp}</p>
            ) : null}
            <div className="cd-connect-actions">
              <button className="cd-btn cd-btn-soft" onClick={() => setConnectProgress(null)}>{lang === "fr" ? "Fermer" : "Close"}</button>
              <button
                className="cd-btn cd-btn-primary"
                onClick={() => setConnectProgress((current) => current ? { ...current, snapshot: null, message: t.account.connectBody } : current)}
              >
                {t.account.connectCheck}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────────
const CSS = `
.cd-shell {
  --bg:#080b12; --surface:#0d1018; --surface-2:#131820; --surface-3:#1a2030;
  --ink:#e6eaf4; --ink-dim:#8a94a8; --ink-mute:#454f68;
  --line:rgba(255,255,255,.065); --line-2:rgba(255,255,255,.03);
  --accent:#e8a030; --accent-2:#5a6cf5;
  --a-soft:rgba(232,160,48,.12); --a-ring:rgba(232,160,48,.28); --a-tint:rgba(232,160,48,.06);
  --good:#34d399; --good-bg:rgba(52,211,153,.10); --good-line:rgba(52,211,153,.25);
  --bad:#f87171;  --bad-bg:rgba(248,113,113,.10); --bad-line:rgba(248,113,113,.25);
  --warn:#fbbf24; --warn-bg:rgba(251,191,36,.10); --warn-line:rgba(251,191,36,.25);
  --shadow:0 8px 32px -8px rgba(0,0,0,.6); --shadow-sm:0 2px 12px rgba(0,0,0,.35);
  --r:14px; --r-sm:9px; --font-d:"Archivo",system-ui,sans-serif; --font-b:"Plus Jakarta Sans",system-ui,sans-serif;
  --tr:.16s ease;
  position:fixed;inset:0;overflow:hidden;
  display:grid;grid-template-columns:220px 1fr;grid-template-rows:58px 1fr;
  background:var(--bg);color:var(--ink);font-family:var(--font-b);-webkit-font-smoothing:antialiased;
  transition:background var(--tr),color var(--tr);
}
.cd-shell.cd-light {
  --bg:#faf8f3;--surface:#fff;--surface-2:#f5f0e8;--surface-3:#ede5d4;
  --ink:#14120d;--ink-dim:#5a5040;--ink-mute:#8c8070;
  --line:rgba(20,18,13,.09);--line-2:rgba(20,18,13,.05);
  --accent:#c97c10;--accent-2:#4361ee;
  --a-soft:rgba(201,124,16,.10);--a-ring:rgba(201,124,16,.30);--a-tint:#fef3dc;
  --good:#16a34a;--good-bg:#ecfdf3;--good-line:rgba(22,163,74,.22);
  --bad:#e11d48;--bad-bg:#fff1f3;--bad-line:rgba(225,29,72,.18);
  --shadow:0 16px 40px -16px rgba(100,60,0,.18);--shadow-sm:0 4px 16px -8px rgba(100,60,0,.12);
}
.cd-shell *{box-sizing:border-box;margin:0;padding:0}
.cd-shell a{color:inherit;text-decoration:none}
.cd-shell button{cursor:pointer;border:none;background:none;font-family:var(--font-b)}

/* Sidebar */
.cd-sidebar{grid-row:1/3;background:color-mix(in srgb,var(--bg) 60%,var(--surface));border-right:1px solid var(--line);display:flex;flex-direction:column;transition:background var(--tr)}
.cd-sb-brand{display:flex;align-items:center;gap:12px;padding:0 18px;height:58px;border-bottom:1px solid var(--line)}
.cd-sb-mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(155deg,#f7d774,#e8a030 55%,#d8881e);display:grid;place-items:center;flex:none;box-shadow:0 0 16px -2px rgba(232,160,48,.55)}
.cd-sb-mark-b{font-family:var(--font-d);font-weight:900;font-size:1.35rem;line-height:1;color:#14100a;letter-spacing:-.02em}
.cd-sb-name-main{font-family:var(--font-d);font-weight:800;font-size:.92rem;line-height:1;letter-spacing:-.01em;color:var(--ink)}
.cd-sb-name-main span{color:var(--accent)}
.cd-sb-name-sub{font-size:.65rem;font-weight:600;color:var(--ink-mute);letter-spacing:.04em;text-transform:uppercase;margin-top:2px}
.cd-sb-nav{flex:1;padding:12px 10px;display:flex;flex-direction:column;gap:2px;overflow-y:auto}
.cd-nl{font-family:var(--font-d);font-weight:700;font-size:.64rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-mute);padding:10px 10px 4px;margin-top:4px;display:block}
.cd-nav-link{display:flex;align-items:center;gap:9px;padding:8px 11px;border-radius:var(--r-sm);font-size:.88rem;font-weight:600;color:var(--ink-dim);transition:all var(--tr);white-space:nowrap;position:relative;text-decoration:none}
.cd-nav-link svg{opacity:.75;flex:none}
.cd-nav-link:hover{background:var(--surface-3);color:var(--ink)}
.cd-nav-link.active{background:var(--a-soft);color:var(--accent)}
.cd-nav-link.active svg{opacity:1}
.cd-nav-link.active::before{content:"";position:absolute;left:0;top:20%;height:60%;width:2.5px;border-radius:0 2px 2px 0;background:var(--accent)}
.cd-bdg{margin-left:auto;background:var(--accent);color:#fff;font-family:var(--font-d);font-weight:700;font-size:.65rem;padding:1px 6px;border-radius:100px}
.cd-sb-foot{padding:12px;border-top:1px solid var(--line)}
.cd-sb-acct{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:var(--r-sm);background:var(--surface-2)}
.cd-sb-av{width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent-2));display:grid;place-items:center;font-family:var(--font-d);font-weight:800;font-size:.85rem;color:#fff;flex:none}
.cd-sb-aname{font-size:.83rem;font-weight:700;line-height:1.2;color:var(--ink)}
.cd-sb-aplan{font-size:.7rem;color:var(--accent);font-weight:700}
.cd-sb-live{display:flex;align-items:center;gap:4px;margin-left:auto}
.cd-sb-dot{width:7px;height:7px;border-radius:50%;background:var(--good);animation:cd-blink 2s ease-in-out infinite}
.cd-sb-logout-wrap{padding:0 10px 4px}
.cd-sb-logout{width:100%;display:flex;align-items:center;gap:9px;padding:8px 11px;border-radius:var(--r-sm);font-size:.88rem;font-weight:600;color:var(--ink-mute);background:transparent;border:none;cursor:pointer;transition:all var(--tr);text-align:left;font-family:var(--font-b)}
.cd-sb-logout:hover:not(:disabled){background:rgba(248,113,113,.10);color:var(--bad)}
.cd-sb-logout:disabled{opacity:.55;cursor:wait}
@keyframes cd-blink{0%,100%{opacity:1}50%{opacity:.3}}

/* Topbar */
.cd-topbar{background:color-mix(in srgb,var(--bg) 80%,var(--surface));backdrop-filter:blur(12px);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;padding:0 24px;transition:background var(--tr)}
.cd-tb-title{font-family:var(--font-d);font-weight:800;font-size:1.05rem;flex:1;color:var(--ink)}
.cd-tb-right{display:flex;align-items:center;gap:8px}
.cd-stat-pill{display:inline-flex;align-items:center;gap:5px;font-size:.75rem;font-weight:700;padding:4px 10px;border-radius:100px;background:var(--good-bg);color:var(--good);border:1px solid var(--good-line)}
.cd-dot{width:5px;height:5px;border-radius:50%;background:currentColor;animation:cd-blink 2s ease-in-out infinite}
.cd-ic-btn{width:33px;height:33px;border-radius:8px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink-dim);display:grid;place-items:center;transition:all var(--tr)}
.cd-ic-btn:hover{border-color:var(--a-ring);color:var(--accent)}
.cd-lang-t{display:inline-flex;background:var(--surface-2);border:1px solid var(--line);border-radius:100px;padding:3px}
.cd-lang-t button{border:none;background:transparent;color:var(--ink-mute);cursor:pointer;padding:3px 9px;border-radius:100px;font-family:var(--font-d);font-weight:700;font-size:.72rem;transition:all var(--tr)}
.cd-lang-t button.on{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff}

/* Main */
.cd-main{overflow-y:auto;padding:22px 24px;display:flex;flex-direction:column;gap:20px}
.cd-view{display:flex;flex-direction:column;gap:18px}

.cd-action-alerts{display:grid;gap:12px}
.cd-action-alert{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:14px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.28);border-radius:var(--r);padding:14px 16px}
.cd-action-alert-ic{width:38px;height:38px;border-radius:14px;display:grid;place-items:center;background:rgba(245,158,11,.14);color:#fbbf24}
.cd-action-alert span{display:block;font-family:var(--font-d);font-size:.68rem;text-transform:uppercase;letter-spacing:.09em;color:#fbbf24;margin-bottom:4px}
.cd-action-alert strong{display:block;color:var(--ink);font-family:var(--font-d);font-size:.95rem}
.cd-action-alert p{margin:4px 0 0;color:var(--muted);font-size:.82rem;line-height:1.45}

.cd-notif-btn{position:relative}
.cd-notif-btn.on{border-color:var(--a-ring);color:var(--accent)}
.cd-notif-count{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;font-size:.62rem;font-weight:800;display:grid;place-items:center}
.cd-client-notifs{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px;display:grid;gap:14px}
.cd-client-notifs-hd{display:flex;align-items:center;justify-content:space-between;gap:12px}
.cd-client-notifs-hd h2{margin:0;font-family:var(--font-d);font-size:1rem}
.cd-client-notifs-badge{min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:rgba(245,158,11,.14);color:#fbbf24;font-size:.72rem;font-weight:800;display:grid;place-items:center}
.cd-client-notifs-section{display:grid;gap:10px}
.cd-client-notifs-section h3{margin:0;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-mute)}
.cd-client-notifs-list{display:grid;gap:10px}
.cd-client-notifs-empty{margin:0;color:var(--ink-mute);font-size:.84rem}
.cd-client-notif{background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:14px;display:grid;gap:8px}
.cd-client-notif.is-read{opacity:.82}
.cd-client-notif.is-resolved{opacity:.72}
.cd-client-notif-hd{display:flex;align-items:center;justify-content:space-between;gap:10px}
.cd-client-notif-cat{font-size:.66rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--accent)}
.cd-client-notif-date{font-size:.72rem;color:var(--ink-mute)}
.cd-client-notif-account{font-family:var(--font-d);font-size:.9rem;color:var(--ink)}
.cd-client-notif h3{margin:0;font-size:.92rem;color:var(--ink)}
.cd-client-notif p{margin:0;color:var(--muted);font-size:.82rem;line-height:1.45}
.cd-client-notif-actions{display:flex;flex-wrap:wrap;gap:8px}
.cd-btn-ghost{background:transparent;border:1px solid var(--line);color:var(--ink-dim)}

/* Stat cards */
.cd-stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.cd-sc{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:18px 16px;transition:border-color var(--tr),transform var(--tr)}
.cd-sc:hover{border-color:var(--a-ring);transform:translateY(-2px)}
.cd-sc-lbl{font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:9px}
.cd-sc-val{font-family:var(--font-d);font-weight:900;font-size:1.85rem;letter-spacing:-.03em;line-height:1;color:var(--ink)}
.cd-sc-val.cd-grad{background:linear-gradient(125deg,var(--accent),var(--accent-2));-webkit-background-clip:text;background-clip:text;color:transparent}
.cd-sc-sub{font-size:.75rem;color:var(--ink-mute);margin-top:5px}
.cd-up{color:var(--good);font-weight:700}

/* Chart */
.cd-chart-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:22px 22px 14px}
.cd-c-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px;gap:16px;flex-wrap:wrap}
.cd-c-hd-left{display:flex;flex-direction:column;gap:12px}
.cd-c-titlerow{display:flex;align-items:center;gap:11px}
.cd-c-badge{width:34px;height:34px;border-radius:10px;flex:none;display:grid;place-items:center;background:linear-gradient(135deg,#f7a52b 0%,#f4506b 45%,#8b3df5 100%);box-shadow:0 6px 16px -6px rgba(214,61,176,.55)}
.cd-c-title{font-family:var(--font-d);font-weight:800;font-size:1.05rem;letter-spacing:-.01em;color:var(--ink)}
.cd-c-bignum{display:flex;align-items:center;gap:12px}
.cd-c-foll-n{font-family:var(--font-d);font-weight:900;font-size:1.7rem;letter-spacing:-.03em;color:var(--ink);line-height:.9}
.cd-c-delta{display:inline-flex;align-items:center;gap:4px;font-family:var(--font-d);font-weight:800;font-size:.86rem;padding:5px 11px 5px 8px;border-radius:100px;transition:all var(--tr)}
.cd-range-tabs{display:inline-flex;background:var(--surface-2);border:1px solid var(--line);border-radius:100px;padding:4px;gap:2px}
.cd-range-tabs button{border:none;background:transparent;color:var(--ink-mute);cursor:pointer;padding:7px 16px;border-radius:100px;font-family:var(--font-d);font-weight:700;font-size:.78rem;transition:all var(--tr)}
.cd-range-tabs button:hover{color:var(--ink-dim)}
.cd-range-tabs button.on{background:color-mix(in srgb,var(--bg) 35%,var(--surface));color:var(--ink);box-shadow:var(--shadow-sm)}
.cd-chart-tip{position:absolute;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:7px 11px;font-size:.75rem;font-family:var(--font-d);font-weight:700;pointer-events:none;box-shadow:var(--shadow-sm);white-space:nowrap;z-index:10;color:var(--ink)}
.cd-tv{color:var(--accent);font-size:.95rem;display:block}

/* Two-col */
.cd-two-col{display:grid;grid-template-columns:1.25fr 1fr;gap:16px}

/* Card */
.cd-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:18px}
.cd-setup-required{display:grid;gap:10px;max-width:720px}
.cd-preview-banner{margin:0 0 14px;padding:10px 14px;border:1px solid var(--warn-line);border-radius:var(--r-sm);background:var(--warn-bg);color:var(--warn);font-size:.8rem;font-weight:700;line-height:1.5}
.cd-setup-required p{margin:0;color:var(--ink-dim);line-height:1.6;font-size:.92rem}
.cd-setup-note{color:var(--ink-mute)!important;font-size:.84rem!important}
.cd-accounts-panel{display:grid;gap:14px;margin-bottom:14px}
.cd-accounts-panel .cd-card-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}
.cd-accounts-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.cd-btn-compact{font-size:.78rem;padding:8px 12px}
.cd-accounts-list{display:grid;gap:10px}
.cd-account-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface-2)}
.cd-account-main{display:grid;gap:4px;min-width:0}
.cd-account-main strong{font-family:var(--font-d);font-size:.95rem;color:var(--ink)}
.cd-account-main small{color:var(--ink-mute);font-size:.78rem;text-transform:capitalize}
.cd-account-subtext{margin:0;color:var(--ink-dim);font-size:.78rem;line-height:1.4}
.cd-account-pill{display:inline-flex;width:fit-content;padding:4px 8px;border-radius:999px;background:var(--warn-bg);border:1px solid var(--warn-line);color:var(--warn);font-size:.72rem;font-weight:700}
.cd-account-pill.connected,.cd-account-pill-success{background:var(--good-bg);border-color:var(--good-line);color:var(--good)}
.cd-account-pill-warning{background:var(--warn-bg);border-color:var(--warn-line);color:var(--warn)}
.cd-account-pill-neutral{background:var(--surface-3);border-color:var(--line);color:var(--ink-dim)}
.cd-account-state-success{background:var(--good-bg)!important;border:1px solid var(--good-line)!important;color:var(--good)!important;box-shadow:none!important;cursor:default}
.cd-account-state-primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff}
.cd-account-state-warning{background:var(--warn-bg);border:1px solid var(--warn-line);color:var(--warn)}
.cd-account-state-neutral{background:var(--surface-2);border:1px solid var(--line);color:var(--ink-dim)}
.cd-account-state:disabled{opacity:.92;cursor:default;transform:none!important;box-shadow:none!important}
.cd-account-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
.cd-accounts-empty{display:grid;gap:12px;padding:8px 0;color:var(--ink-dim);font-size:.9rem}
.cd-accounts-message{margin:0;font-size:.82rem;font-weight:700}
.cd-accounts-message.success{color:var(--good)}
.cd-accounts-message.error{color:var(--bad)}
.cd-add-account-modal{max-width:520px;width:min(520px,calc(100vw - 32px))}
.cd-add-account-form{display:grid;gap:12px;margin-top:8px}
.cd-add-account-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.cd-password-field{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center}
.cd-password-toggle{padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);font-family:var(--font-b);font-size:.78rem;font-weight:700;cursor:pointer;white-space:nowrap}
.cd-password-toggle:hover{border-color:var(--a-ring)}
.cd-password-toggle:focus-visible{outline:2px solid var(--a-ring);outline-offset:2px}
.cd-card-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.cd-card-hd h3{font-family:var(--font-d);font-weight:800;font-size:.95rem;color:var(--ink)}
.cd-card-hd a{font-size:.78rem;font-weight:700;color:var(--accent);opacity:.85;transition:opacity var(--tr)}
.cd-card-hd a:hover{opacity:1}

/* Activity log */
.cd-act-view{display:grid;gap:16px}
.cd-act-head h2{font-family:var(--font-d);font-weight:900;font-size:1.15rem;color:var(--ink);margin:0 0 6px}
.cd-act-head p{margin:0;color:var(--ink-dim);font-size:.84rem;line-height:1.5;max-width:760px}
.cd-act-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:end}
.cd-act-search{max-width:none;flex:1 1 280px}
.cd-act-filter{display:grid;gap:4px;font-size:.72rem;color:var(--ink-mute)}
.cd-act-filter select{background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 10px;color:var(--ink);font-family:var(--font-b);font-size:.82rem;outline:none}
.cd-act-filter select:focus{border-color:var(--a-ring)}
.cd-act-table-wrap{display:block;overflow:auto;border:1px solid var(--line);border-radius:var(--r);background:var(--surface)}
.cd-act-table{width:100%;border-collapse:collapse;font-size:.82rem}
.cd-act-table th,.cd-act-table td{padding:10px 12px;border-bottom:1px solid var(--line-2);text-align:left;vertical-align:top}
.cd-act-table th{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-mute);background:var(--surface-2)}
.cd-act-table tr:last-child td{border-bottom:none}
.cd-act-result{display:inline-flex;padding:2px 8px;border-radius:999px;font-size:.74rem;font-weight:700}
.cd-act-result-success{background:var(--good-bg);color:var(--good)}
.cd-act-result-skipped{background:var(--surface-2);color:var(--ink-dim)}
.cd-act-result-failed{background:var(--bad-bg);color:var(--bad)}
.cd-act-result-pending{background:var(--warn-bg);color:var(--warn)}
.cd-act-cards{display:none;gap:12px}
.cd-act-card{border:1px solid var(--line);border-radius:var(--r);padding:14px;background:var(--surface);display:grid;gap:8px}
.cd-act-card-date{font-size:.74rem;color:var(--ink-mute)}
.cd-act-card-row{display:flex;justify-content:space-between;gap:12px;font-size:.82rem}
.cd-act-card-row span{color:var(--ink-mute)}
.cd-act-card-row strong{color:var(--ink);text-align:right}
.cd-act-card-detail{margin:0;font-size:.78rem;color:var(--ink-dim);line-height:1.45}
.cd-act-empty,.cd-act-error{border:1px solid var(--line);border-radius:var(--r);padding:18px;background:var(--surface)}
.cd-act-empty h3,.cd-act-error h3{margin:0 0 8px;font-family:var(--font-d);font-size:.95rem;color:var(--ink)}
.cd-act-empty p,.cd-act-error p{margin:0;color:var(--ink-dim);font-size:.84rem;line-height:1.5}
.cd-act-more{display:flex;justify-content:center;padding-top:4px}
@media (max-width:960px){
  .cd-act-table-wrap{display:none}
  .cd-act-cards{display:grid}
}

/* Overview recent feed */
.cd-orf{display:flex;flex-direction:column;gap:0;padding:2px 0}
.cd-orf-empty{padding:18px 4px;font-size:.84rem;color:var(--ink-mute);line-height:1.55}
.cd-orf-item{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px 12px;padding:14px 0;border-bottom:1px solid var(--line-2)}
.cd-orf-item:last-child{border-bottom:none;padding-bottom:0}
.cd-orf-rail{position:relative;display:flex;justify-content:center}
.cd-orf-line{position:absolute;top:34px;bottom:-14px;left:50%;width:2px;transform:translateX(-50%);background:var(--line-2)}
.cd-orf-icon{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--surface-2);border:1px solid var(--line);position:relative;z-index:1}
.cd-orf-icon svg{stroke-width:2.1}
.cd-orf-icon-fo svg{stroke:#5a6cf5}
.cd-orf-icon-li svg{stroke:var(--accent)}
.cd-orf-icon-dm svg{stroke:var(--good)}
.cd-orf-icon-st svg{stroke:var(--warn)}
.cd-orf-icon-uf svg{stroke:var(--ink-mute)}
.cd-orf-body{min-width:0;display:flex;flex-direction:column;gap:4px}
.cd-orf-summary{font-size:.84rem;font-weight:600;color:var(--ink);line-height:1.45}
.cd-orf-highlight{color:#8ea2ff;font-weight:800}
.cd-orf-meta{font-size:.72rem;color:var(--ink-mute)}
.cd-orf-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}
.cd-orf-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:100px;font-size:.68rem;font-weight:700;letter-spacing:.02em;border:1px solid transparent}
.cd-orf-pill-fo{background:rgba(90,108,245,.12);color:#8ea2ff;border-color:rgba(90,108,245,.22)}
.cd-orf-pill-li{background:rgba(232,160,48,.12);color:var(--accent);border-color:rgba(232,160,48,.22)}
.cd-orf-pill-dm{background:rgba(52,211,153,.12);color:var(--good);border-color:rgba(52,211,153,.22)}
.cd-orf-pill-st{background:rgba(251,191,36,.12);color:var(--warn);border-color:rgba(251,191,36,.22)}
.cd-orf-pill-uf{background:rgba(255,255,255,.05);color:var(--ink-mute);border-color:var(--line)}
.cd-orf-avatars{display:inline-flex;align-items:center;margin-left:2px}
.cd-orf-av{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:.62rem;font-weight:800;color:#fff;border:2px solid var(--surface);margin-left:-7px}
.cd-orf-av:first-child{margin-left:0}
.cd-orf-more{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:.62rem;font-weight:800;color:var(--ink-mute);background:var(--surface-2);border:2px solid var(--surface);margin-left:-7px}

/* Feed (legacy list styles retained for other surfaces) */
.cd-feed{display:flex;flex-direction:column}
.cd-fi{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line-2)}
.cd-fi:last-child{border-bottom:none;padding-bottom:0}
.cd-fi-ic{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;flex:none}
.cd-fi-fo{background:rgba(90,108,245,.14)} .cd-fi-fo svg{stroke:#5a6cf5}
.cd-fi-li{background:rgba(232,160,48,.14)} .cd-fi-li svg{stroke:var(--accent)}
.cd-fi-dm{background:rgba(52,211,153,.14)} .cd-fi-dm svg{stroke:var(--good)}
.cd-fi-st{background:rgba(251,191,36,.14)} .cd-fi-st svg{stroke:var(--warn)}
.cd-fi-body{flex:1;min-width:0}
.cd-fi-title{font-size:.84rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink)}
.cd-fi-meta{font-size:.72rem;color:var(--ink-mute);margin-top:1px}
.cd-fi-n{font-family:var(--font-d);font-weight:800;font-size:.9rem;color:var(--ink)}

/* Plan + manager */
.cd-plan-wrap{display:flex;flex-direction:column;gap:14px}
.cd-plan-top{display:flex;align-items:center;justify-content:space-between}
.cd-plan-name{font-family:var(--font-d);font-weight:900;font-size:1.3rem;color:var(--ink)}
.cd-plan-tag{font-family:var(--font-d);font-weight:700;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase;padding:4px 10px;border-radius:100px;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff}
.cd-plan-price{font-family:var(--font-d);font-weight:900;font-size:1.6rem;color:var(--accent)}
.cd-plan-price small{font-size:.85rem;color:var(--ink-mute);font-weight:600}
.cd-plan-rows{display:flex;flex-direction:column;gap:7px}
.cd-pr{display:flex;justify-content:space-between;align-items:center;font-size:.84rem}
.cd-pr-l{color:var(--ink-mute)} .cd-pr-v{font-weight:700;color:var(--ink)}
.cd-pr-v.cd-g{color:var(--good)} .cd-pr-v.cd-a{color:var(--accent)}
.cd-manager-card{background:linear-gradient(135deg,var(--a-tint),var(--surface-2));border:1px solid var(--a-ring);border-radius:var(--r);padding:16px;display:flex;flex-direction:column;gap:12px}
.cd-mgr-hd{display:flex;align-items:center;gap:10px}
.cd-mgr-av{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:grid;place-items:center;font-family:var(--font-d);font-weight:800;font-size:.9rem;color:#fff;flex:none;border:2px solid var(--a-ring)}
.cd-mgr-name{font-family:var(--font-d);font-weight:800;font-size:.95rem;color:var(--ink)}
.cd-mgr-sub{font-size:.75rem;color:var(--ink-mute)}
.cd-mgr-text{font-size:.82rem;color:var(--ink-dim);line-height:1.5}
.cd-mgr-btns{display:flex;gap:8px}

/* Buttons */
.cd-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;font-family:var(--font-d);font-weight:700;font-size:.82rem;padding:9px 16px;border-radius:100px;border:none;cursor:pointer;transition:transform var(--tr),box-shadow var(--tr);text-decoration:none}
.cd-btn-primary{background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#fff;box-shadow:0 6px 20px -8px var(--a-ring)}
.cd-btn-primary:hover{transform:translateY(-1px);box-shadow:0 10px 26px -8px var(--a-ring)}
.cd-btn-soft{background:var(--surface-2);color:var(--ink);border:1px solid var(--line)}
.cd-btn-soft:hover{border-color:var(--a-ring);transform:translateY(-1px)}
.cd-btn-full{width:100%;justify-content:center}

/* Targeting */
.cd-tg2-topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.cd-tg2-topbar-actions{display:flex;align-items:center;gap:10px;flex:1 1 320px;justify-content:flex-end;min-width:min(100%,280px)}
.cd-tg2-search{flex:1 1 220px;min-width:0;max-width:360px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm);padding:8px 12px;color:var(--ink);font-family:var(--font-b);font-size:.82rem;outline:none;transition:border-color var(--tr)}
.cd-tg2-search:focus{border-color:var(--a-ring)}
.cd-tg2-search::placeholder{color:var(--ink-mute)}
.cd-tg2-intro{font-size:.84rem;color:var(--ink-dim);line-height:1.5;max-width:640px}
.cd-tg2-detailbtn{display:inline-flex;align-items:center;gap:8px;font-family:var(--font-d);font-weight:700;font-size:.8rem;color:var(--ink);background:var(--surface-2);border:1px solid var(--line);padding:8px 14px;border-radius:var(--r-sm);transition:all var(--tr)}
.cd-tg2-detailbtn:hover{border-color:var(--a-ring);color:var(--accent);transform:translateY(-1px)}
.cd-tg2-cols{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-items:start}
.cd-tg2-col{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden;display:flex;flex-direction:column}
.cd-tg2-col-hd{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line)}
.cd-tg2-col-ic{width:28px;height:28px;border-radius:8px;flex:none;display:grid;place-items:center}
.cd-col-cibles .cd-tg2-col-ic{background:var(--a-soft);color:var(--accent)}
.cd-col-white  .cd-tg2-col-ic{background:var(--good-bg);color:var(--good)}
.cd-col-black  .cd-tg2-col-ic{background:var(--bad-bg);color:var(--bad)}
.cd-tg2-col-ttl{font-family:var(--font-d);font-weight:800;font-size:.92rem;color:var(--ink)}
.cd-tg2-col-ct{margin-left:auto;font-family:var(--font-d);font-weight:800;font-size:.7rem;padding:2px 9px;border-radius:100px;background:var(--surface-2);border:1px solid var(--line);color:var(--ink-dim)}
.cd-tg2-col-add{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid var(--line-2)}
.cd-tg2-col-add input{flex:1;min-width:0;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm);padding:9px 11px;color:var(--ink);font-family:var(--font-b);font-size:.82rem;outline:none;transition:border-color var(--tr)}
.cd-tg2-col-add input:focus{border-color:var(--a-ring)}
.cd-tg2-col-add input::placeholder{color:var(--ink-mute)}
.cd-tg2-col-add button{flex:none;width:38px;border-radius:var(--r-sm);border:1px solid var(--line);background:var(--surface-2);color:var(--accent);font-size:1.25rem;font-weight:600;line-height:1;cursor:pointer;transition:all var(--tr)}
.cd-tg2-col-add button:hover{border-color:var(--a-ring);background:var(--a-soft)}
.cd-tg2-col-rows{display:flex;flex-direction:column;max-height:400px;overflow-y:auto}
.cd-tg2-li{display:flex;align-items:center;gap:11px;padding:10px 16px;border-bottom:1px solid var(--line-2);transition:background var(--tr)}
.cd-tg2-li:last-child{border-bottom:none}
.cd-tg2-li:hover{background:var(--a-tint)}
.cd-tg2-av{width:32px;height:32px;border-radius:50%;display:grid;place-items:center;flex:none;overflow:hidden;border:1px solid rgba(255,255,255,.08)}
.cd-tg2-av img{width:100%;height:100%;object-fit:cover;border-radius:50%;display:block}
.cd-tg2-av-img{background:var(--surface)}
.cd-tg2-av i{width:100%;height:100%;border-radius:50%;background:var(--surface);display:grid;place-items:center;font-family:var(--font-d);font-weight:800;font-size:.82rem;color:var(--ink);font-style:normal}
.cd-tg2-handle{flex:1;font-size:.85rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink)}
.cd-tg2-li-x{flex:none;width:26px;height:26px;border-radius:7px;border:1px solid transparent;background:none;color:var(--ink-mute);display:grid;place-items:center;cursor:pointer;opacity:0;transition:all var(--tr)}
.cd-tg2-li:hover .cd-tg2-li-x{opacity:1}
.cd-tg2-li-x:hover{color:var(--bad);border-color:var(--bad-line);background:var(--bad-bg)}
.cd-tg2-col-empty{padding:30px 16px;text-align:center;color:var(--ink-mute);font-size:.8rem;line-height:1.5}

/* Account */
.cd-acc-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.cd-connect-card{margin-bottom:4px}
.cd-connect-copy{margin:0 0 14px;color:var(--ink-dim);font-size:.88rem;line-height:1.5}
.cd-connect-actions{display:flex;gap:10px;flex-wrap:wrap}
.cd-verification-label{display:block;color:#94A3B8;font-size:.78rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.cd-verification-input{width:100%;border:1px solid var(--line);border-radius:12px;background:#0B1020;color:#E5E7EB;padding:12px 14px;font-size:1rem}
.cd-verification-hint{margin:0;color:#778299;font-size:.82rem;line-height:1.45}
.cd-verification-error{margin:0;border:1px solid rgba(248,113,113,.35);border-radius:12px;background:rgba(127,29,29,.22);color:#FCA5A5;padding:10px 12px;font-size:.84rem;line-height:1.45}
.cd-progress-overlay{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:24px;background:rgba(2,6,23,.74)}
.cd-progress-modal{width:min(640px,96vw);max-height:90vh;overflow:auto;display:grid;gap:16px;border:1px solid var(--line);border-radius:18px;background:#0B1020;color:#E5E7EB;box-shadow:var(--shadow);padding:22px}
.cd-progress-header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.cd-progress-header span{color:#64748B;font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.cd-progress-header h3{margin:4px 0 0;font-family:var(--font-d);font-size:1.25rem}
.cd-progress-header p{margin:6px 0 0;color:#94A3B8;font-size:.86rem;line-height:1.45}
.cd-progress-header em{border:1px solid rgba(148,163,184,.4);border-radius:999px;padding:6px 10px;font-style:normal;font-weight:800;white-space:nowrap}
.cd-progress-header em.status-connected{border-color:rgba(34,197,94,.45);background:rgba(34,197,94,.12);color:#86EFAC}
.cd-progress-header em.status-running,.cd-progress-header em.status-queued,.cd-progress-header em.status-claimed{border-color:rgba(96,165,250,.5);background:rgba(37,99,235,.18);color:#BFDBFE}
.cd-progress-header em.status-action_required{border-color:rgba(245,158,11,.52);background:rgba(120,53,15,.25);color:#FCD34D}
.cd-progress-header em.status-failed{border-color:rgba(248,113,113,.45);background:rgba(127,29,29,.28);color:#FCA5A5}
.cd-progress-steps{display:grid;gap:12px}
.cd-progress-step{display:grid;grid-template-columns:24px minmax(0,1fr);gap:12px;align-items:start}
.cd-progress-step>span{width:18px;height:18px;display:grid;place-items:center;border:2px solid #64748B;border-radius:999px;color:#94A3B8;font-size:.72rem;margin-top:2px}
.cd-progress-step.status-done>span{border-color:#22C55E;color:#22C55E}
.cd-progress-step.status-running>span,.cd-progress-step.status-action_required>span{border-color:#60A5FA;color:#BFDBFE}
.cd-progress-step.status-failed>span{border-color:#F87171;color:#FCA5A5}
.cd-progress-step strong{display:block;font-size:.95rem}
.cd-progress-step small{display:block;margin-top:3px;color:#778299;font-size:.8rem;overflow-wrap:anywhere}
.cd-progress-action{margin:0;border:1px solid rgba(245,158,11,.35);border-radius:12px;background:rgba(120,53,15,.22);color:#FDE68A;padding:10px 12px;font-size:.84rem;line-height:1.45}
.cd-progress-action-success{border-color:rgba(34,197,94,.35);background:rgba(6,78,59,.22);color:#BBF7D0}
.cd-s-title{font-family:var(--font-d);font-weight:800;font-size:.95rem;margin-bottom:14px;color:var(--ink)}
.cd-fg{margin-bottom:12px}
.cd-fl{font-size:.72rem;font-weight:700;color:var(--ink-mute);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;display:block}
.cd-fi-in{width:100%;padding:9px 13px;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm);font-family:var(--font-b);font-size:.88rem;color:var(--ink);outline:none;transition:border-color var(--tr)}
.cd-fi-in:focus{border-color:var(--a-ring)}
.cd-fi-in[readonly]{color:var(--ink-mute);cursor:default}
.cd-fi-textarea{min-height:72px;resize:vertical;line-height:1.5}
.cd-billing-dwr{max-width:520px}

/* Drawer scrim */
.cd-dwr-scrim{position:fixed;inset:0;background:rgba(4,6,10,.6);backdrop-filter:blur(3px);opacity:0;visibility:hidden;transition:opacity var(--tr),visibility var(--tr);z-index:90}
.cd-dwr-scrim.open{opacity:1;visibility:visible}

/* Drawer */
.cd-dwr{position:fixed;top:0;right:0;height:100vh;width:min(1080px,94vw);background:var(--bg);border-left:1px solid var(--line);box-shadow:-24px 0 60px -20px rgba(0,0,0,.7);transform:translateX(100%);transition:transform .32s cubic-bezier(.4,0,.2,1);z-index:100;display:flex;flex-direction:column}
.cd-dwr.open{transform:translateX(0)}
.cd-dwr-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:20px 26px;border-bottom:1px solid var(--line);flex:none}
.cd-dwr-hd-l{display:flex;align-items:center;gap:14px}
.cd-dwr-hd-ic{width:44px;height:44px;border-radius:12px;background:var(--a-soft);border:1px solid var(--a-ring);display:grid;place-items:center;flex:none}
.cd-dwr-kicker{font-family:var(--font-d);font-weight:800;font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-mute)}
.cd-dwr-title{font-family:var(--font-d);font-weight:900;font-size:1.45rem;letter-spacing:-.02em;line-height:1.1;margin-top:2px}
.cd-dwr-x{width:38px;height:38px;border-radius:10px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink-dim);display:grid;place-items:center;transition:all var(--tr)}
.cd-dwr-x:hover{border-color:var(--bad-line);color:var(--bad)}
.cd-dwr-body{flex:1;overflow-y:auto;padding:22px 26px 40px;display:flex;flex-direction:column;gap:18px}
.cd-dwr-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.cd-dwr-stat{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px}
.cd-dwr-stat-l{font-family:var(--font-d);font-weight:800;font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-mute)}
.cd-dwr-stat-v{font-family:var(--font-d);font-weight:900;font-size:2rem;letter-spacing:-.03em;line-height:1;margin-top:10px;color:var(--ink)}
.cd-dwr-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.cd-dwr-search{flex:1;min-width:240px;display:flex;align-items:center;gap:9px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-sm);padding:0 13px;transition:border-color var(--tr)}
.cd-dwr-search:focus-within{border-color:var(--a-ring)}
.cd-dwr-search input{flex:1;border:none;background:none;outline:none;color:var(--ink);font-family:var(--font-b);font-size:.86rem;padding:11px 0}
.cd-dwr-search input::placeholder{color:var(--ink-mute)}
.cd-dwr-chips{display:flex;gap:7px;flex-wrap:wrap}
.cd-dwr-chip{font-family:var(--font-d);font-weight:700;font-size:.78rem;color:var(--ink-dim);background:var(--surface);border:1px solid var(--line);padding:8px 14px;border-radius:var(--r-sm);transition:all var(--tr);cursor:pointer}
.cd-dwr-chip:hover{color:var(--ink)}
.cd-dwr-chip.on{color:var(--accent);border-color:var(--a-ring);background:var(--a-soft)}
.cd-dwr-actions{display:flex;gap:9px;flex-wrap:wrap}
.cd-dwr-act{display:inline-flex;align-items:center;gap:7px;font-family:var(--font-d);font-weight:700;font-size:.8rem;color:var(--ink);background:var(--surface);border:1px solid var(--line);padding:9px 14px;border-radius:var(--r-sm);transition:all var(--tr);cursor:pointer}
.cd-dwr-act:hover:not(:disabled){border-color:var(--a-ring);color:var(--accent)}
.cd-dwr-act:disabled{opacity:.45;cursor:not-allowed}
.cd-dwr-add{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.cd-dwr-add-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px}
.cd-dwr-add-lbl{font-family:var(--font-d);font-weight:800;font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-mute);margin-bottom:12px}
.cd-dwr-add-row{display:flex;gap:9px}
.cd-dwr-in{flex:1;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm);padding:11px 13px;color:var(--ink);font-family:var(--font-b);font-size:.85rem;outline:none;transition:border-color var(--tr)}
.cd-dwr-in:focus{border-color:var(--a-ring)}
.cd-dwr-in::placeholder{color:var(--ink-mute)}
.cd-dwr-add-btn{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-d);font-weight:700;font-size:.82rem;color:var(--accent);background:var(--a-soft);border:1px solid var(--a-ring);padding:0 16px;border-radius:var(--r-sm);transition:all var(--tr);flex:none;cursor:pointer}
.cd-dwr-add-btn:hover{background:var(--a-ring);color:#fff}
.cd-dwr-ta{width:100%;min-height:96px;resize:vertical;background:var(--surface-2);border:1px solid var(--line);border-radius:var(--r-sm);padding:11px 13px;color:var(--ink);font-size:.82rem;line-height:1.6;outline:none;transition:border-color var(--tr)}
.cd-dwr-ta:focus{border-color:var(--a-ring)}
.cd-dwr-ta::placeholder{color:var(--ink-mute)}
.cd-dwr-import{width:100%;margin-top:11px;font-family:var(--font-d);font-weight:800;font-size:.85rem;color:#fff;background:linear-gradient(110deg,var(--accent-2),var(--accent));padding:12px;border-radius:var(--r-sm);box-shadow:0 8px 22px -10px var(--a-ring);transition:transform var(--tr);cursor:pointer;border:none;display:block}
.cd-dwr-import:hover{transform:translateY(-1px)}
.cd-dwr-import:disabled{opacity:.55;cursor:not-allowed;transform:none;box-shadow:none}
.cd-dwr-import-upgrade{background:var(--good)!important;color:#0b1a12!important;box-shadow:none!important}
.cd-dwr-table{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow-x:auto}
.cd-dwr-trow{display:grid;grid-template-columns:34px minmax(180px,1.5fr) 100px 110px 92px 92px 64px 64px 96px 86px;align-items:center;gap:10px;padding:13px 18px;min-width:1000px}
.cd-dwr-thead{border-bottom:1px solid var(--line)}
.cd-dwr-thead span{font-family:var(--font-d);font-weight:800;font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-mute)}
.cd-dwr-num{text-align:right;font-family:var(--font-d);font-weight:700;font-size:.84rem}
.cd-dwr-rrow{border-bottom:1px solid var(--line-2);transition:background var(--tr)}
.cd-dwr-rrow:last-child{border-bottom:none}
.cd-dwr-rrow:hover{background:var(--a-tint)}
.cd-dwr-cb{width:17px;height:17px;border-radius:5px;border:1.5px solid var(--ink-mute);background:transparent;cursor:pointer;display:grid;place-items:center;transition:all var(--tr)}
.cd-dwr-cb.on{background:var(--accent);border-color:var(--accent)}
.cd-dwr-cb.on::after{content:"";width:9px;height:5px;border-left:2px solid #fff;border-bottom:2px solid #fff;transform:rotate(-45deg) translateY(-1px)}
.cd-dwr-u{display:flex;align-items:center;gap:10px;min-width:0}
.cd-dwr-u-av{width:30px;height:30px;border-radius:50%;flex:none}
.cd-dwr-u-h{font-family:var(--font-d);font-weight:700;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink)}
.cd-dwr-ver{font-size:.8rem;color:var(--ink-dim)}
.cd-dwr-ver.cd-nf{color:var(--ink-mute)}
.cd-dwr-pill{display:inline-flex;align-items:center;gap:5px;font-family:var(--font-d);font-weight:700;font-size:.72rem;padding:4px 10px;border-radius:100px;border:1px solid}
.cd-dwr-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.cd-elig{color:var(--good);background:var(--good-bg);border-color:var(--good-line)}
.cd-ver{color:var(--bad);background:var(--bad-bg);border-color:var(--bad-line)}
.cd-pend{color:var(--warn);background:var(--warn-bg);border-color:var(--warn-line)}
.cd-rej{color:var(--bad);background:var(--bad-bg);border-color:var(--bad-line)}
.cd-arch{color:var(--ink-mute);background:var(--surface-2);border-color:var(--line)}
.cd-dwr-tag{display:inline-block;font-family:var(--font-d);font-weight:700;font-size:.74rem;padding:3px 10px;border-radius:6px;background:var(--surface-2);border:1px solid var(--line);color:var(--ink-dim)}
.cd-dwr-dash{color:var(--ink-mute)}
.cd-dwr-last{font-size:.82rem;font-weight:700;color:var(--ink)}
.cd-dwr-added{font-family:var(--font-d);font-weight:800;font-size:.82rem;color:var(--ink)}
.cd-dwr-added-s{display:block;font-size:.7rem;color:var(--ink-mute);font-weight:600;margin-top:1px}
.cd-dwr-empty{padding:40px;text-align:center;color:var(--ink-mute);font-size:.88rem}

/* AI target search wizard */
.cd-ai-scrim{position:fixed;inset:0;background:rgba(4,6,10,.72);backdrop-filter:blur(4px);opacity:0;visibility:hidden;transition:opacity var(--tr),visibility var(--tr);z-index:130}
.cd-ai-scrim.open{opacity:1;visibility:visible}
.cd-ai-modal{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(720px,94vw);max-height:90vh;overflow:auto;display:grid;gap:16px;border:1px solid var(--line);border-radius:18px;background:var(--surface);color:var(--ink);box-shadow:var(--shadow);padding:22px 24px 20px;z-index:140}
.cd-ai-hd{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.cd-ai-step{font-family:var(--font-d);font-weight:800;font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-mute)}
.cd-ai-title{margin:8px 0 0;font-family:var(--font-d);font-size:1.35rem;font-weight:900;letter-spacing:-.02em}
.cd-ai-body{margin:8px 0 0;color:var(--ink-dim);font-size:.88rem;line-height:1.5}
.cd-ai-panel{display:grid;gap:14px}
.cd-ai-label{font-family:var(--font-d);font-weight:800;font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-mute)}
.cd-ai-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:center;margin-top:4px}
.cd-ai-back{display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:var(--font-d);font-weight:700;font-size:.84rem;color:var(--ink);background:var(--surface-2);border:1px solid var(--line);padding:12px;border-radius:var(--r-sm);cursor:pointer}
.cd-ai-secondary{width:100%;font-family:var(--font-d);font-weight:700;font-size:.82rem;color:var(--ink-dim);background:transparent;border:1px solid var(--line);padding:10px;border-radius:var(--r-sm);cursor:pointer}
.cd-ai-suggest{display:grid;border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden;background:var(--surface-2)}
.cd-ai-suggest-row{text-align:left;padding:11px 13px;border:none;border-bottom:1px solid var(--line);background:transparent;color:var(--ink);font-size:.84rem;cursor:pointer}
.cd-ai-suggest-row:last-child{border-bottom:none}
.cd-ai-suggest-row.on,.cd-ai-suggest-row:hover{background:var(--a-soft);color:var(--accent)}
.cd-ai-map{border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden;background:var(--surface-2);min-height:220px}
.cd-ai-map iframe{width:100%;height:220px;border:0;display:block}
.cd-ai-loading{display:grid;place-items:center;gap:12px;padding:28px 12px;color:var(--ink-dim);text-align:center}
.cd-ai-spinner{width:28px;height:28px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--accent);animation:cd-ai-spin .8s linear infinite}
@keyframes cd-ai-spin{to{transform:rotate(360deg)}}
.cd-ai-results{display:grid;gap:10px;max-height:340px;overflow:auto}
.cd-ai-row{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface-2)}
.cd-ai-row.ineligible{border-color:var(--bad-line);background:rgba(127,29,29,.08)}
.cd-ai-av{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;overflow:hidden;border:1px solid rgba(255,255,255,.08);background:var(--surface)}
.cd-ai-av img{width:100%;height:100%;object-fit:cover;display:block}
.cd-ai-av i{font-style:normal;font-family:var(--font-d);font-weight:800}
.cd-ai-row-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cd-ai-handle{font-family:var(--font-d);font-weight:700;color:var(--ink);text-decoration:none}
.cd-ai-handle:hover{color:var(--accent)}
.cd-ai-pill{font-family:var(--font-d);font-weight:700;font-size:.68rem;padding:4px 8px;border-radius:999px;border:1px solid var(--line)}
.cd-ai-pill.ok{color:var(--good);border-color:var(--good-line);background:var(--good-bg)}
.cd-ai-pill.bad{color:var(--bad);border-color:var(--bad-line);background:var(--bad-bg)}
.cd-ai-row-meta{display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;color:var(--ink-mute);font-size:.78rem}
.cd-ai-row-actions{display:flex;gap:8px;align-items:center}
.cd-ai-link,.cd-ai-remove{width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:var(--surface);color:var(--ink);display:grid;place-items:center;text-decoration:none;cursor:pointer}
.cd-ai-remove{color:var(--bad);border-color:var(--bad-line)}
.cd-ai-error,.cd-ai-warning,.cd-ai-hint{font-size:.84rem;line-height:1.45}
.cd-ai-error{color:var(--bad)}
.cd-ai-warning{color:var(--warn)}
.cd-ai-hint{color:var(--ink-mute)}
.cd-ai-help{font-size:.82rem;color:var(--accent);text-decoration:none}
.cd-ai-help:hover{text-decoration:underline}

/* DM Templates */
.cd-dm-wrap{display:grid;gap:18px}
.cd-dm-toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.cd-dm-account-label{font-family:var(--font-d);font-weight:700;font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-mute)}
.cd-dm-account-select{min-width:220px;background:var(--surface-2);border:1px solid var(--line);color:var(--ink);border-radius:var(--r-sm);padding:10px 12px;font-size:.88rem}
.cd-dm-pack-pill{font-family:var(--font-d);font-weight:700;font-size:.72rem;padding:6px 10px;border-radius:999px;border:1px solid var(--line);color:var(--ink-dim);background:var(--surface-2)}
.cd-dm-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.cd-dm-card{display:grid;gap:14px;border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:18px}
.cd-dm-card-welcome{border-color:rgba(52,211,153,.28);background:linear-gradient(180deg,rgba(16,185,129,.08),var(--surface) 42%)}
.cd-dm-card-outreach{border-color:rgba(90,108,245,.28);background:linear-gradient(180deg,rgba(90,108,245,.08),var(--surface) 42%)}
.cd-dm-card-locked .cd-dm-fields-disabled{opacity:.55;pointer-events:none;filter:grayscale(.15)}
.cd-dm-card-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.cd-dm-card-head h3{margin:0;font-family:var(--font-d);font-size:1.05rem;font-weight:800;letter-spacing:-.02em}
.cd-dm-card-head p{margin:6px 0 0;color:var(--ink-dim);font-size:.84rem;line-height:1.45}
.cd-dm-save-status{font-family:var(--font-d);font-size:.72rem;font-weight:700;padding:5px 8px;border-radius:999px;border:1px solid var(--line);color:var(--ink-mute)}
.cd-dm-save-saving{color:var(--warn);border-color:rgba(251,191,36,.35)}
.cd-dm-save-saved{color:var(--good);border-color:var(--good-line)}
.cd-dm-save-error{color:var(--bad);border-color:var(--bad-line)}
.cd-dm-locked-panel{display:grid;gap:12px;padding:14px;border-radius:12px;border:1px solid rgba(52,211,153,.25);background:rgba(16,185,129,.08)}
.cd-dm-card-outreach .cd-dm-locked-panel{border-color:rgba(90,108,245,.25);background:rgba(90,108,245,.08)}
.cd-dm-locked-copy{margin:0;color:var(--ink);font-size:.88rem;line-height:1.5}
.cd-dm-cta{display:inline-flex;align-items:center;justify-content:center;width:fit-content;padding:11px 16px;border-radius:999px;background:var(--accent);color:#04120d;font-family:var(--font-d);font-weight:800;font-size:.84rem;text-decoration:none}
.cd-dm-cta:hover{filter:brightness(1.05)}
.cd-dm-offer-unavailable{margin:0;color:var(--ink-mute);font-size:.82rem}
.cd-dm-fields{display:grid;gap:10px}
.cd-dm-textarea{width:100%;min-height:140px;resize:vertical;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;color:var(--ink);padding:12px 14px;font-size:.88rem;line-height:1.45}
.cd-dm-var-hint{margin:0;color:var(--ink-mute);font-size:.78rem}
.cd-dm-toggle-row{display:inline-flex;align-items:center;gap:10px;color:var(--ink);font-size:.86rem}
.cd-dm-empty{display:grid;gap:10px;padding:28px;border:1px dashed var(--line);border-radius:16px;background:var(--surface)}
.cd-dm-empty-title{margin:0;font-family:var(--font-d);font-size:1.1rem;font-weight:800}
.cd-dm-empty-body{margin:0;color:var(--ink-dim);font-size:.9rem;line-height:1.5}

/* Responsive */
@media(max-width:1100px){
  .cd-dm-cards{grid-template-columns:1fr}
  .cd-stats-row{grid-template-columns:1fr 1fr}
  .cd-two-col{grid-template-columns:1fr}
  .cd-tg2-cols{grid-template-columns:1fr}
  .cd-dwr-add{grid-template-columns:1fr}
  .cd-dwr-stats{grid-template-columns:1fr}
}
@media(max-width:720px){
  .cd-shell{grid-template-columns:1fr}
  .cd-sidebar{display:none}
  .cd-acc-grid{grid-template-columns:1fr}
}
`;
