"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import NavbarFooter from "../../components/NavbarFooter";

type Lang = "fr" | "en";
type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  content?: string;
  createdAt: number;
  imagePreview?: string | null;
  previewImageUrl?: string | null;
  storagePath?: string | null;
  fileName?: string | null;
  previewCreatedAt?: string | null;
  actionType?: "preview_actions" | "video_completed" | null;
  approveUrl?: string | null;
  modifyUrl?: string | null;
  videoUrl?: string | null;
  title?: string | null;
  description?: string | null;
  hashtags?: string[] | null;
};

const LANG_KEY = "ugc_ads_engine_lang_v1";
const STORAGE_KEY = "ugc_ads_engine_messages_v1";

// ── Accent colors (UGC identity) ───────────────────────────
const AC = "#F97316";
const AC_DIM = "rgba(249,115,22,0.10)";
const AC_BORDER = "rgba(249,115,22,0.22)";
const AC_TEXT = "#fb923c";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function buildPreviewSrc(data: any): string | null {
  if (!data || typeof data !== "object") return null;
  if (typeof data.preview_image_url === "string" && data.preview_image_url.trim()) return data.preview_image_url;
  if (typeof data.image_url === "string" && data.image_url.trim()) return data.image_url;
  if (typeof data.preview_image_base64 === "string" && data.preview_image_base64.trim()) {
    const cleaned = String(data.preview_image_base64).replace(/^data:[^;]+;base64,/, "");
    const mime = data.preview_mime_type || "image/png";
    return `data:${mime};base64,${cleaned}`;
  }
  return null;
}

function sanitizeMessagesForStorage(messages: Message[]): Message[] {
  return messages.map((msg) => {
    const isBase64Preview = typeof msg.previewImageUrl === "string" && msg.previewImageUrl.startsWith("data:image/");
    const isBase64Upload = typeof msg.imagePreview === "string" && msg.imagePreview.startsWith("data:image/");
    return {
      ...msg,
      previewImageUrl: isBase64Preview ? null : msg.previewImageUrl ?? null,
      imagePreview: isBase64Upload ? null : msg.imagePreview ?? null,
    };
  });
}

