"use client";

import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RestaurantLanguageToggle, { useRestaurantLanguage } from "@/components/restaurant-language/RestaurantLanguageToggle";
import { restaurantCallTestConfig } from "@/lib/restaurant-call-test/config";
import { getVoiceTestStatus, startVoiceTest } from "@/lib/restaurant-call-test/voice-test-service";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { RestaurantLang } from "@/lib/restaurant-language";

type RestaurantCallResult = {
  intent: string;
  router_key: string;
  agent_called: string;
  escalated: boolean;
  outcome: string;
  final_response: string;
  raw?: unknown;
};

type LoadState =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: null; error: null }
  | { status: "success"; data: RestaurantCallResult; error: null }
  | { status: "error"; data: null; error: string };

type VoiceCallStatus = "idle" | "calling" | "in_progress" | "completed" | "failed";

const AC = "#F59E0B";
const AC_TEXT = "#FBBF24";
const AC_DIM = "rgba(245,158,11,0.10)";
const AC_BORDER = "rgba(245,158,11,0.24)";

const examples = [
  "I want to book a table for 4 tonight at 8pm.",
  "Can I change my reservation from 7pm to 8:30?",
  "Do you have vegan options and a quiet table for a birthday?",
  "Je veux réserver une table pour 2 ce soir à 20h.",
];

