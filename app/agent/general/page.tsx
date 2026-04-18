"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
};

type AgentKey = "general" | "sales" | "support";

type Conversation = {
  id: string;
  title: string;
  agent: AgentKey;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
};

type Lang = "fr" | "en";

const STORAGE_KEY = "boost_ai_conversations_v2";
const LANG_KEY = "boost_ai_lang_v2";

// Accent colors (Assistant identity)
const AC = "#8B7CF6";
const AC_DIM = "rgba(139,124,246,0.12)";
const AC_BORDER = "rgba(139,124,246,0.28)";
const AC_TEXT = "#a594f9";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const NAV_LINKS = [
  { label: { fr: "UGC Ads Engine", en: "UGC Ads Engine" }, href: "/agent/ugc-ads-engine", color: "#F97316" },
  { label: { fr: "AI Assistant", en: "AI Assistant" }, href: "/agent/general", color: AC },
  { label: { fr: "WhatsApp Leads", en: "WhatsApp Leads" }, href: "/agent/whatsapp-lead-system", color: "#25D366" },
  { label: { fr: "Support Agent", en: "Support Agent" }, href: "/agent/support", color: "#3B82F6" },
];

const copy = {
  fr: {
    brand: "Boost My Businesses AI",
    subtitle: "Assistant business premium",
    newChat: "Nouvelle conversation",
    backHome: "← Retour à l'accueil",
    navCta: "Commencer",
    heroTitle: "Ton équipe IA, toujours disponible.",
    heroSub: "Arrête de faire manuellement ce que tes agents peuvent gérer automatiquement. Qualifie des leads, réponds à tes clients, produis du contenu — tout depuis un seul espace, 24h/24.",
    stats: [
      { label: "Agents", value: "3 actifs" },
      { label: "Réponse", value: "Instantanée" },
      { label: "Mémoire", value: "Par session" },
    ],
    placeholder: "Tape ton message...",
    send: "Envoyer",
    attachmentsSoon: "Pièces jointes bientôt",
    thinking: "L'assistant réfléchit...",
    emptyState: "Commence une conversation, choisis un agent et envoie une demande.",
    suggestionsTitle: "Suggestions rapides",
    conversations: "Conversations",
    noConversations: "Aucune conversation pour le moment",
    agentLabel: "Navigation agents",
    welcome: "Bienvenue sur Boost AI. Dis-moi ce que tu veux automatiser.",
    error: "Erreur de connexion avec l'agent n8n. Vérifie le webhook ou la réponse du workflow.",
    agents: {
      general: "Assistant général",
      sales: "Agent Sales",
      support: "Agent Support",
    },
    prompts: {
      general: [
        "Prépare un plan d'automatisation pour une PME",
        "Résume les tâches business qu'une IA peut gérer",
        "Donne-moi une stratégie simple pour gagner du temps",
      ],
      sales: [
        "Rédige un script de vente pour un client froid",
        "Donne-moi 5 idées de séquences de relance commerciale",
        "Prépare un plan simple pour convertir plus de prospects",
      ],
      support: [
        "Rédige une réponse client professionnelle et empathique",
        "Crée une structure de FAQ pour un SaaS IA",
        "Donne-moi 5 workflows pour automatiser le support client",
      ],
    },
    footerTagline: "Des agents IA pour de vrais workflows business.",
    footerAgents: "Agents",
    footerLegal: "Légal",
    footerPrivacy: "Politique de confidentialité",
    footerTerms: "Conditions d'utilisation",
    footerMentions: "Mentions légales",
    footerCopy: "© 2025 BoostMyBusinesses. Tous droits réservés.",
    footerMade: "Fait avec IA — conçu pour les humains.",
  },
  en: {
    brand: "Boost My Businesses AI",
    subtitle: "Premium business assistant",
    newChat: "New conversation",
    backHome: "← Back to homepage",
    navCta: "Get started",
    heroTitle: "Your AI team, always on.",
    heroSub: "Stop doing manually what your agents can handle automatically. Qualify leads, answer clients, produce content — all in one workspace, 24/7.",
    stats: [
      { label: "Agents", value: "3 active" },
      { label: "Response", value: "Instant" },
      { label: "Memory", value: "Per session" },
    ],
    placeholder: "Type your message...",
    send: "Send",
    attachmentsSoon: "Attachments soon",
    thinking: "The assistant is thinking...",
    emptyState: "Start a conversation, choose an agent, and send a request.",
    suggestionsTitle: "Quick suggestions",
    conversations: "Conversations",
    noConversations: "No conversations yet",
    agentLabel: "Agent navigation",
    welcome: "Welcome to Boost AI. Tell me what you want to automate.",
    error: "Connection error with the n8n agent. Check the webhook or workflow response.",
    agents: {
      general: "General Assistant",
      sales: "Sales Agent",
      support: "Support Agent",
    },
    prompts: {
      general: [
        "Build an automation plan for a small business",
        "Summarize business tasks AI can handle",
        "Give me a simple strategy to save time with AI",
      ],
      sales: [
        "Write a sales script for a cold prospect",
        "Give me 5 follow-up sequence ideas",
        "Create a simple plan to improve conversion",
      ],
      support: [
        "Write a professional and empathetic customer reply",
        "Create an FAQ structure for an AI SaaS",
        "Give me 5 workflows to automate customer support",
      ],
    },
    footerTagline: "AI agents built for real business workflows.",
    footerAgents: "Agents",
    footerLegal: "Legal",
    footerPrivacy: "Privacy policy",
    footerTerms: "Terms of service",
    footerMentions: "Mentions légales",
    footerCopy: "© 2025 BoostMyBusinesses. All rights reserved.",
    footerMade: "Made with AI — built for humans.",
  },
};