const copy = {
  fr: {
    badge: "UGC Ads Engine",
    heroTitle: "Transforme une simple image en vidéo UGC prête à convertir.",
    heroSubtitle: "Ce système automatise la création de vidéos marketing de bout en bout : script, structure hook + narration + CTA, direction vidéo, contrôle qualité et génération finale.",
    primaryCta: "Voir la démo visuelle",
    secondaryCta: "Retour à l'accueil",
    stats: [
      { label: "Input", value: "1 image ou idée" },
      { label: "Output", value: "Vidéo UGC structurée" },
      { label: "Logique", value: "Script • QC • Fallback" },
    ],
    productBoxTitle: "Ce que fait le système",
    productSteps: [
      { label: "Input utilisateur", text: "Une simple image ou une idée de contenu est envoyée au système." },
      { label: "Orchestration IA", text: "Le moteur construit le script, la structure marketing et la direction vidéo." },
      { label: "Production vidéo", text: "La vidéo est générée selon une logique standardisée et cohérente." },
      { label: "Contrôle qualité", text: "Le système vérifie le résultat et applique fallback / retry si nécessaire." },
    ],
    problemTitle: "Le vrai problème",
    problemText: "Les outils comme ChatGPT, Kling, Runway ou d'autres générateurs sont puissants, mais ils laissent encore l'utilisateur gérer trop de friction manuelle.",
    problems: ["Tu ne sais pas écrire de bons prompts", "Tu perds du temps à tester plusieurs versions", "Les résultats sont irréguliers", "La structure marketing est souvent absente", "Le contenu généré ne convertit pas toujours", "Tu dois jongler entre plusieurs outils"],
    solutionTitle: "La solution",
    solutionText: "Ici, la valeur n'est pas juste la génération vidéo. C'est le système complet qui transforme une idée en contenu marketing prêt à publier.",
    solutions: ["Génération automatique du script", "Structure marketing intégrée : hook, narration, CTA", "Direction vidéo automatisée", "Contrôle qualité intégré", "Retry et fallback automatiques", "Production plus rapide et plus scalable"],
    demoTitle: "Démo visuelle",
    demoText: "Clique sur une capture pour l'ouvrir en grand et mieux visualiser la logique du moteur, les étapes de validation et le rendu du système.",
    workflowTitle: "Comment le moteur fonctionne",
    workflowText: "L'utilisateur voit une expérience simple. En arrière-plan, le système orchestre plusieurs couches pour sortir une vidéo UGC propre et cohérente.",
    flowSteps: ["L'utilisateur envoie une image ou une idée", "Le système génère le script marketing", "Une preview / structure est préparée", "La direction vidéo est construite", "La génération est lancée", "Le QC vérifie le résultat", "Un fallback ou retry peut se déclencher si besoin", "Le rendu final est prêt à publier"],
    differenceTitle: "Pourquoi c'est différent",
    differenceText: "Les outils donnent des capacités. Ce produit donne un vrai système prêt à produire du contenu marketing avec moins de friction.",
    differences: ["Pas besoin d'expertise en prompting", "Pas de tool switching", "Workflow automatisé de bout en bout", "Sortie plus standardisée", "Production scalable", "Pensé pour la conversion, pas juste la génération"],
    targetTitle: "Pour qui",
    targetText: "Le système s'adresse aux profils qui ont besoin de produire du contenu publicitaire ou UGC rapidement, de manière répétable et exploitable.",
    targets: {
      "E-commerce": ["Tests créatifs ads", "UGC produit", "Variantes publicitaires"],
      "Agences marketing": ["Production client plus rapide", "Création standardisée", "Plus de volume sans chaos"],
      "Créateurs & solo business": ["Contenu plus pro", "Moins de friction technique", "Meilleure vitesse d'exécution"],
    },
    futureTitle: "Extensions futures",
    futureText: "Le système peut ensuite être enrichi pour aller encore plus loin en production.",
    futureItems: ["Templates de hooks et styles", "Batch generation", "A/B testing de variantes", "Génération multi-versions"],
    chatEyebrow: "Tester le moteur",
    chatTitle: "Parle directement au bot UGC",
    chatText: "Écris une demande comme dans un vrai produit SaaS. Le bot envoie ta requête au workflow UGC et te renvoie une réponse directement dans la page.",
    welcome: "Bienvenue sur UGC Ads Engine. Décris la vidéo UGC ou l'idée publicitaire que tu veux créer.",
    placeholder: "Décris la vidéo UGC que tu veux créer...",
    send: "Envoyer",
    thinking: "Le bot UGC réfléchit...",
    error: "Erreur de connexion avec le workflow UGC. Vérifie le webhook n8n ou la réponse du flow.",
    suggestionsTitle: "Suggestions rapides",
    prompts: ["Crée une idée de vidéo UGC pour une crème visage avec un hook fort", "Donne-moi un script UGC court pour un produit e-commerce", "Propose 3 angles créatifs pour une pub TikTok UGC"],
    demoCardTitle: "Espace de test premium",
    demoCardText: "Ce module te permet de tester l'expérience directement depuis la page produit, sans sortir du site.",
    uploadHint: "Clique sur + ou colle une image ici",
    imageReady: "Image prête à être envoyée",
    removeImage: "Retirer l'image",
    backHome: "Retour à l'accueil",
    previewLabel: "Preview générée",
    previewMetaFallback: "Preview disponible",
    previewIntro: "Voici ton premier visuel 👆",
    previewChoices: "Tu peux :",
    approveLabel: "Approuver → on lance la vidéo 🎬",
    modifyLabel: "Demander une modification ✏️",
    previewQuestion: "Que veux-tu faire avec cette image ?",
    approveButton: "Approuver et lancer la génération vidéo",
    modifyButton: "Demander une modification",
  },
  en: {
    badge: "UGC Ads Engine",
    heroTitle: "Turn a simple image into a high-converting UGC video.",
    heroSubtitle: "This system automates end-to-end video creation: script, hook + narrative + CTA structure, video direction, quality control, and final generation.",
    primaryCta: "Open visual demo",
    secondaryCta: "Back to homepage",
    stats: [
      { label: "Input", value: "1 image or idea" },
      { label: "Output", value: "Structured UGC video" },
      { label: "Logic", value: "Script • QC • Fallback" },
    ],
    productBoxTitle: "What the system does",
    productSteps: [
      { label: "User input", text: "A simple image or content idea is sent into the system." },
      { label: "AI orchestration", text: "The engine builds the script, the marketing structure, and the video direction." },
      { label: "Video production", text: "The video is generated through a standardized, more reliable workflow." },
      { label: "Quality control", text: "The system checks the output and can trigger fallback / retry logic if needed." },
    ],
    problemTitle: "The real problem",
    problemText: "Tools like ChatGPT, Kling, Runway, and similar generators are powerful, but they still leave too much manual friction to the user.",
    problems: ["You don't know how to write good prompts", "You waste time iterating", "Results are inconsistent", "Marketing structure is often missing", "Generated content does not always convert", "You keep switching between tools"],
    solutionTitle: "The solution",
    solutionText: "The value is not just video generation. It is the full system that turns an idea into ready-to-publish marketing content.",
    solutions: ["Automatic script generation", "Built-in marketing structure: hook, narrative, CTA", "Automated video direction", "Built-in quality control", "Automatic retry and fallback logic", "Faster, more scalable production"],
    demoTitle: "Visual demo",
    demoText: "Click any screenshot to open it larger and inspect the engine logic, validation flow, and how the system is structured.",
    workflowTitle: "How the engine works",
    workflowText: "The user sees a simple experience. Under the hood, the system orchestrates multiple layers to produce a clean, structured UGC video.",
    flowSteps: ["The user sends an image or idea", "The system generates the marketing script", "A preview / structure is prepared", "The video direction is built", "Generation is launched", "QC checks the output", "Fallback or retry can trigger if needed", "Final output is ready to publish"],
    differenceTitle: "Why it's different",
    differenceText: "Tools provide capabilities. This product provides a system ready to produce marketing content with less friction.",
    differences: ["No prompting expertise needed", "No switching between tools", "End-to-end automated workflow", "More standardized output", "Scalable production", "Built for conversion, not just generation"],
    targetTitle: "Who it's for",
    targetText: "This system is built for people and teams that need faster, repeatable, usable UGC or ad content production.",
    targets: {
      "E-commerce": ["Creative testing", "Product UGC ads", "Ad variants"],
      "Marketing agencies": ["Faster client production", "More standardized output", "Higher volume without chaos"],
      "Creators & solo businesses": ["More professional content", "Less technical friction", "Better execution speed"],
    },
    futureTitle: "Future expansion",
    futureText: "The system can later be extended to go even further in production workflows.",
    futureItems: ["Hook and style templates", "Batch generation", "A/B testing variants", "Multi-version generation"],
    chatEyebrow: "Try the engine",
    chatTitle: "Talk directly to the UGC bot",
    chatText: "Write a request like in a real SaaS product. The bot sends your prompt to the UGC workflow and returns the reply directly in the page.",
    welcome: "Welcome to UGC Ads Engine. Describe the UGC video or ad concept you want to create.",
    placeholder: "Describe the UGC video you want to create...",
    send: "Send",
    thinking: "The UGC bot is thinking...",
    error: "Connection error with the UGC workflow. Check the n8n webhook or the workflow response.",
    suggestionsTitle: "Quick suggestions",
    prompts: ["Create a UGC video idea for a skincare cream with a strong hook", "Write a short UGC script for an e-commerce product", "Give me 3 creative angles for a TikTok UGC ad"],
    demoCardTitle: "Premium testing area",
    demoCardText: "This module lets you test the product experience directly inside the page without leaving the site.",
    uploadHint: "Click + or paste an image here",
    imageReady: "Image ready to send",
    removeImage: "Remove image",
    backHome: "Back to homepage",
    previewLabel: "Preview generated",
    previewMetaFallback: "Preview available",
    previewIntro: "Here is your first visual 👆",
    previewChoices: "You can:",
    approveLabel: "Approve → we make the video 🎬",
    modifyLabel: "Request a modification ✏️",
    previewQuestion: "What would you like to do with this image?",
    approveButton: "Approve and move to video generation",
    modifyButton: "Request a modification",
  },
};