const copy = {
  en: {
    brandSub: "Restaurant call demo",
    backHome: "Back to homepage",
    eyebrow: "Interactive test",
    title: "Test AI Restaurant Call Assistant",
    subtitle:
      "Simulate a restaurant request and preview how the assistant detects intent, routes the conversation, selects the right agent, escalates when needed, and prepares the final guest response.",
    chips: ["Intent routing", "Booking flow", "Human handoff", "Quality preview"],
    textTestTitle: "Text scenario test",
    textTestDescription: "Simulate a real guest request and see how the assistant understands, routes, and responds.",
    callScenario: "Guest request",
    phone: "Caller phone (optional)",
    language: "Language",
    english: "English",
    french: "French",
    launchLoading: "Launching text test...",
    launch: "Run simulation",
    emptyScenario: "Please enter a call scenario before launching the test.",
    testError: "Test failed",
    webhookError: "The test service returned an error.",
    idleText: "This test shows intent detection, routing decisions, and final response.",
    resultEyebrow: "Text test result",
    resultTitle: "Routing decision complete",
    escalated: "Escalated",
    autoHandled: "Auto handled",
    resultLabels: {
      intent: "Detected intent",
      router: "Selected route",
      agent: "Assistant used",
      escalated: "Escalated",
      outcome: "Outcome",
      final: "Final response",
      raw: "Raw JSON",
    },
    yes: "Yes",
    no: "No",
    voiceTestTitle: "Voice call test",
    voiceTestDescription: "Test the assistant in real call conditions. Call the number below to interact with the AI as a real guest.",
    voiceTestStatus: restaurantCallTestConfig.voiceTestStatusLabelEN,
    voiceTestPhoneNumber: restaurantCallTestConfig.voiceTestPhoneNumber || "Test phone number will appear here",
    voiceStartCta: "Start voice test",
    voiceFutureItems: ["Call status", "Call reference", "Call summary"],
    voiceNote: "Use the text test while voice calling is being enabled.",
    voiceNoCall: "No call yet",
    voiceCompletedSummary: "The simulated guest asked for a dinner reservation. The assistant identified a booking request, kept the call in automation, and prepared a clear reservation response.",
    voiceFailedSummary: "The voice test could not be started. Please try again.",
    voiceLiveUnavailable: "Live voice calling is not available yet.",
    voicePhoneRequired: "Enter a phone number to receive the test call.",
    voiceLiveStartedSummary: "The restaurant assistant is calling the number you entered. Answer your phone to start the live test.",
    dashboardCta: "Dashboard access",
    voiceStatuses: {
      idle: "Ready",
      calling: "Calling...",
      in_progress: "In progress",
      completed: "Completed",
      failed: "Failed",
    },
  },
  fr: {
    brandSub: "Démo appel restaurant",
    backHome: "Retour à l'accueil",
    eyebrow: "Test interactif",
    title: "Tester AI Restaurant Call Assistant",
    subtitle:
      "Simule une demande restaurant et visualise comment l'assistant détecte l'intention, oriente l'échange, sélectionne le bon agent, escalade si nécessaire et prépare la réponse finale au client.",
    chips: ["Routage d'intention", "Réservation", "Escalade humaine", "Aperçu qualité"],
    textTestTitle: "Test par scénario écrit",
    textTestDescription: "Simule une demande client réelle et observe comment l'assistant comprend, oriente et répond.",
    callScenario: "Demande client",
    phone: "Numéro du client (optionnel)",
    language: "Langue",
    english: "Anglais",
    french: "Français",
    launchLoading: "Lancement du test écrit...",
    launch: "Lancer la simulation",
    emptyScenario: "Entre un scénario d'appel avant de lancer le test.",
    testError: "Test échoué",
    webhookError: "Le service de test a retourné une erreur.",
    idleText: "Ce test affiche l'intention détectée, la logique de routage et la réponse finale.",
    resultEyebrow: "Résultat du test écrit",
    resultTitle: "Décision de routage terminée",
    escalated: "Escaladé",
    autoHandled: "Géré automatiquement",
    resultLabels: {
      intent: "Intention détectée",
      router: "Route sélectionnée",
      agent: "Assistant utilisé",
      escalated: "Escalade",
      outcome: "Résultat",
      final: "Réponse finale",
      raw: "JSON brut",
    },
    yes: "Oui",
    no: "Non",
    voiceTestTitle: "Test vocal",
    voiceTestDescription: "Teste l'assistant en conditions réelles via un appel. Utilise le numéro ci-dessous pour interagir comme un client.",
    voiceTestStatus: restaurantCallTestConfig.voiceTestStatusLabelFR,
    voiceTestPhoneNumber: restaurantCallTestConfig.voiceTestPhoneNumber || "Le numéro de test apparaîtra ici",
    voiceStartCta: "Démarrer le test vocal",
    voiceFutureItems: ["Statut de l'appel", "Référence de l'appel", "Résumé de l'appel"],
    voiceNote: "Tu peux utiliser le test écrit en attendant l'activation du test vocal.",
    voiceNoCall: "Aucun appel pour le moment",
    voiceCompletedSummary: "Le client simulé a demandé une réservation pour le dîner. L'assistant a identifié une demande de réservation, gardé l'appel en automatique et préparé une réponse claire.",
    voiceFailedSummary: "Le test vocal n'a pas pu démarrer. Réessaie dans un instant.",
    voiceLiveUnavailable: "Le test vocal en direct n'est pas encore disponible.",
    voicePhoneRequired: "Entre un numéro de téléphone pour recevoir l'appel de test.",
    voiceLiveStartedSummary: "L'assistant restaurant appelle le numéro indiqué. Réponds au téléphone pour démarrer le test en direct.",
    dashboardCta: "Accès dashboard",
    voiceStatuses: {
      idle: "Prêt",
      calling: "Appel en cours...",
      in_progress: "En cours",
      completed: "Terminé",
      failed: "Échec",
    },
  },
} satisfies Record<RestaurantLang, Record<string, unknown>>;

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  background:
    "radial-gradient(ellipse 70% 45% at 20% 0%, rgba(245,158,11,0.14), transparent 65%), radial-gradient(ellipse 45% 35% at 100% 20%, rgba(180,83,9,0.12), transparent 58%), linear-gradient(180deg, #07111f 0%, #081226 100%)",
  color: "#f0f0ef",
  fontFamily: "'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
};

const containerStyle: CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "32px 24px 72px",
};

