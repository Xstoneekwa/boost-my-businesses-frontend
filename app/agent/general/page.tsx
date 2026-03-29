"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

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

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const copy = {
  fr: {
    brand: "Boost My Businesses AI",
    subtitle: "Assistant business premium",
    newChat: "Nouvelle conversation",
    heroTitle: "Demande à ton assistant business IA",
    heroSub:
      "Un espace premium pour centraliser tes agents, tester tes workflows et présenter un vrai produit SaaS.",
    placeholder: "Tape ton message...",
    send: "Envoyer",
    attachmentsSoon: "Pièces jointes bientôt",
    thinking: "L’assistant réfléchit...",
    emptyState:
      "Commence une conversation, choisis un agent et envoie une demande.",
    suggestionsTitle: "Suggestions rapides",
    conversations: "Conversations",
    noConversations: "Aucune conversation pour le moment",
    agentLabel: "Navigation agents",
    languageLabel: "Langue",
    welcome:
      "Bienvenue sur Boost AI. Dis-moi ce que tu veux automatiser.",
    error:
      "Erreur de connexion avec l’agent n8n. Vérifie le webhook ou la réponse du workflow.",
    agents: {
      general: "Assistant général",
      sales: "Agent Sales",
      support: "Agent Support",
    },
    prompts: {
      general: [
        "Prépare un plan d’automatisation pour une PME",
        "Résume les tâches business qu’une IA peut gérer",
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
  },
  en: {
    brand: "Boost My Businesses AI",
    subtitle: "Premium business assistant",
    newChat: "New conversation",
    heroTitle: "Ask your AI business assistant",
    heroSub:
      "A premium workspace to centralize your agents, test workflows, and showcase a real SaaS product.",
    placeholder: "Type your message...",
    send: "Send",
    attachmentsSoon: "Attachments soon",
    thinking: "The assistant is thinking...",
    emptyState:
      "Start a conversation, choose an agent, and send a request.",
    suggestionsTitle: "Quick suggestions",
    conversations: "Conversations",
    noConversations: "No conversations yet",
    agentLabel: "Agent navigation",
    languageLabel: "Language",
    welcome:
      "Welcome to Boost AI. Tell me what you want to automate.",
    error:
      "Connection error with the n8n agent. Check the webhook or workflow response.",
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
  },
};

export default function Page() {
  const [lang, setLang] = useState<Lang>("en");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [typingPhase, setTypingPhase] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const webhookUrl = process.env.NEXT_PUBLIC_N8N_WEBHOOK_URL;
  const t = copy[lang];

  useEffect(() => {
    const storedLang = localStorage.getItem(LANG_KEY) as Lang | null;
    if (storedLang === "fr" || storedLang === "en") {
      setLang(storedLang);
    }

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

    const first = createConversation(
      "general",
      copy[storedLang === "fr" ? "fr" : "en"].welcome
    );
    setConversations([first]);
    setActiveId(first.id);
  }, []);

  useEffect(() => {
    localStorage.setItem(LANG_KEY, lang);
  }, [lang]);

  useEffect(() => {
    if (conversations.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    }
  }, [conversations]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations, activeId, loading]);

  useEffect(() => {
    if (!loading) return;
    const id = window.setInterval(() => {
      setTypingPhase((p) => (p + 1) % 4);
    }, 350);
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
      messages: [
        {
          id: uid(),
          role: "assistant",
          content: welcomeText,
          createdAt: Date.now(),
        },
      ],
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
      prev
        .map((c) =>
          c.id === activeId ? { ...c, ...patch, updatedAt: Date.now() } : c
        )
        .sort((a, b) => b.updatedAt - a.updatedAt)
    );
  }

  function updateMessages(messages: Message[]) {
    updateConversation({
      messages,
      title:
        messages.find((m) => m.role === "user")?.content.slice(0, 36) ||
        (lang === "fr" ? "Nouvelle conversation" : "New conversation"),
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading || !activeConversation) return;

    const userText = input.trim();

    const nextMessages = [
      ...activeConversation.messages,
      {
        id: uid(),
        role: "user" as const,
        content: userText,
        createdAt: Date.now(),
      },
    ];

    updateMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const payload = {
        message: userText,
        agent: activeConversation.agent,
        language: lang,
        conversationId: activeConversation.id,
      };

      const res = await fetch(webhookUrl as string, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      const reply =
        data.output ||
        data.response ||
        data.message ||
        data.reply ||
        data.text ||
        (lang === "fr"
          ? "Réponse reçue, mais aucun champ exploitable n’a été trouvé."
          : "Response received, but no usable text field was found.");

      const current = conversations.find((c) => c.id === activeId);
      const safeBase = current?.messages ?? nextMessages;

      updateMessages([
        ...safeBase,
        {
          id: uid(),
          role: "assistant",
          content: String(reply),
          createdAt: Date.now(),
        },
      ]);
    } catch {
      const current = conversations.find((c) => c.id === activeId);
      const safeBase = current?.messages ?? nextMessages;

      updateMessages([
        ...safeBase,
        {
          id: uid(),
          role: "assistant",
          content: t.error,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function usePrompt(prompt: string) {
    setInput(prompt);
  }

  function typingDots() {
    return ".".repeat(typingPhase === 0 ? 1 : typingPhase);
  }

  return (
    <>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar-top">
            <div className="brand">
              <div className="brand-icon">AI</div>
              <div>
                <div className="brand-title">{t.brand}</div>
                <div className="brand-subtitle">{t.subtitle}</div>
              </div>
            </div>

            <button className="new-chat-btn" onClick={() => handleNewConversation()}>
              <span>＋</span>
              {t.newChat}
            </button>

            <div className="control-card">
              <div className="control-label">{t.languageLabel}</div>
              <div className="segmented">
                <button
                  type="button"
                  className={lang === "fr" ? "segmented-btn active" : "segmented-btn"}
                  onClick={() => setLang("fr")}
                >
                  FR
                </button>
                <button
                  type="button"
                  className={lang === "en" ? "segmented-btn active" : "segmented-btn"}
                  onClick={() => setLang("en")}
                >
                  EN
                </button>
              </div>
            </div>

            <div className="control-card">
              <div className="control-label">{t.agentLabel}</div>
              <div className="sidebar-links">
                <Link href="/agent/general" className="sidebar-link active-link">
                  🤖 {t.agents.general}
                </Link>

                <Link href="/agent/sales" className="sidebar-link">
                  💰 {t.agents.sales}
                </Link>

                <Link href="/agent/support" className="sidebar-link">
                  🛠️ {t.agents.support}
                </Link>
              </div>
            </div>
          </div>

          <div className="sidebar-section">
            <div className="section-title">{t.conversations}</div>

            <div className="conversation-list">
              {conversations.length === 0 ? (
                <div className="empty-sidebar">{t.noConversations}</div>
              ) : (
                conversations.map((conv) => (
                  <button
                    key={conv.id}
                    className={
                      conv.id === activeId
                        ? "conversation-item active"
                        : "conversation-item"
                    }
                    onClick={() => setActiveId(conv.id)}
                  >
                    <div className="conversation-top">
                      <span className="conversation-agent">
                        {t.agents[conv.agent]}
                      </span>
                    </div>
                    <div className="conversation-title">{conv.title}</div>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="hero">
            <div className="hero-badge">Premium AI Workspace</div>
            <h1>{t.heroTitle}</h1>
            <p>{t.heroSub}</p>
          </div>

          <div className="suggestions-wrap">
            <div className="suggestions-title">{t.suggestionsTitle}</div>
            <div className="suggestions-grid">
              {t.prompts[activeConversation?.agent ?? "general"].map((prompt) => (
                <button
                  key={prompt}
                  className="suggestion-card"
                  onClick={() => usePrompt(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <section className="chat-panel">
            <div className="messages">
              {!activeConversation || activeConversation.messages.length === 0 ? (
                <div className="empty-state">{t.emptyState}</div>
              ) : (
                activeConversation.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={
                      msg.role === "user"
                        ? "message-row user"
                        : "message-row assistant"
                    }
                  >
                    <div
                      className={
                        msg.role === "user" ? "bubble user" : "bubble assistant"
                      }
                    >
                      {msg.content}
                    </div>
                  </div>
                ))
              )}

              {loading && (
                <div className="message-row assistant">
                  <div className="bubble assistant typing">
                    {t.thinking}
                    {typingDots()}
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            <form className="composer" onSubmit={handleSubmit}>
              <button
                type="button"
                className="ghost-btn"
                title={t.attachmentsSoon}
                disabled
              >
                ＋
              </button>

              <input
                className="composer-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t.placeholder}
              />

              <button type="submit" className="send-btn" disabled={loading}>
                {t.send}
              </button>
            </form>
          </section>
        </main>
      </div>

      <style jsx global>{`
        * {
          box-sizing: border-box;
        }

        html,
        body {
          margin: 0;
          padding: 0;
          background:
            radial-gradient(circle at top left, rgba(124, 92, 255, 0.12), transparent 24%),
            radial-gradient(circle at top right, rgba(58, 143, 255, 0.1), transparent 18%),
            linear-gradient(180deg, #07101f 0%, #081226 100%);
          color: #eef2ff;
          font-family:
            Inter,
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }

        button,
        input,
        select {
          font: inherit;
        }

        .shell {
          display: grid;
          grid-template-columns: 320px 1fr;
          min-height: 100vh;
        }

        .sidebar {
          padding: 18px;
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(7, 13, 28, 0.72);
          backdrop-filter: blur(22px);
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .sidebar-top {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 14px;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        }

        .brand-icon {
          width: 42px;
          height: 42px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          background: linear-gradient(135deg, #7c5cff, #4ea1ff);
          color: white;
          box-shadow: 0 10px 24px rgba(124, 92, 255, 0.28);
        }

        .brand-title {
          font-weight: 700;
          font-size: 15px;
          letter-spacing: -0.02em;
        }

        .brand-subtitle {
          color: #93a3c7;
          font-size: 12px;
          margin-top: 2px;
        }

        .new-chat-btn {
          border: none;
          cursor: pointer;
          border-radius: 16px;
          padding: 13px 14px;
          color: white;
          display: flex;
          align-items: center;
          gap: 8px;
          justify-content: center;
          font-weight: 600;
          background: linear-gradient(135deg, #7c5cff, #4ea1ff);
          box-shadow: 0 14px 30px rgba(89, 90, 255, 0.22);
        }

        .control-card {
          border-radius: 18px;
          padding: 14px;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.07);
        }

        .control-label {
          color: #95a4c7;
          font-size: 12px;
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .segmented {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .segmented-btn {
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.03);
          color: #dfe7ff;
          border-radius: 12px;
          padding: 10px 0;
          cursor: pointer;
        }

        .segmented-btn.active {
          background: rgba(124, 92, 255, 0.18);
          border-color: rgba(124, 92, 255, 0.35);
          color: white;
        }

        .sidebar-links {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .sidebar-link {
          padding: 12px 14px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.03);
          color: #edf2ff;
          text-decoration: none;
          transition: all 0.18s ease;
        }

        .sidebar-link:hover {
          background: rgba(255, 255, 255, 0.06);
        }

        .active-link {
          background: rgba(124, 92, 255, 0.16);
          border: 1px solid rgba(124, 92, 255, 0.28);
        }

        .sidebar-section {
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex: 1;
        }

        .section-title {
          color: #cfd8f5;
          font-size: 13px;
          font-weight: 600;
          padding: 0 4px;
        }

        .conversation-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
          overflow-y: auto;
          padding-right: 2px;
        }

        .conversation-item {
          text-align: left;
          border: 1px solid rgba(255, 255, 255, 0.06);
          background: rgba(255, 255, 255, 0.03);
          border-radius: 16px;
          padding: 12px;
          color: white;
          cursor: pointer;
          transition: all 0.18s ease;
        }

        .conversation-item:hover {
          background: rgba(255, 255, 255, 0.05);
          transform: translateY(-1px);
        }

        .conversation-item.active {
          background: rgba(124, 92, 255, 0.12);
          border-color: rgba(124, 92, 255, 0.28);
          box-shadow: inset 0 0 0 1px rgba(124, 92, 255, 0.08);
        }

        .conversation-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .conversation-agent {
          font-size: 11px;
          color: #9fb1da;
          text-transform: uppercase;
          letter-spacing: 0.07em;
        }

        .conversation-title {
          font-size: 14px;
          line-height: 1.35;
          color: #f1f5ff;
        }

        .empty-sidebar {
          color: #8193b9;
          font-size: 13px;
          padding: 12px 4px;
        }

        .main {
          display: flex;
          flex-direction: column;
          min-width: 0;
          padding: 28px;
          gap: 20px;
        }

        .hero {
          max-width: 860px;
          margin: 0 auto;
          width: 100%;
        }

        .hero-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #cad5f8;
          font-size: 12px;
          margin-bottom: 14px;
        }

        .hero h1 {
          margin: 0;
          font-size: clamp(30px, 4vw, 44px);
          line-height: 1.02;
          letter-spacing: -0.04em;
        }

        .hero p {
          margin: 14px 0 0;
          color: #99a9cd;
          font-size: 16px;
          line-height: 1.7;
          max-width: 780px;
        }

        .suggestions-wrap {
          max-width: 860px;
          margin: 0 auto;
          width: 100%;
        }

        .suggestions-title {
          color: #cfd8f5;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 10px;
        }

        .suggestions-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .suggestion-card {
          text-align: left;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.04);
          color: #edf2ff;
          border-radius: 18px;
          padding: 14px 14px;
          cursor: pointer;
          line-height: 1.45;
          transition: all 0.18s ease;
          min-height: 78px;
        }

        .suggestion-card:hover {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(124, 92, 255, 0.24);
          transform: translateY(-1px);
        }

        .chat-panel {
          max-width: 860px;
          margin: 0 auto;
          width: 100%;
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          border-radius: 28px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.04);
          backdrop-filter: blur(18px);
          box-shadow:
            0 20px 60px rgba(0, 0, 0, 0.25),
            inset 0 1px 0 rgba(255, 255, 255, 0.04);
          overflow: hidden;
        }

        .messages {
          flex: 1;
          min-height: 420px;
          max-height: calc(100vh - 360px);
          overflow-y: auto;
          padding: 22px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .message-row {
          display: flex;
          animation: fadeUp 0.22s ease;
        }

        .message-row.user {
          justify-content: flex-end;
        }

        .message-row.assistant {
          justify-content: flex-start;
        }

        .bubble {
          max-width: 78%;
          padding: 14px 16px;
          border-radius: 18px;
          line-height: 1.6;
          white-space: pre-wrap;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.12);
        }

        .bubble.user {
          background: linear-gradient(135deg, #7c5cff, #4ea1ff);
          color: white;
          border-bottom-right-radius: 6px;
        }

        .bubble.assistant {
          background: rgba(255, 255, 255, 0.92);
          color: #101827;
          border-bottom-left-radius: 6px;
        }

        .bubble.typing {
          min-width: 180px;
        }

        .composer {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(7, 12, 24, 0.75);
          backdrop-filter: blur(18px);
          position: sticky;
          bottom: 0;
        }

        .ghost-btn {
          width: 48px;
          height: 48px;
          border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.04);
          color: #9fb1da;
          cursor: not-allowed;
          flex-shrink: 0;
        }

        .composer-input {
          flex: 1;
          min-width: 0;
          height: 52px;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.05);
          color: white;
          padding: 0 16px;
          outline: none;
        }

        .composer-input::placeholder {
          color: #8293ba;
        }

        .send-btn {
          height: 52px;
          border: none;
          border-radius: 16px;
          padding: 0 18px;
          background: linear-gradient(135deg, #7c5cff, #4ea1ff);
          color: white;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 12px 30px rgba(89, 90, 255, 0.24);
        }

        .send-btn:disabled {
          opacity: 0.6;
          cursor: default;
        }

        .empty-state {
          color: #97a8cf;
          padding: 24px 4px;
        }

        @keyframes fadeUp {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @media (max-width: 1100px) {
          .shell {
            grid-template-columns: 1fr;
          }

          .sidebar {
            border-right: none;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          }

          .suggestions-grid {
            grid-template-columns: 1fr;
          }

          .messages {
            max-height: none;
          }
        }

        @media (max-width: 720px) {
          .main {
            padding: 16px;
          }

          .sidebar {
            padding: 14px;
          }

          .bubble {
            max-width: 92%;
          }

          .composer {
            padding: 12px;
          }

          .hero h1 {
            font-size: 28px;
          }
        }
      `}</style>
    </>
  );
}