// ── Preserved SectionTitle (eyebrow now uses AC_TEXT) ───────
function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: AC_TEXT, opacity: 0.75, marginBottom: 8 }}>
        {eyebrow}
      </p>
      <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.4rem, 2.5vw, 2rem)", fontWeight: 700, letterSpacing: "-0.025em", color: "#f0f0ef", lineHeight: 1.15, marginBottom: text ? 12 : 0 }}>
        {title}
      </h2>
      {text && <p style={{ fontSize: 15, color: "rgba(255,255,255,0.52)", lineHeight: 1.7 }}>{text}</p>}
    </div>
  );
}

function normalizeMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const msg = item as Partial<Message>;
    return {
      id: typeof msg.id === "string" ? msg.id : uid(),
      role: msg.role === "user" ? "user" : "assistant",
      content: typeof msg.content === "string" ? msg.content : undefined,
      createdAt: typeof msg.createdAt === "number" ? msg.createdAt : Date.now(),
      imagePreview: typeof msg.imagePreview === "string" || msg.imagePreview === null ? msg.imagePreview : null,
      previewImageUrl: typeof msg.previewImageUrl === "string" || msg.previewImageUrl === null ? msg.previewImageUrl : null,
      storagePath: typeof msg.storagePath === "string" || msg.storagePath === null ? msg.storagePath : null,
      fileName: typeof msg.fileName === "string" || msg.fileName === null ? msg.fileName : null,
      previewCreatedAt: typeof msg.previewCreatedAt === "string" || msg.previewCreatedAt === null ? msg.previewCreatedAt : null,
      actionType: msg.actionType === "preview_actions" || msg.actionType === "video_completed" ? msg.actionType : null,
      approveUrl: typeof msg.approveUrl === "string" || msg.approveUrl === null ? msg.approveUrl : null,
      modifyUrl: typeof msg.modifyUrl === "string" || msg.modifyUrl === null ? msg.modifyUrl : null,
      videoUrl: typeof msg.videoUrl === "string" || msg.videoUrl === null ? msg.videoUrl : null,
      title: typeof msg.title === "string" || msg.title === null ? msg.title : null,
      description: typeof msg.description === "string" || msg.description === null ? msg.description : null,
      hashtags: Array.isArray(msg.hashtags) ? msg.hashtags : null,
    };
  });
}

const cardBase: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 20,
  padding: "20px 18px",
  transition: "border-color 200ms, transform 200ms",
};