const cardStyle: CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.035)",
  borderRadius: 24,
  boxShadow: "0 28px 90px rgba(0,0,0,0.26)",
};

const labelStyle: CSSProperties = {
  display: "block",
  color: "rgba(255,255,255,0.44)",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 10,
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  marginBottom: 8,
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={labelStyle}>{children}</label>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: unknown, keys: string[], fallback = "") {
  if (!isRecord(source)) return fallback;

  for (const key of keys) {
    const value = source[key];

    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }

  return fallback;
}

function readBoolean(source: unknown, keys: string[], fallback = false) {
  if (!isRecord(source)) return fallback;

  for (const key of keys) {
    const value = source[key];

    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value === 1;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "1", "escalated"].includes(normalized)) return true;
      if (["false", "no", "0", "handled", "auto_handled"].includes(normalized)) return false;
    }
  }

  return fallback;
}

function normalizeTextTestResult(source: unknown): RestaurantCallResult {
  const data = isRecord(source) ? source.data : null;
  const escalated = readBoolean(data, ["escalated", "handoff_required"], false);

  return {
    intent: readString(data, ["intent"], "booking"),
    router_key: readString(data, ["route_selected", "router_key"], "booking"),
    agent_called: readString(data, ["agent_called"], "Restaurant Assistant"),
    escalated,
    outcome: readString(data, ["outcome"], escalated ? "Escalated to the restaurant team" : "Handled by the assistant"),
    final_response: readString(data, ["final_response"], "The assistant returned a response for this guest request."),
    raw: isRecord(data) ? data.raw : source,
  };
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function ResultCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "success" | "warning";
}) {
  const color =
    tone === "accent" ? AC_TEXT : tone === "success" ? "#34D399" : tone === "warning" ? "#F87171" : "#f0f0ef";

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(7,17,31,0.55)",
        borderRadius: 18,
        padding: 16,
        minWidth: 0,
      }}
    >
      <p
        style={{
          color: "rgba(255,255,255,0.36)",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 9,
        }}
      >
        {label}
      </p>
      <p style={{ color, fontSize: 15, fontWeight: 800, lineHeight: 1.45, overflowWrap: "anywhere" }}>
        {value}
      </p>
    </div>
  );
}