export default function Page() {
  const pathname = usePathname();
  const [lang, setLang] = useState<Lang>("en");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [typingPhase, setTypingPhase] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const webhookUrl = process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL;
  const t = copy[lang];

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    const storedLang = localStorage.getItem(LANG_KEY) as Lang | null;
    if (storedLang === "fr" || storedLang === "en") setLang(storedLang);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Conversation[];
        if (parsed.length) {
          setConversations(parsed);
          setActiveId(parsed[0].id);
          return;
        }
      } catch {}
    }
    const first = createConversation("general", copy[storedLang === "fr" ? "fr" : "en"].welcome);
    setConversations([first]);
    setActiveId(first.id);
  }, []);

  useEffect(() => { localStorage.setItem(LANG_KEY, lang); }, [lang]);

  useEffect(() => {
    if (conversations.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations, activeId, loading]);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => { setTypingPhase((p) => (p + 1) % 4); }, 350);
    return () => window.clearInterval(id);
  }, [loading]);

  const activeConversation = useMemo(() => {
    return conversations.find((c) => c.id === activeId) ?? null;
  }, [conversations, activeId]);

  function createConversation(agent: AgentKey, welcomeText: string): Conversation {
    return {
      id: uid(),
      title: lang === "fr" ? "Nouvelle conversation" : "New conversation",
      agent,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [{ id: uid(), role: "assistant", content: welcomeText, createdAt: Date.now() }],
    };
  }

  function handleNewConversation(agent?: AgentKey) {
    const nextAgent = agent ?? activeConversation?.agent ?? "general";
    const conv = createConversation(nextAgent, t.welcome);
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setInput("");
  }

  function updateConversation(patch: Partial<Conversation>) {
    setConversations((prev) =>
      prev.map((c) => c.id === activeId ? { ...c, ...patch, updatedAt: Date.now() } : c)
        .sort((a, b) => b.updatedAt - a.updatedAt)
    );
  }

  function updateMessages(messages: Message[]) {
    updateConversation({
      messages,
      title: messages.find((m) => m.role === "user")?.content.slice(0, 36) ||
        (lang === "fr" ? "Nouvelle conversation" : "New conversation"),
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading || !activeConversation) return;
    const userText = input.trim();
    const nextMessages = [
      ...activeConversation.messages,
      { id: uid(), role: "user" as const, content: userText, createdAt: Date.now() },
    ];
    updateMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(webhookUrl as string, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userText,
          agent: activeConversation.agent,
          language: lang,
          conversationId: activeConversation.id,
        }),
      });
      const data = await res.json();
      const reply = data.output || data.response || data.message || data.reply || data.text ||
        (lang === "fr" ? "Réponse reçue, mais aucun champ exploitable n'a été trouvé." : "Response received, but no usable text field was found.");
      const current = conversations.find((c) => c.id === activeId);
      const safeBase = current?.messages ?? nextMessages;
      updateMessages([...safeBase, { id: uid(), role: "assistant", content: String(reply), createdAt: Date.now() }]);
    } catch {
      const current = conversations.find((c) => c.id === activeId);
      const safeBase = current?.messages ?? nextMessages;
      updateMessages([...safeBase, { id: uid(), role: "assistant", content: t.error, createdAt: Date.now() }]);
    } finally {
      setLoading(false);
    }
  }

  function usePrompt(prompt: string) { setInput(prompt); }
  function typingDots() { return ".".repeat(typingPhase === 0 ? 1 : typingPhase); }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "linear-gradient(180deg, #07101f 0%, #081226 100%)", color: "#eef2ff", fontFamily: "'DM Sans', system-ui, sans-serif" }}>

      {/* ── NAVBAR ── */}
      <header style={{
        position: "sticky", top: 0, zIndex: 100, height: 58,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", gap: 16,
        background: scrolled ? "rgba(7,16,31,0.92)" : "rgba(7,16,31,0.80)",
        backdropFilter: "blur(20px)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        transition: "background 300ms ease",
      }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", flexShrink: 0 }}>
          <span style={{ width: 28, height: 28, borderRadius: 6, background: AC, color: "#000", fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>B</span>
          <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 13.5, fontWeight: 600, color: "#f0f0ef" }}>
            Boost<span style={{ color: "rgba(255,255,255,0.38)", fontWeight: 400 }}>My</span>Businesses
          </span>
        </Link>

        <nav style={{ display: "flex", gap: 2, flex: 1, justifyContent: "center" }}>
          {NAV_LINKS.map((link) => {
            const isActive = pathname === link.href;
            return (
              <Link key={link.href} href={link.href} style={{ padding: "5px 11px", fontSize: 12.5, fontWeight: 500, color: isActive ? link.color : "rgba(255,255,255,0.48)", textDecoration: "none", borderRadius: 999, background: isActive ? "rgba(255,255,255,0.06)" : "transparent", transition: "color 150ms" }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.color = link.color; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.48)"; }}>
                {link.label[lang]}
              </Link>
            );
          })}
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{ display: "flex", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 999, padding: 3, gap: 2 }}>
            {(["fr", "en"] as Lang[]).map((l) => (
              <button key={l} type="button" onClick={() => setLang(l)} style={{ height: 26, width: 36, borderRadius: 999, border: "none", fontSize: 11, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", letterSpacing: "0.04em", background: lang === l ? "rgba(255,255,255,0.10)" : "transparent", color: lang === l ? "#f0f0ef" : "rgba(255,255,255,0.35)", transition: "all 150ms" }}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <Link href="/#pricing" style={{ padding: "7px 16px", background: AC, color: "#000", fontSize: 12.5, fontWeight: 700, borderRadius: 999, textDecoration: "none" }}>
            {t.navCta}
          </Link>
        </div>
      </header>

      {/* ── SHELL ── */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", flex: 1, minHeight: 0 }}>

        {/* ── SIDEBAR ── */}
        <aside style={{ padding: 14, borderRight: "1px solid rgba(255,255,255,0.07)", background: "rgba(7,13,28,0.80)", backdropFilter: "blur(22px)", display: "flex", flexDirection: "column", gap: 11, overflowY: "auto" }}>

          {/* Brand */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${AC}, #a594f9)`, color: "#fff", fontFamily: "'Syne', sans-serif", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 6px 16px rgba(139,124,246,0.28)` }}>AI</div>
            <div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 12.5, color: "#f0f0ef", letterSpacing: "-0.01em" }}>{t.brand}</div>
              <div style={{ color: "#8B9BC4", fontSize: 10.5, marginTop: 2 }}>{t.subtitle}</div>
            </div>
          </div>

          {/* New conversation */}
          <button onClick={() => handleNewConversation()} style={{ border: "none", cursor: "pointer", borderRadius: 12, padding: "10px 12px", color: "#000", display: "flex", alignItems: "center", gap: 7, justifyContent: "center", fontWeight: 700, fontSize: 12.5, background: AC, boxShadow: `0 6px 18px rgba(139,124,246,0.26)`, transition: "opacity 150ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.88"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}>
            <span>＋</span>{t.newChat}
          </button>

          {/* Back to homepage */}
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", borderRadius: 11, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "rgba(255,255,255,0.58)", fontSize: 12, textDecoration: "none", transition: "all 150ms" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.color = "#f0f0ef"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.58)"; }}>
            {t.backHome}
          </Link>

          {/* Agent navigation */}
          <div style={{ borderRadius: 13, padding: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ color: "#8B9BC4", fontSize: 9.5, marginBottom: 9, textTransform: "uppercase", letterSpacing: "0.10em", fontFamily: "'JetBrains Mono', monospace" }}>{t.agentLabel}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Link href="/agent/general" style={{ padding: "8px 10px", borderRadius: 10, background: AC_DIM, border: `1px solid ${AC_BORDER}`, color: "#f0f0ef", fontSize: 12.5, textDecoration: "none", display: "flex", alignItems: "center", gap: 7 }}>
                🤖 {t.agents.general}
              </Link>
              <Link href="/agent/sales" style={{ padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.03)", color: "#edf2ff", fontSize: 12.5, textDecoration: "none", display: "flex", alignItems: "center", gap: 7, transition: "background 150ms" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}>
                💰 {t.agents.sales}
              </Link>
              <Link href="/agent/support" style={{ padding: "8px 10px", borderRadius: 10, background: "rgba(255,255,255,0.03)", color: "#edf2ff", fontSize: 12.5, textDecoration: "none", display: "flex", alignItems: "center", gap: 7, transition: "background 150ms" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.06)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; }}>
                🛠️ {t.agents.support}
              </Link>
            </div>
          </div>

          {/* Conversations */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
            <div style={{ color: "rgba(255,255,255,0.32)", fontSize: 9.5, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em" }}>{t.conversations}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto" }}>
              {conversations.length === 0 ? (
                <div style={{ color: "#8193b9", fontSize: 12, padding: "8px 4px" }}>{t.noConversations}</div>
              ) : (
                conversations.map((conv) => (
                  <button key={conv.id} onClick={() => setActiveId(conv.id)} style={{ textAlign: "left", border: `1px solid ${conv.id === activeId ? AC_BORDER : "rgba(255,255,255,0.06)"}`, background: conv.id === activeId ? AC_DIM : "rgba(255,255,255,0.03)", borderRadius: 11, padding: "9px 10px", color: "white", cursor: "pointer", transition: "all 150ms" }}>
                    <div style={{ fontSize: 9, color: "#8B9BC4", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "'JetBrains Mono', monospace", marginBottom: 3 }}>{t.agents[conv.agent]}</div>
                    <div style={{ fontSize: 12.5, color: "#f1f5ff", lineHeight: 1.35 }}>{conv.title}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* ── RIGHT COLUMN ── */}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflowY: "auto" }}>
          <main style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>

            {/* Hero */}
            <div style={{ maxWidth: 820, margin: "0 auto", width: "100%" }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px 5px 8px", background: AC_DIM, border: `1px solid ${AC_BORDER}`, borderRadius: 999, fontSize: 10.5, fontWeight: 500, color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em", marginBottom: 16 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: AC, boxShadow: `0 0 8px ${AC}`, flexShrink: 0 }} />
                Premium AI Workspace
              </div>
              <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.6rem, 2.8vw, 2.4rem)", fontWeight: 800, lineHeight: 1.07, letterSpacing: "-0.03em", color: "#f0f0ef", marginBottom: 12 }}>
                {t.heroTitle}
              </h1>
              <p style={{ color: "#8B9BC4", fontSize: 14, lineHeight: 1.72, maxWidth: 580 }}>
                {t.heroSub}
              </p>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, maxWidth: 820, margin: "0 auto", width: "100%" }}>
              {t.stats.map((stat) => (
                <div key={stat.label} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 13, padding: "11px 14px", transition: "border-color 200ms" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.32)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{stat.label}</div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: AC_TEXT }}>{stat.value}</div>
                </div>
              ))}
            </div>

            {/* Suggestions */}
            <div style={{ maxWidth: 820, margin: "0 auto", width: "100%" }}>
              <div style={{ color: "rgba(255,255,255,0.38)", fontSize: 10, fontWeight: 500, marginBottom: 9, fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.09em" }}>{t.suggestionsTitle}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                {t.prompts[activeConversation?.agent ?? "general"].map((prompt) => (
                  <button key={prompt} onClick={() => usePrompt(prompt)} style={{ textAlign: "left", border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.03)", color: "#edf2ff", borderRadius: 14, padding: "12px 13px", cursor: "pointer", lineHeight: 1.45, fontSize: 12.5, transition: "all 150ms", minHeight: 68 }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = AC_DIM; (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {/* Chat panel */}
            <section style={{ maxWidth: 820, margin: "0 auto", width: "100%", flex: 1, display: "flex", flexDirection: "column", borderRadius: 22, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", backdropFilter: "blur(18px)", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.22)" }}>
              <div style={{ flex: 1, minHeight: 320, maxHeight: "calc(100vh - 480px)", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 13 }}>
                {!activeConversation || activeConversation.messages.length === 0 ? (
                  <div style={{ color: "#97a8cf", padding: "20px 4px", fontSize: 13 }}>{t.emptyState}</div>
                ) : (
                  activeConversation.messages.map((msg) => (
                    <div key={msg.id} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                      <div style={{ maxWidth: "78%", padding: "12px 16px", borderRadius: 18, lineHeight: 1.65, whiteSpace: "pre-wrap", fontSize: 13.5, background: msg.role === "user" ? `linear-gradient(135deg, ${AC}, #a594f9)` : "rgba(255,255,255,0.92)", color: msg.role === "user" ? "#fff" : "#101827", borderBottomRightRadius: msg.role === "user" ? 5 : 18, borderBottomLeftRadius: msg.role === "assistant" ? 5 : 18, fontWeight: msg.role === "user" ? 500 : 400, boxShadow: "0 8px 20px rgba(0,0,0,0.10)" }}>
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
                {loading && (
                  <div style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div style={{ maxWidth: "78%", padding: "12px 16px", borderRadius: 18, borderBottomLeftRadius: 5, lineHeight: 1.65, fontSize: 13.5, background: "rgba(255,255,255,0.92)", color: "#101827", minWidth: 180 }}>
                      {t.thinking}{typingDots()}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={handleSubmit} style={{ display: "flex", alignItems: "center", gap: 11, padding: 15, borderTop: "1px solid rgba(255,255,255,0.07)", background: "rgba(7,12,24,0.80)" }}>
                <button type="button" title={t.attachmentsSoon} disabled style={{ width: 46, height: 46, borderRadius: 13, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.04)", color: "#9fb1da", cursor: "not-allowed", flexShrink: 0, fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center" }}>＋</button>
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t.placeholder} style={{ flex: 1, height: 46, borderRadius: 13, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.05)", color: "white", padding: "0 15px", outline: "none", fontSize: 13.5 }} />
                <button type="submit" disabled={loading || !input.trim()} style={{ height: 46, border: "none", borderRadius: 13, padding: "0 20px", background: AC, color: "#000", fontWeight: 700, cursor: "pointer", fontSize: 13.5, boxShadow: `0 8px 22px rgba(139,124,246,0.26)`, opacity: (loading || !input.trim()) ? 0.6 : 1, transition: "opacity 150ms" }}>{t.send}</button>
              </form>
            </section>

          </main>

          {/* ── FOOTER ── */}
          <footer style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "24px 28px 18px", background: "rgba(255,255,255,0.01)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 32, marginBottom: 20 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
                  <span style={{ width: 22, height: 22, borderRadius: 4, background: AC, color: "#000", fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>B</span>
                  <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.55)" }}>BoostMyBusinesses</span>
                </div>
                <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.6, maxWidth: 220 }}>{t.footerTagline}</p>
              </div>
              <div>
                <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "rgba(255,255,255,0.24)", marginBottom: 12 }}>{t.footerAgents}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[{ label: { fr: "UGC Ads Engine", en: "UGC Ads Engine" }, href: "/agent/ugc-ads-engine", color: "#F97316" }, { label: { fr: "AI Assistant", en: "AI Assistant" }, href: "/agent/general", color: AC }, { label: { fr: "WhatsApp Leads", en: "WhatsApp Leads" }, href: "/agent/whatsapp-lead-system", color: "#25D366" }, { label: { fr: "Support Agent", en: "Support Agent" }, href: "/agent/support", color: "#3B82F6" }].map((item) => (
                    <Link key={item.href} href={item.href} style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)", textDecoration: "none", transition: "color 150ms" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = item.color; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)"; }}>
                      {item.label[lang]}
                    </Link>
                  ))}
                </div>
              </div>
              <div>
                <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, fontWeight: 500, letterSpacing: "0.10em", textTransform: "uppercase", color: "rgba(255,255,255,0.24)", marginBottom: 12 }}>{t.footerLegal}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[t.footerPrivacy, t.footerTerms, t.footerMentions].map((item) => (
                    <span key={item} style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)", cursor: "pointer", transition: "color 150ms" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f0f0ef"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)"; }}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "rgba(255,255,255,0.20)" }}>{t.footerCopy}</p>
              <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "rgba(255,255,255,0.20)" }}>{t.footerMade}</p>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