export default function UGCAdsEnginePage() {
  const [lang, setLang] = useState<Lang>("en");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [typingPhase, setTypingPhase] = useState(0);
  const [selectedImage, setSelectedImage] = useState<null | { src: string; alt: string }>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pollingRef = useRef<number | null>(null);
  const pollingJobsRef = useRef<Set<string>>(new Set());
  const videoPollingRef = useRef<number | null>(null);
  const videoPollingJobsRef = useRef<Set<string>>(new Set());
  const webhookUrl = "/api/ugc-start";
  const t = copy[lang];

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const savedLang = localStorage.getItem(LANG_KEY) as Lang | null;
    if (savedLang === "fr" || savedLang === "en") setLang(savedLang);
    const rawMessages = localStorage.getItem(STORAGE_KEY);
    if (rawMessages) {
      try {
        const parsed = JSON.parse(rawMessages);
        const normalized = normalizeMessages(parsed);
        if (normalized.length) { setMessages(normalized); return; }
      } catch {}
    }
    setMessages([{ id: uid(), role: "assistant", content: copy[savedLang === "fr" ? "fr" : "en"].welcome, createdAt: Date.now() }]);
  }, []);

  useEffect(() => { if (!mounted) return; localStorage.setItem(LANG_KEY, lang); }, [lang, mounted]);

  useEffect(() => {
    if (!mounted || !messages.length) return;
    try {
      const safeMessages = sanitizeMessagesForStorage(messages);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safeMessages));
    } catch (error) { console.error("Failed to save messages to localStorage:", error); }
  }, [messages, mounted]);

  useEffect(() => { if (!mounted) return; bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, mounted]);

  useEffect(() => {
    if (!mounted || !loading) return;
    const id = window.setInterval(() => { setTypingPhase((prev) => (prev + 1) % 4); }, 350);
    return () => window.clearInterval(id);
  }, [loading, mounted]);

  // ── Preserved: full postMessage + polling logic ─────────
  useEffect(() => {
    function handlePostMessage(event: MessageEvent) {
      if (event.data?.type !== "ugc_modify_submitted") return;
      const feedbackPrompt: string = event.data.feedback_prompt ?? "";
      const feedbackIntent: string = event.data.feedback_intent ?? "";
      const jobId: string = event.data.job_id ?? "";
      if (jobId) {
        const activeSet = feedbackIntent === "VIDEO" ? videoPollingJobsRef.current : pollingJobsRef.current;
        if (activeSet.has(jobId)) return;
      }
      const content = lang === "fr"
        ? `✏️ Modification reçue : "${feedbackPrompt}". Le système régénère votre visuel...`
        : `✏️ Modification received: "${feedbackPrompt}". The system is regenerating your visual...`;
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", content, createdAt: Date.now() }]);
      if (!jobId) return;

      if (feedbackIntent === "VIDEO") {
        if (videoPollingRef.current) window.clearInterval(videoPollingRef.current);
        videoPollingJobsRef.current.add(jobId);
        let attempts = 0;
        const MAX_ATTEMPTS = 40;
        let metaWaitAttempts = 0;
        const MAX_META_WAIT = 3;
        videoPollingRef.current = window.setInterval(async () => {
          attempts += 1;
          try {
            const res = await fetch(`/api/ugc-status?job_id=${encodeURIComponent(jobId)}`);
            const data = await res.json();
            const isStatusDone = data.status === "video_completed" || (data.status === "completed" && data.current_step === "video_completed");
            if (isStatusDone && !!data.video_url) {
              const hasAllMeta = !!data.title && !!data.hashtags;
              if (!hasAllMeta && metaWaitAttempts < MAX_META_WAIT) { metaWaitAttempts += 1; return; }
              window.clearInterval(videoPollingRef.current!);
              videoPollingRef.current = null;
              videoPollingJobsRef.current.delete(jobId);
              setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: lang === "fr" ? "🎬 Ta vidéo est prête !" : "🎬 Your video is ready!", createdAt: Date.now(), actionType: "video_completed", videoUrl: data.video_url, title: data.title ?? null, description: data.description ?? null, hashtags: data.hashtags ?? null }]);
              return;
            }
          } catch {
            window.clearInterval(videoPollingRef.current!);
            videoPollingRef.current = null;
            videoPollingJobsRef.current.delete(jobId);
            setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: lang === "fr" ? "Erreur lors de la vérification de la vidéo. Veuillez réessayer." : "Error checking video status. Please try again.", createdAt: Date.now() }]);
            return;
          }
          if (attempts >= MAX_ATTEMPTS) {
            window.clearInterval(videoPollingRef.current!);
            videoPollingRef.current = null;
            videoPollingJobsRef.current.delete(jobId);
            setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: lang === "fr" ? "La vidéo n'a pas été prête dans le délai imparti. Veuillez réessayer." : "The video was not ready in time. Please try again.", createdAt: Date.now() }]);
          }
        }, 15000);
      } else {
        if (pollingJobsRef.current.has(jobId)) return;
        if (pollingRef.current) window.clearInterval(pollingRef.current);
        pollingJobsRef.current.add(jobId);
        let attempts = 0;
        const MAX_ATTEMPTS = 20;
        pollingRef.current = window.setInterval(async () => {
          attempts += 1;
          try {
            const res = await fetch(`/api/ugc-status?job_id=${encodeURIComponent(jobId)}`);
            const data = await res.json();
            const previewSrc = buildPreviewSrc(data);
            if (data.status === "preview_ready" && previewSrc) {
              window.clearInterval(pollingRef.current!);
              pollingRef.current = null;
              pollingJobsRef.current.delete(jobId);
              setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: data.reply || data.message || data.text || copy[lang].previewLabel, createdAt: Date.now(), previewImageUrl: previewSrc, storagePath: data.storage_path ?? null, fileName: data.file_name ?? null, previewCreatedAt: data.preview_created_at ?? data.created_at ?? new Date().toISOString(), actionType: "preview_actions", approveUrl: data.approve_url ?? null, modifyUrl: data.modify_url ?? null }]);
              return;
            }
          } catch {
            window.clearInterval(pollingRef.current!);
            pollingRef.current = null;
            pollingJobsRef.current.delete(jobId);
            setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: lang === "fr" ? "Erreur lors de la vérification du statut. Veuillez réessayer." : "Error checking the generation status. Please try again.", createdAt: Date.now() }]);
            return;
          }
          if (attempts >= MAX_ATTEMPTS) {
            window.clearInterval(pollingRef.current!);
            pollingRef.current = null;
            pollingJobsRef.current.delete(jobId);
            setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: lang === "fr" ? "Le visuel n'a pas été prêt dans le délai imparti. Veuillez réessayer." : "The visual was not ready in time. Please try again.", createdAt: Date.now() }]);
          }
        }, 3000);
      }
    }
    window.addEventListener("message", handlePostMessage);
    return () => {
      window.removeEventListener("message", handlePostMessage);
      if (pollingRef.current) { window.clearInterval(pollingRef.current); pollingRef.current = null; }
      if (videoPollingRef.current) { window.clearInterval(videoPollingRef.current); videoPollingRef.current = null; }
    };
  }, [lang]);

  // ── Preserved: demoImages with useMemo ──────────────────
  const demoImages = useMemo(() => [
    { src: "/demo/ugc-1.png", alt: lang === "fr" ? "Capture démo UGC 1" : "UGC demo screenshot 1", title: "Workflow view", desc: lang === "fr" ? "Vue d'ensemble du flow : input, script, validation, génération et QC." : "Overview of the flow: input, script, validation, generation, and QC." },
    { src: "/demo/ugc-2.png", alt: lang === "fr" ? "Capture démo UGC 2" : "UGC demo screenshot 2", title: "Validation layer", desc: lang === "fr" ? "Exemple de logique de validation et de contrôle qualité." : "Example of validation and quality control logic." },
    { src: "/demo/ugc-3.png", alt: lang === "fr" ? "Capture démo UGC 3" : "UGC demo screenshot 3", title: "Output preview", desc: lang === "fr" ? "Aperçu du résultat final ou d'une étape importante du rendu." : "Preview of the final output or an important rendering step." },
  ], [lang]);

  function usePrompt(prompt: string) { setInput(prompt); }
  function typingDots() { return ".".repeat(typingPhase === 0 ? 1 : typingPhase); }

  async function applyFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const base64 = await fileToBase64(file);
    setImageBase64(base64);
    setImagePreview(base64);
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await applyFile(file);
    e.target.value = "";
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { e.preventDefault(); await applyFile(file); return; }
      }
    }
  }

  function clearImage() { setImagePreview(null); setImageBase64(null); }

  function extractTextReply(data: any): string | undefined {
    return data?.output || data?.response || data?.message || data?.reply || data?.text || data?.body || data?.result || data?.data?.reply || data?.data?.message || data?.data?.text || undefined;
  }

  function openN8nAction(url?: string | null) {
    if (!url || typeof window === "undefined") return;
    const redirectUrl = `${window.location.origin}/agent/ugc-ads-engine`;
    let finalUrl = url;
    try {
      const parsedUrl = new URL(url, window.location.origin);
      parsedUrl.searchParams.set("redirect_url", redirectUrl);
      finalUrl = parsedUrl.toString();
    } catch {
      const separator = url.includes("?") ? "&" : "?";
      finalUrl = `${url}${separator}redirect_url=${encodeURIComponent(redirectUrl)}`;
    }
    const popup = window.open(finalUrl, "ugcFeedbackPopup", "width=700,height=900,resizable=yes,scrollbars=yes");
    if (!popup) window.location.href = finalUrl;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if ((!input.trim() && !imageBase64) || loading) return;
    const messageText = input.trim();
    const nextMessages: Message[] = [...messages, { id: uid(), role: "user", content: messageText || (lang === "fr" ? "Image envoyée" : "Image sent"), createdAt: Date.now(), imagePreview }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: messageText, user_id: "web-user", chat_id: "web-chat", language: lang, source: "ugc-ads-engine-page", imageBase64 }) });
      const rawText = await res.text();
      if (!res.ok) throw new Error(`Webhook HTTP ${res.status}: ${rawText || "Empty response"}`);
      let data: any = {};
      try { data = rawText ? JSON.parse(rawText) : {}; } catch { data = rawText; }
      const previewSrc = buildPreviewSrc(data);
      const isPreviewReady = typeof data === "object" && data !== null && data.status === "preview_ready" && !!previewSrc && !!data.approve_url && !!data.modify_url;
      let assistantMessage: Message;
      if (isPreviewReady) {
        assistantMessage = { id: uid(), role: "assistant", content: data.reply || data.message || data.text || t.previewLabel, createdAt: Date.now(), previewImageUrl: previewSrc, storagePath: data.storage_path ?? null, fileName: data.file_name ?? null, previewCreatedAt: data.preview_created_at ?? data.created_at ?? new Date().toISOString(), actionType: "preview_actions", approveUrl: data.approve_url ?? null, modifyUrl: data.modify_url ?? null };
      } else {
        const reply = extractTextReply(data) || (typeof data === "string" ? data : "The workflow returned a response, but no readable message was found.");
        assistantMessage = { id: uid(), role: "assistant", content: String(reply), createdAt: Date.now() };
      }
      setMessages([...nextMessages, assistantMessage]);
      clearImage();
    } catch (err) {
      const fallbackMessage = err instanceof Error ? `${t.error}\n\n${err.message}` : t.error;
      setMessages([...nextMessages, { id: uid(), role: "assistant", content: fallbackMessage, createdAt: Date.now() }]);
    } finally { setLoading(false); }
  }

  // ── Preserved: mounted guard ────────────────────────────
  if (!mounted) return null;

  const section: React.CSSProperties = { padding: "64px 0" };
  const container: React.CSSProperties = { maxWidth: 1100, margin: "0 auto", padding: "0 24px" };
  const divider: React.CSSProperties = { border: "none", borderTop: "1px solid rgba(255,255,255,0.06)", margin: 0 };

  return (
    <NavbarFooter agent="ugc" lang={lang} onLangChange={setLang}>
      <main style={{ background: "#07111f", color: "#f0f0ef" }}>

        {/* ── HERO ────────────────────────────────────── */}
        <section style={{ position: "relative", overflow: "hidden", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 60% 60% at 0% 50%, rgba(249,115,22,0.09) 0%, transparent 60%), radial-gradient(ellipse 40% 50% at 100% 20%, rgba(249,115,22,0.05) 0%, transparent 55%)", pointerEvents: "none" }} />
          <div style={{ ...container, paddingTop: 64, paddingBottom: 72, position: "relative" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: 48, alignItems: "center" }}>
              <div>
                {/* Badge */}
                <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 13px 5px 8px", background: AC_DIM, border: `1px solid ${AC_BORDER}`, borderRadius: 999, fontSize: 11, fontWeight: 500, color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.06em", marginBottom: 22 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: AC, boxShadow: `0 0 10px ${AC}`, flexShrink: 0 }} />
                  {t.badge}
                </div>
                <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.8rem, 3.5vw, 3rem)", fontWeight: 800, lineHeight: 1.07, letterSpacing: "-0.03em", color: "#f0f0ef", marginBottom: 18 }}>{t.heroTitle}</h1>
                <p style={{ fontSize: 16, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, marginBottom: 28, maxWidth: 520 }}>{t.heroSubtitle}</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 32 }}>
                  <a href="#demo" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "13px 26px", background: AC, color: "#000", fontSize: 14, fontWeight: 700, borderRadius: 999, textDecoration: "none", boxShadow: `0 4px 24px rgba(249,115,22,0.30)`, transition: "opacity 150ms, transform 150ms" }}>{t.primaryCta}</a>
                  <Link href="/" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "12px 22px", background: "transparent", color: "rgba(255,255,255,0.80)", fontSize: 14, fontWeight: 500, borderRadius: 999, textDecoration: "none", border: "1px solid rgba(255,255,255,0.14)", transition: "border-color 150ms, background 150ms" }}>{t.secondaryCta}</Link>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                  {t.stats.map((stat) => (
                    <div key={stat.label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "12px 14px", transition: "border-color 200ms" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; }}>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{stat.label}</p>
                      <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: AC }}>{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              {/* Demo panel right */}
              <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, padding: 16 }}>
                <div style={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 16 }}>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14 }}>{t.productBoxTitle}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {t.productSteps.map((step, i) => {
                      const isLast = i === t.productSteps.length - 1;
                      return (
                        <div key={step.label} style={{ background: isLast ? AC_DIM : "rgba(255,255,255,0.04)", border: `1px solid ${isLast ? AC_BORDER : "rgba(255,255,255,0.07)"}`, borderRadius: 12, padding: "10px 14px" }}>
                          <p style={{ fontSize: 9, color: isLast ? AC_TEXT : "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{step.label}</p>
                          <p style={{ fontSize: 13, color: isLast ? "#f0f0ef" : "rgba(255,255,255,0.72)" }}>{step.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── PROBLEM ─────────────────────────────────── */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Problème" : "Problem"} title={t.problemTitle} text={t.problemText} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 32 }}>
              {t.problems.map((item) => (
                <div key={item} style={cardBase} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.30)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
                  <p style={{ fontSize: 14, color: "rgba(255,255,255,0.78)", lineHeight: 1.55 }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── SOLUTION ────────────────────────────────── */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Solution" : "Solution"} title={t.solutionTitle} text={t.solutionText} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 32 }}>
              {t.solutions.map((item, index) => (
                <div key={item} style={cardBase} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: AC_DIM, border: `1px solid ${AC_BORDER}`, color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>{index + 1}</div>
                  <p style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── VISUAL DEMO — Preserved Image + lightbox ── */}
        <section id="demo" style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Démo visuelle" : "Visual demo"} title={t.demoTitle} text={t.demoText} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 32 }}>
              {demoImages.map((img) => (
                <button key={img.src} type="button" onClick={() => setSelectedImage({ src: img.src, alt: img.alt })} style={{ ...cardBase, textAlign: "left", cursor: "pointer" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
                  <div style={{ overflow: "hidden", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", marginBottom: 14 }}>
                    <Image src={img.src} alt={img.alt} width={1400} height={900} style={{ width: "100%", height: "auto", display: "block" }} />
                  </div>
                  <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 16, fontWeight: 700, color: "#f0f0ef", marginBottom: 6 }}>{img.title}</h3>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>{img.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── WORKFLOW ─────────────────────────────────── */}
        <section style={section}>
          <div style={container}>
            <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 48, alignItems: "start" }}>
              <SectionTitle eyebrow="Workflow" title={t.workflowTitle} text={t.workflowText} />
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {t.flowSteps.map((step, index) => (
                  <div key={step} style={{ display: "flex", gap: 14, alignItems: "center", ...cardBase, padding: "14px 18px" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: AC_DIM, border: `1px solid ${AC_BORDER}`, color: AC_TEXT, fontFamily: "'JetBrains Mono', monospace", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{index + 1}</div>
                    <p style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", lineHeight: 1.55 }}>{step}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── DIFFERENCE + FUTURE ─────────────────────── */}
        <section style={section}>
          <div style={container}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ ...cardBase, borderRadius: 24, padding: 28 }}>
                <SectionTitle eyebrow={lang === "fr" ? "Différence" : "Difference"} title={t.differenceTitle} text={t.differenceText} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                  {t.differences.map((item) => (
                    <div key={item} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px", fontSize: 13.5, color: "rgba(255,255,255,0.70)", transition: "border-color 150ms" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}>
                      ✓ {item}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ ...cardBase, borderRadius: 24, padding: 28 }}>
                <SectionTitle eyebrow={lang === "fr" ? "Extensions" : "Expansion"} title={t.futureTitle} text={t.futureText} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
                  {t.futureItems.map((item) => (
                    <div key={item} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "10px 14px", fontSize: 13.5, color: "rgba(255,255,255,0.70)", transition: "border-color 150ms" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}>
                      → {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <hr style={divider} />

        {/* ── TARGETS ─────────────────────────────────── */}
        <section style={section}>
          <div style={container}>
            <SectionTitle eyebrow={lang === "fr" ? "Cible" : "Target users"} title={t.targetTitle} text={t.targetText} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginTop: 32 }}>
              {Object.entries(t.targets).map(([category, items]) => (
                <div key={category} style={cardBase} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
                  <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 15, fontWeight: 700, color: "#f0f0ef", marginBottom: 14 }}>{category}</h3>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {items.map((item) => (
                      <span key={item} style={{ padding: "5px 12px", borderRadius: 999, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", fontSize: 12.5, color: "rgba(255,255,255,0.65)" }}>{item}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CHAT SECTION — Full logic preserved ─────── */}
        <section style={{ ...section, paddingTop: 0 }}>
          <div style={container}>
            <div style={{ background: "linear-gradient(135deg, rgba(249,115,22,0.08) 0%, rgba(255,255,255,0.02) 50%, rgba(249,115,22,0.05) 100%)", border: `1px solid ${AC_BORDER}`, borderRadius: 28, padding: "48px 36px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${AC}, transparent)` }} />
              <div style={{ display: "grid", gridTemplateColumns: "0.9fr 1.1fr", gap: 40 }}>
                {/* Left */}
                <div>
                  <p style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: AC_TEXT, opacity: 0.75, marginBottom: 10 }}>{t.chatEyebrow}</p>
                  <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "clamp(1.4rem, 2vw, 1.9rem)", fontWeight: 800, color: "#f0f0ef", letterSpacing: "-0.025em", marginBottom: 12 }}>{t.chatTitle}</h2>
                  <p style={{ fontSize: 14, color: "rgba(255,255,255,0.50)", lineHeight: 1.7, marginBottom: 24 }}>{t.chatText}</p>
                  <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: 20 }}>
                    <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 14, fontWeight: 700, color: "#f0f0ef", marginBottom: 8 }}>{t.demoCardTitle}</h3>
                    <p style={{ fontSize: 13, color: "rgba(255,255,255,0.48)", lineHeight: 1.6, marginBottom: 16 }}>{t.demoCardText}</p>
                    <Link href="/" style={{ display: "inline-flex", alignItems: "center", padding: "9px 18px", background: "transparent", color: "rgba(255,255,255,0.78)", fontSize: 13, fontWeight: 500, borderRadius: 999, textDecoration: "none", border: "1px solid rgba(255,255,255,0.14)", transition: "border-color 150ms" }}>{t.backHome}</Link>
                  </div>
                </div>

                {/* Right — chat */}
                <div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.60)", marginBottom: 10 }}>{t.suggestionsTitle}</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {t.prompts.map((prompt) => (
                        <button key={prompt} type="button" onClick={() => usePrompt(prompt)} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "rgba(255,255,255,0.72)", textAlign: "left", cursor: "pointer", transition: "border-color 150ms, color 150ms" }} onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = AC_BORDER; (e.currentTarget as HTMLElement).style.color = AC_TEXT; }} onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.08)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.72)"; }}>
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ── Preserved chat UI ── */}
                  <section style={{ overflow: "hidden", borderRadius: 20, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(15,23,40,0.90)" }}>
                    <div style={{ maxHeight: 460, minHeight: 360, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                      {messages.map((msg) => {
                        const showPreviewCard = msg.role === "assistant" && msg.actionType === "preview_actions" && !!msg.previewImageUrl;
                        const showVideoCard = msg.role === "assistant" && msg.actionType === "video_completed" && !!msg.videoUrl;
                        return (
                          <div key={msg.id} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                            <div style={{ maxWidth: "82%" }}>
                              {msg.imagePreview ? (
                                <div style={{ marginBottom: 8, overflow: "hidden", borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)" }}>
                                  <Image src={msg.imagePreview} alt="Uploaded preview" width={800} height={800} style={{ display: "block", width: "100%", maxWidth: 240, height: "auto", objectFit: "cover" }} unoptimized />
                                </div>
                              ) : null}

                              {showVideoCard ? (
                                <div style={{ marginBottom: 8, overflow: "hidden", borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "#0b1628", padding: 12 }}>
                                  <video src={msg.videoUrl as string} controls autoPlay style={{ width: "100%", borderRadius: 12 }} />
                                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12, padding: "0 4px" }}>
                                    {msg.title ? (
                                      <div>
                                        <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.40)", marginBottom: 4 }}>{lang === "fr" ? "Titre" : "Title"}</p>
                                        <p style={{ fontSize: 13, fontWeight: 600, color: "#f0f0ef" }}>{msg.title}</p>
                                      </div>
                                    ) : null}
                                    {msg.description ? (
                                      <div>
                                        <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.40)", marginBottom: 4 }}>Description</p>
                                        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.72)", lineHeight: 1.6 }}>{msg.description}</p>
                                      </div>
                                    ) : null}
                                    {msg.hashtags ? (
                                      <div>
                                        <p style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(255,255,255,0.40)", marginBottom: 8 }}>Hashtags</p>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                          {(typeof msg.hashtags === "string"
                                            ? (msg.hashtags as string).trim().split(/\s+/)
                                            : msg.hashtags
                                          ).filter(Boolean).map((tag) => (
                                            <span key={tag} style={{ borderRadius: 999, background: "rgba(124,92,255,0.18)", padding: "3px 10px", fontSize: 12, fontWeight: 500, color: "#a78bfa" }}>
                                              {tag.startsWith("#") ? tag : `#${tag}`}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}

                              {showPreviewCard ? (
                                <div style={{ marginBottom: 8, overflow: "hidden", borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "#fff", padding: 8 }}>
                                  <button type="button" onClick={() => setSelectedImage({ src: msg.previewImageUrl as string, alt: msg.fileName || (lang === "fr" ? "Preview générée" : "Generated preview") })} style={{ display: "block", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                                    <Image src={msg.previewImageUrl as string} alt={msg.fileName || (lang === "fr" ? "Preview générée" : "Generated preview")} width={1200} height={1200} style={{ width: "100%", height: "auto", borderRadius: 10, display: "block" }} unoptimized />
                                  </button>
                                  <div style={{ marginTop: 12, padding: "0 4px" }}>
                                    <div style={{ fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(16,24,39,0.55)" }}>{t.previewLabel}</div>
                                    <div style={{ fontSize: 13, color: "#101827", marginTop: 2 }}>{msg.fileName || t.previewMetaFallback}</div>
                                    {msg.previewCreatedAt ? <div style={{ fontSize: 11, color: "rgba(16,24,39,0.55)", marginTop: 2 }}>{msg.previewCreatedAt}</div> : null}
                                  </div>
                                  <div style={{ marginTop: 16, background: "#f7f8fb", borderRadius: 12, padding: 16, color: "#101827" }}>
                                    <p style={{ fontSize: 16, fontWeight: 500 }}>{t.previewIntro}</p>
                                    <div style={{ marginTop: 12, fontSize: 14 }}>
                                      <p style={{ fontWeight: 500 }}>{t.previewChoices}</p>
                                      <p style={{ marginTop: 6 }}>{`1️⃣ ${t.approveLabel}`}</p>
                                      <p>{`2️⃣ ${t.modifyLabel}`}</p>
                                    </div>
                                    <div style={{ marginTop: 14 }}>
                                      <p style={{ fontSize: 14, fontWeight: 500 }}>{t.previewQuestion}</p>
                                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                                        <button type="button" onClick={() => openN8nAction(msg.approveUrl)} disabled={loading || !msg.approveUrl} style={{ width: "100%", borderRadius: 14, background: "#1d2f4a", padding: "10px 14px", textAlign: "left", color: "#fff", fontSize: 13, border: "none", cursor: "pointer", opacity: loading || !msg.approveUrl ? 0.6 : 1 }}>
                                          1️⃣ {t.approveButton}
                                        </button>
                                        <button type="button" onClick={() => openN8nAction(msg.modifyUrl)} disabled={loading || !msg.modifyUrl} style={{ width: "100%", borderRadius: 14, background: "#1d2f4a", padding: "10px 14px", textAlign: "left", color: "#fff", fontSize: 13, border: "none", cursor: "pointer", opacity: loading || !msg.modifyUrl ? 0.6 : 1 }}>
                                          2️⃣ {t.modifyButton}
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : null}

                              {msg.content ? (
                                <div style={{ borderRadius: 18, padding: "10px 14px", fontSize: 13, lineHeight: 1.65, boxShadow: "0 6px 16px rgba(0,0,0,0.14)", ...(msg.role === "user" ? { borderBottomRightRadius: 6, background: `linear-gradient(135deg, ${AC}, #fb923c)`, color: "#fff" } : { borderBottomLeftRadius: 6, background: "#fff", color: "#101827" }) }}>
                                  {msg.content}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}

                      {loading && (
                        <div style={{ display: "flex", justifyContent: "flex-start" }}>
                          <div style={{ borderRadius: 18, borderBottomLeftRadius: 6, background: "#fff", color: "#101827", padding: "10px 14px", fontSize: 13, lineHeight: 1.65, boxShadow: "0 6px 16px rgba(0,0,0,0.14)" }}>
                            {t.thinking}{typingDots()}
                          </div>
                        </div>
                      )}

                      <div ref={bottomRef} />
                    </div>

                    <form onSubmit={handleSubmit} style={{ borderTop: "1px solid rgba(255,255,255,0.08)", background: "rgba(13,20,36,1)", padding: 16 }}>
                      {imagePreview ? (
                        <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 10 }}>
                          <div style={{ overflow: "hidden", borderRadius: 10, border: "1px solid rgba(255,255,255,0.10)", flexShrink: 0 }}>
                            <Image src={imagePreview} alt="Preview" width={72} height={72} style={{ display: "block", width: 72, height: 72, objectFit: "cover" }} unoptimized />
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, color: "#f0f0ef" }}>{t.imageReady}</div>
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{t.uploadHint}</div>
                          </div>
                          <button type="button" onClick={clearImage} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: "6px 12px", fontSize: 12, color: "rgba(255,255,255,0.70)", cursor: "pointer" }}>{t.removeImage}</button>
                        </div>
                      ) : null}

                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />
                        <button type="button" onClick={() => fileInputRef.current?.click()} style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.55)", fontSize: 22, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }} title={t.uploadHint}>+</button>
                        <input value={input} onChange={(e) => setInput(e.target.value)} onPaste={handlePaste} placeholder={t.placeholder} style={{ flex: 1, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "#f0f0ef", fontSize: 13, padding: "0 14px", outline: "none" }} />
                        <button type="submit" disabled={loading || (!input.trim() && !imageBase64)} style={{ height: 44, borderRadius: 12, background: AC, color: "#000", fontSize: 13, fontWeight: 700, padding: "0 18px", border: "none", cursor: "pointer", boxShadow: `0 4px 16px rgba(249,115,22,0.28)`, opacity: loading || (!input.trim() && !imageBase64) ? 0.5 : 1, flexShrink: 0 }}>{t.send}</button>
                      </div>
                    </form>
                  </section>
                </div>
              </div>
            </div>
          </div>
        </section>

      </main>

      {selectedImage && (
        <div onClick={() => setSelectedImage(null)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.80)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "relative", maxHeight: "95vh", maxWidth: "95vw" }}>
            <button type="button" onClick={() => setSelectedImage(null)} style={{ position: "absolute", top: 12, right: 12, zIndex: 10, background: "rgba(0,0,0,0.70)", border: "none", borderRadius: 999, padding: "4px 12px", fontSize: 13, color: "#fff", cursor: "pointer" }}>✕</button>
            <Image src={selectedImage.src} alt={selectedImage.alt} width={1800} height={1200} style={{ maxHeight: "90vh", width: "auto", borderRadius: 16, objectFit: "contain", display: "block" }} unoptimized />
          </div>
        </div>
      )}
    </NavbarFooter>
  );
}