function DashboardAccessLink({ label }: { label: string }) {
  const router = useRouter();

  async function handleClick(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();

    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();

    if (!data.session) {
      router.push("/restaurant-login");
      return;
    }

    const sessionResponse = await fetch("/api/restaurant-auth/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      }),
    });

    if (!sessionResponse.ok) {
      router.push("/restaurant-login");
      return;
    }

    router.refresh();
    router.push("/restaurant-analytics/overview");
  }

  return (
    <Link
      href="/restaurant-login"
      onClick={handleClick}
      style={{
        border: "1px solid rgba(245,158,11,0.24)",
        color: "#FBBF24",
        background: "rgba(245,158,11,0.10)",
        borderRadius: 999,
        padding: "10px 15px",
        textDecoration: "none",
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      {label}
    </Link>
  );
}

export default function RestaurantCallTestPage() {
  const [message, setMessage] = useState(examples[0]);
  const [callerPhone, setCallerPhone] = useState("+33 6 12 34 56 78");
  const [language, setLanguage] = useRestaurantLanguage();
  const [state, setState] = useState<LoadState>({ status: "idle", data: null, error: null });
  const [callStatus, setCallStatus] = useState<VoiceCallStatus>("idle");
  const [callId, setCallId] = useState("");
  const [callSummary, setCallSummary] = useState("");
  const t = copy[language];

  const canSubmit = useMemo(() => message.trim().length > 0 && state.status !== "loading", [message, state.status]);
  const canEndVoiceTest = callStatus === "calling" || callStatus === "in_progress";
  const voiceBusy = canEndVoiceTest;
  const canStartVoiceTest = restaurantCallTestConfig.voiceTestMode === "mock" || restaurantCallTestConfig.voiceTestEnabled;
  const voiceDetails = [
    { label: t.voiceFutureItems[0], value: t.voiceStatuses[callStatus] },
    { label: t.voiceFutureItems[1], value: callId || t.voiceNoCall },
    { label: t.voiceFutureItems[2], value: callSummary || t.voiceNoCall },
  ];

  useEffect(() => {
    if (restaurantCallTestConfig.voiceTestMode !== "live" || !callId || !canEndVoiceTest) return;

    let stopped = false;
    let failedPolls = 0;

    async function pollCallStatus() {
      try {
        const result = await getVoiceTestStatus(callId);

        if (stopped) return;

        failedPolls = 0;

        if (result.terminal) {
          setCallStatus("idle");
          setCallSummary(result.summary || (result.status === "failed" ? t.voiceFailedSummary : t.voiceCompletedSummary));
          return;
        }

        if (result.status === "calling" || result.status === "in_progress") {
          setCallStatus(result.status);
        }
      } catch {
        if (stopped) return;

        failedPolls += 1;

        if (failedPolls >= 3) {
          setCallStatus("idle");
          setCallSummary(t.voiceFailedSummary);
        }
      }
    }

    void pollCallStatus();
    const intervalId = window.setInterval(() => {
      void pollCallStatus();
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
    };
  }, [callId, canEndVoiceTest, t.voiceCompletedSummary, t.voiceFailedSummary]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!message.trim()) {
      setState({ status: "error", data: null, error: t.emptyScenario });
      return;
    }

    setState({ status: "loading", data: null, error: null });

    try {
      const endpoint = "/api/restaurant-call-test/text";
      const requestBody = {
        message: message.trim(),
        caller_phone: callerPhone.trim(),
        language,
      };

      console.log("[restaurant-call-test:text] frontend request", {
        endpoint,
        body: requestBody,
      });

      const response = await fetch("/api/restaurant-call-test/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const payload = (await response.json()) as unknown;

      console.log("[restaurant-call-test:text] frontend response", {
        endpoint,
        status: response.status,
        ok: response.ok,
        payload,
      });

      if (!response.ok) {
        throw new Error(readString(payload, ["message", "error"], t.webhookError));
      }

      if (!isRecord(payload) || payload.success !== true) {
        throw new Error(readString(payload, ["message", "error"], t.webhookError));
      }

      setState({ status: "success", data: normalizeTextTestResult(payload), error: null });
    } catch (error) {
      console.error("[restaurant-call-test:text] frontend error", error);

      setState({
        status: "error",
        data: null,
        error: error instanceof Error ? error.message : t.webhookError,
      });
    }
  }

  async function handleVoiceTest() {
    if (restaurantCallTestConfig.voiceTestMode === "live" && !callerPhone.trim()) {
      setCallStatus("failed");
      setCallId("");
      setCallSummary(t.voicePhoneRequired);
      return;
    }

    setCallStatus("calling");
    setCallId("");
    setCallSummary("");

    try {
      console.log("[restaurant-call-test:voice] frontend action", {
        callerPhone: callerPhone.trim(),
        language,
      });

      const result = await startVoiceTest({
        callerPhone: callerPhone.trim(),
        language,
        onStatusChange: (nextStatus) => {
          setCallStatus(nextStatus);
        },
        onCallId: setCallId,
        onSummary: setCallSummary,
      });

      if (!result.success) {
        setCallStatus("failed");
        setCallId(result.callId ?? "");
        setCallSummary(t.voiceLiveUnavailable);
        return;
      }

      setCallId(result.callId ?? "");

      if (result.mode === "live") {
        setCallStatus("in_progress");
        setCallSummary(result.summary || t.voiceLiveStartedSummary);
        return;
      }

      setCallStatus("in_progress");
      await wait(2600);
      setCallStatus("completed");
      setCallSummary(result.summary || t.voiceCompletedSummary);
    } catch (error) {
      console.error("[restaurant-call-test:voice] frontend error", error);
      setCallStatus("failed");
      setCallSummary(
        error instanceof Error
          ? error.message === "missing_phone"
            ? t.voicePhoneRequired
            : error.message || t.voiceFailedSummary
          : t.voiceFailedSummary
      );
    }
  }

  return (
    <main style={pageStyle}>
      <div style={containerStyle}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            marginBottom: 52,
            flexWrap: "wrap",
          }}
        >
          <Link href="/agent/restaurant-call-assistant" style={{ display: "inline-flex", alignItems: "center", gap: 10, color: "#f0f0ef", textDecoration: "none" }}>
            <span
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: AC,
                color: "#160b02",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "'Syne', sans-serif",
                fontWeight: 900,
              }}
            >
              B
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 800 }}>BoostMyBusinesses</span>
              <span style={{ color: "rgba(255,255,255,0.42)", fontSize: 11 }}>{t.brandSub}</span>
            </span>
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <RestaurantLanguageToggle lang={language} onLangChange={setLanguage} />
            <DashboardAccessLink label={t.dashboardCta} />
            <Link
              href="/"
              style={{
                border: "1px solid rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.76)",
                borderRadius: 999,
                padding: "10px 15px",
                textDecoration: "none",
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {t.backHome}
            </Link>
          </div>
        </header>

        <section
          style={{
            marginBottom: 26,
          }}
        >
          <p
            style={{
              color: AC_TEXT,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            {t.eyebrow}
          </p>
          <h1
            style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: "clamp(2.25rem, 5vw, 4.1rem)",
              lineHeight: 1.02,
              letterSpacing: "-0.045em",
              maxWidth: 820,
              marginBottom: 18,
            }}
          >
            {t.title}
          </h1>
          <p style={{ color: "rgba(255,255,255,0.58)", fontSize: 16, lineHeight: 1.75, maxWidth: 760, marginBottom: 26 }}>
            {t.subtitle}
          </p>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {t.chips.map((item) => (
              <span
                key={item}
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.035)",
                  borderRadius: 999,
                  color: "rgba(255,255,255,0.68)",
                  padding: "8px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {item}
              </span>
            ))}
          </div>
        </section>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
            gap: 24,
            alignItems: "stretch",
          }}
        >
          <form onSubmit={handleSubmit} style={{ ...cardStyle, padding: "clamp(18px, 3vw, 26px)" }}>
            <div style={{ marginBottom: 20 }}>
              <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
                {t.textTestTitle}
              </p>
              <p style={{ color: "rgba(255,255,255,0.56)", fontSize: 14, lineHeight: 1.65 }}>
                {t.textTestDescription}
              </p>
            </div>
            <div style={{ marginBottom: 18 }}>
              <FieldLabel>{t.callScenario}</FieldLabel>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="I want to book a table for 4 tonight at 8pm"
                rows={7}
                style={{
                  width: "100%",
                  resize: "vertical",
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(7,17,31,0.72)",
                  color: "#f0f0ef",
                  borderRadius: 18,
                  padding: 16,
                  font: "inherit",
                  fontSize: 14.5,
                  lineHeight: 1.65,
                  outline: "none",
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 18 }}>
              <div>
                <FieldLabel>{t.phone}</FieldLabel>
                <input
                  value={callerPhone}
                  onChange={(event) => setCallerPhone(event.target.value)}
                  placeholder="+33 6 12 34 56 78"
                  style={{
                    width: "100%",
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(7,17,31,0.72)",
                    color: "#f0f0ef",
                    borderRadius: 14,
                    padding: "13px 14px",
                    font: "inherit",
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <FieldLabel>{t.language}</FieldLabel>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as RestaurantLang)}
                  style={{
                    width: "100%",
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(7,17,31,0.72)",
                    color: "#f0f0ef",
                    borderRadius: 14,
                    padding: "13px 14px",
                    font: "inherit",
                    outline: "none",
                  }}
                >
                  <option value="en">{t.english}</option>
                  <option value="fr">{t.french}</option>
                </select>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
              {examples.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setMessage(example)}
                  style={{
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.035)",
                    color: "rgba(255,255,255,0.64)",
                    borderRadius: 999,
                    padding: "7px 11px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {example.length > 42 ? `${example.slice(0, 42)}...` : example}
                </button>
              ))}
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                width: "100%",
                minHeight: 52,
                border: `1px solid ${AC_BORDER}`,
                background: canSubmit ? AC : "rgba(255,255,255,0.08)",
                color: canSubmit ? "#160b02" : "rgba(255,255,255,0.42)",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 900,
                cursor: canSubmit ? "pointer" : "not-allowed",
                boxShadow: canSubmit ? "0 8px 32px rgba(245,158,11,0.28)" : "none",
              }}
            >
              {state.status === "loading" ? t.launchLoading : t.launch}
            </button>
          </form>

          <section style={{ ...cardStyle, padding: "clamp(18px, 3vw, 26px)", minHeight: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, marginBottom: 20 }}>
              <div>
                <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
                  {t.voiceTestTitle}
                </p>
                <p style={{ color: "rgba(255,255,255,0.56)", fontSize: 14, lineHeight: 1.65 }}>
                  {t.voiceTestDescription}
                </p>
              </div>
              <span
                style={{
                  flexShrink: 0,
                  border: callStatus === "failed" ? "1px solid rgba(248,113,113,0.34)" : `1px solid ${AC_BORDER}`,
                  background: callStatus === "failed" ? "rgba(248,113,113,0.10)" : AC_DIM,
                  color: callStatus === "failed" ? "#FCA5A5" : AC_TEXT,
                  borderRadius: 999,
                  padding: "8px 11px",
                  fontSize: 11,
                  fontWeight: 900,
                  whiteSpace: "nowrap",
                }}
              >
                {t.voiceStatuses[callStatus]}
              </span>
            </div>

            <div style={{ border: `1px solid ${AC_BORDER}`, background: "rgba(245,158,11,0.075)", borderRadius: 20, padding: 18, marginBottom: 14 }}>
              <p style={{ color: "rgba(255,255,255,0.40)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                {t.voiceTestStatus}
              </p>
              <p style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.3rem, 3vw, 2rem)", fontWeight: 800, letterSpacing: "-0.03em", marginBottom: 14 }}>
                {t.voiceTestPhoneNumber}
              </p>
              <button
                type="button"
                disabled={voiceBusy || !canStartVoiceTest}
                onClick={handleVoiceTest}
                style={{
                  minHeight: 46,
                  border: `1px solid ${AC_BORDER}`,
                  background: voiceBusy || !canStartVoiceTest ? "rgba(255,255,255,0.08)" : AC,
                  color: voiceBusy || !canStartVoiceTest ? "rgba(255,255,255,0.42)" : "#160b02",
                  borderRadius: 999,
                  padding: "0 20px",
                  fontSize: 13,
                  fontWeight: 900,
                  cursor: voiceBusy || !canStartVoiceTest ? "not-allowed" : "pointer",
                  boxShadow: voiceBusy || !canStartVoiceTest ? "none" : "0 8px 30px rgba(245,158,11,0.25)",
                }}
              >
                {t.voiceStartCta}
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
              {voiceDetails.map((item) => (
                <div key={item.label} style={{ border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", borderRadius: 14, padding: 12, minHeight: 78 }}>
                  <p style={{ color: "rgba(255,255,255,0.38)", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", lineHeight: 1.35 }}>
                    {item.label}
                  </p>
                  <p style={{ color: item.value === t.voiceNoCall ? "rgba(255,255,255,0.46)" : "#f0f0ef", fontSize: 13, fontWeight: 800, lineHeight: 1.45, marginTop: 12, overflowWrap: "anywhere" }}>
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            <p style={{ color: "rgba(255,255,255,0.46)", fontSize: 13, lineHeight: 1.65, marginTop: "auto" }}>
              {t.voiceNote}
            </p>
          </section>
        </section>

        <section style={{ marginTop: 26 }}>
          {state.status === "idle" && (
            <div style={{ ...cardStyle, padding: 24, textAlign: "center" }}>
              <p style={{ color: "rgba(255,255,255,0.46)", fontSize: 14, lineHeight: 1.7 }}>
                {t.idleText}
              </p>
            </div>
          )}

          {state.status === "loading" && (
            <div style={{ ...cardStyle, padding: 24 }}>
              <div style={{ height: 10, width: 180, borderRadius: 999, background: AC_DIM, marginBottom: 16 }} />
              <div style={{ height: 12, width: "75%", borderRadius: 999, background: "rgba(255,255,255,0.08)", marginBottom: 10 }} />
              <div style={{ height: 12, width: "58%", borderRadius: 999, background: "rgba(255,255,255,0.06)" }} />
            </div>
          )}

          {state.status === "error" && (
            <div style={{ ...cardStyle, border: "1px solid rgba(248,113,113,0.32)", background: "rgba(248,113,113,0.08)", padding: 22 }}>
              <p style={{ color: "#FCA5A5", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                {t.testError}
              </p>
              <p style={{ color: "rgba(255,255,255,0.74)", fontSize: 14, lineHeight: 1.65 }}>{state.error}</p>
            </div>
          )}

          {state.status === "success" && (
            <div style={{ ...cardStyle, padding: "clamp(18px, 3vw, 26px)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 18, marginBottom: 18, flexWrap: "wrap" }}>
                <div>
                  <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 }}>
                    {t.resultEyebrow}
                  </p>
                  <h2 style={{ color: "#f0f0ef", fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.45rem, 3vw, 2.2rem)", letterSpacing: "-0.03em" }}>
                    {t.resultTitle}
                  </h2>
                </div>

                <span
                  style={{
                    border: state.data.escalated ? "1px solid rgba(248,113,113,0.36)" : `1px solid ${AC_BORDER}`,
                    background: state.data.escalated ? "rgba(248,113,113,0.10)" : AC_DIM,
                    color: state.data.escalated ? "#FCA5A5" : AC_TEXT,
                    borderRadius: 999,
                    padding: "9px 13px",
                    fontSize: 12,
                    fontWeight: 900,
                  }}
                >
                  {state.data.escalated ? t.escalated : t.autoHandled}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 14 }}>
                <ResultCard label={t.resultLabels.intent} value={state.data.intent} tone="accent" />
                <ResultCard label={t.resultLabels.router} value={state.data.router_key} />
                <ResultCard label={t.resultLabels.agent} value={state.data.agent_called} />
                <ResultCard label={t.resultLabels.escalated} value={state.data.escalated ? t.yes : t.no} tone={state.data.escalated ? "warning" : "success"} />
                <ResultCard label={t.resultLabels.outcome} value={state.data.outcome} tone="accent" />
              </div>

              <div style={{ border: `1px solid ${AC_BORDER}`, background: "rgba(245,158,11,0.075)", borderRadius: 18, padding: 18, marginBottom: state.data.raw ? 14 : 0 }}>
                <p style={{ color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                  {t.resultLabels.final}
                </p>
                <p style={{ color: "rgba(255,255,255,0.78)", fontSize: 14.5, lineHeight: 1.75 }}>{state.data.final_response}</p>
              </div>

              {state.data.raw !== undefined && (
                <details style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(7,17,31,0.58)", borderRadius: 16, padding: 16 }}>
                  <summary style={{ color: "rgba(255,255,255,0.72)", cursor: "pointer", fontSize: 13, fontWeight: 800 }}>
                    {t.resultLabels.raw}
                  </summary>
                  <pre style={{ color: "rgba(255,255,255,0.62)", fontSize: 12, lineHeight: 1.6, overflowX: "auto", marginTop: 14 }}>
                    {JSON.stringify(state.data.raw, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
