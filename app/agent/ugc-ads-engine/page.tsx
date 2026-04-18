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

  if (
    typeof data.preview_image_url === "string" &&
    data.preview_image_url.trim()
  ) {
    return data.preview_image_url;
  }

  if (typeof data.image_url === "string" && data.image_url.trim()) {
    return data.image_url;
  }

  if (
    typeof data.preview_image_base64 === "string" &&
    data.preview_image_base64.trim()
  ) {
    const cleaned = String(data.preview_image_base64).replace(
      /^data:[^;]+;base64,/,
      ""
    );
    const mime = data.preview_mime_type || "image/png";
    return `data:${mime};base64,${cleaned}`;
  }

  return null;
}

function sanitizeMessagesForStorage(messages: Message[]): Message[] {
  return messages.map((msg) => {
    const isBase64Preview =
      typeof msg.previewImageUrl === "string" &&
      msg.previewImageUrl.startsWith("data:image/");

    const isBase64Upload =
      typeof msg.imagePreview === "string" &&
      msg.imagePreview.startsWith("data:image/");

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
    heroTitle:
      "Transforme une simple image en vidéo UGC prête à convertir.",
    heroSubtitle:
      "Ce système automatise la création de vidéos marketing de bout en bout : script, structure hook + narration + CTA, direction vidéo, contrôle qualité et génération finale.",
    primaryCta: "Voir la démo visuelle",
    secondaryCta: "Retour à l’accueil",
    stats: [
      { label: "Input", value: "1 image ou idée" },
      { label: "Output", value: "Vidéo UGC structurée" },
      { label: "Logique", value: "Script • QC • Fallback" },
    ],

    productBoxTitle: "Ce que fait le système",
    productSteps: [
      {
        label: "Input utilisateur",
        text: "Une simple image ou une idée de contenu est envoyée au système.",
      },
      {
        label: "Orchestration IA",
        text: "Le moteur construit le script, la structure marketing et la direction vidéo.",
      },
      {
        label: "Production vidéo",
        text: "La vidéo est générée selon une logique standardisée et cohérente.",
      },
      {
        label: "Contrôle qualité",
        text: "Le système vérifie le résultat et applique fallback / retry si nécessaire.",
      },
    ],

    problemTitle: "Le vrai problème",
    problemText:
      "Les outils comme ChatGPT, Kling, Runway ou d’autres générateurs sont puissants, mais ils laissent encore l’utilisateur gérer trop de friction manuelle.",
    problems: [
      "Tu ne sais pas écrire de bons prompts",
      "Tu perds du temps à tester plusieurs versions",
      "Les résultats sont irréguliers",
      "La structure marketing est souvent absente",
      "Le contenu généré ne convertit pas toujours",
      "Tu dois jongler entre plusieurs outils",
    ],

    solutionTitle: "La solution",
    solutionText:
      "Ici, la valeur n’est pas juste la génération vidéo. C’est le système complet qui transforme une idée en contenu marketing prêt à publier.",
    solutions: [
      "Génération automatique du script",
      "Structure marketing intégrée : hook, narration, CTA",
      "Direction vidéo automatisée",
      "Contrôle qualité intégré",
      "Retry et fallback automatiques",
      "Production plus rapide et plus scalable",
    ],

    demoTitle: "Démo visuelle",
    demoText:
      "Clique sur une capture pour l’ouvrir en grand et mieux visualiser la logique du moteur, les étapes de validation et le rendu du système.",

    workflowTitle: "Comment le moteur fonctionne",
    workflowText:
      "L’utilisateur voit une expérience simple. En arrière-plan, le système orchestre plusieurs couches pour sortir une vidéo UGC propre et cohérente.",
    flowSteps: [
      "L’utilisateur envoie une image ou une idée",
      "Le système génère le script marketing",
      "Une preview / structure est préparée",
      "La direction vidéo est construite",
      "La génération est lancée",
      "Le QC vérifie le résultat",
      "Un fallback ou retry peut se déclencher si besoin",
      "Le rendu final est prêt à publier",
    ],

    differenceTitle: "Pourquoi c’est différent",
    differenceText:
      "Les outils donnent des capacités. Ce produit donne un vrai système prêt à produire du contenu marketing avec moins de friction.",
    differences: [
      "Pas besoin d’expertise en prompting",
      "Pas de tool switching",
      "Workflow automatisé de bout en bout",
      "Sortie plus standardisée",
      "Production scalable",
      "Pensé pour la conversion, pas juste la génération",
    ],

    targetTitle: "Pour qui",
    targetText:
      "Le système s’adresse aux profils qui ont besoin de produire du contenu publicitaire ou UGC rapidement, de manière répétable et exploitable.",
    targets: {
      "E-commerce": [
        "Tests créatifs ads",
        "UGC produit",
        "Variantes publicitaires",
      ],
      "Agences marketing": [
        "Production client plus rapide",
        "Création standardisée",
        "Plus de volume sans chaos",
      ],
      "Créateurs & solo business": [
        "Contenu plus pro",
        "Moins de friction technique",
        "Meilleure vitesse d’exécution",
      ],
    },

    futureTitle: "Extensions futures",
    futureText:
      "Le système peut ensuite être enrichi pour aller encore plus loin en production.",
    futureItems: [
      "Templates de hooks et styles",
      "Batch generation",
      "A/B testing de variantes",
      "Génération multi-versions",
    ],

    chatEyebrow: "Tester le moteur",
    chatTitle: "Parle directement au bot UGC",
    chatText:
      "Écris une demande comme dans un vrai produit SaaS. Le bot envoie ta requête au workflow UGC et te renvoie une réponse directement dans la page.",
    welcome:
      "Bienvenue sur UGC Ads Engine. Décris la vidéo UGC ou l’idée publicitaire que tu veux créer.",
    placeholder: "Décris la vidéo UGC que tu veux créer...",
    send: "Envoyer",
    thinking: "Le bot UGC réfléchit...",
    error:
      "Erreur de connexion avec le workflow UGC. Vérifie le webhook n8n ou la réponse du flow.",
    suggestionsTitle: "Suggestions rapides",
    prompts: [
      "Crée une idée de vidéo UGC pour une crème visage avec un hook fort",
      "Donne-moi un script UGC court pour un produit e-commerce",
      "Propose 3 angles créatifs pour une pub TikTok UGC",
    ],
    demoCardTitle: "Espace de test premium",
    demoCardText:
      "Ce module te permet de tester l’expérience directement depuis la page produit, sans sortir du site.",
    uploadHint: "Clique sur + ou colle une image ici",
    imageReady: "Image prête à être envoyée",
    removeImage: "Retirer l’image",
    backHome: "Retour à l’accueil",
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
    heroTitle:
      "Turn a simple image into a high-converting UGC video.",
    heroSubtitle:
      "This system automates end-to-end video creation: script, hook + narrative + CTA structure, video direction, quality control, and final generation.",
    primaryCta: "Open visual demo",
    secondaryCta: "Back to homepage",
    stats: [
      { label: "Input", value: "1 image or idea" },
      { label: "Output", value: "Structured UGC video" },
      { label: "Logic", value: "Script • QC • Fallback" },
    ],

    productBoxTitle: "What the system does",
    productSteps: [
      {
        label: "User input",
        text: "A simple image or content idea is sent into the system.",
      },
      {
        label: "AI orchestration",
        text: "The engine builds the script, the marketing structure, and the video direction.",
      },
      {
        label: "Video production",
        text: "The video is generated through a standardized, more reliable workflow.",
      },
      {
        label: "Quality control",
        text: "The system checks the output and can trigger fallback / retry logic if needed.",
      },
    ],

    problemTitle: "The real problem",
    problemText:
      "Tools like ChatGPT, Kling, Runway, and similar generators are powerful, but they still leave too much manual friction to the user.",
    problems: [
      "You don’t know how to write good prompts",
      "You waste time iterating",
      "Results are inconsistent",
      "Marketing structure is often missing",
      "Generated content does not always convert",
      "You keep switching between tools",
    ],

    solutionTitle: "The solution",
    solutionText:
      "The value is not just video generation. It is the full system that turns an idea into ready-to-publish marketing content.",
    solutions: [
      "Automatic script generation",
      "Built-in marketing structure: hook, narrative, CTA",
      "Automated video direction",
      "Built-in quality control",
      "Automatic retry and fallback logic",
      "Faster, more scalable production",
    ],

    demoTitle: "Visual demo",
    demoText:
      "Click any screenshot to open it larger and inspect the engine logic, validation flow, and how the system is structured.",

    workflowTitle: "How the engine works",
    workflowText:
      "The user sees a simple experience. Under the hood, the system orchestrates multiple layers to produce a clean, structured UGC video.",
    flowSteps: [
      "The user sends an image or idea",
      "The system generates the marketing script",
      "A preview / structure is prepared",
      "The video direction is built",
      "Generation is launched",
      "QC checks the output",
      "Fallback or retry can trigger if needed",
      "Final output is ready to publish",
    ],

    differenceTitle: "Why it’s different",
    differenceText:
      "Tools provide capabilities. This product provides a system ready to produce marketing content with less friction.",
    differences: [
      "No prompting expertise needed",
      "No switching between tools",
      "End-to-end automated workflow",
      "More standardized output",
      "Scalable production",
      "Built for conversion, not just generation",
    ],

    targetTitle: "Who it’s for",
    targetText:
      "This system is built for people and teams that need faster, repeatable, usable UGC or ad content production.",
    targets: {
      "E-commerce": [
        "Creative testing",
        "Product UGC ads",
        "Ad variants",
      ],
      "Marketing agencies": [
        "Faster client production",
        "More standardized output",
        "Higher volume without chaos",
      ],
      "Creators & solo businesses": [
        "More professional content",
        "Less technical friction",
        "Better execution speed",
      ],
    },

    futureTitle: "Future expansion",
    futureText:
      "The system can later be extended to go even further in production workflows.",
    futureItems: [
      "Hook and style templates",
      "Batch generation",
      "A/B testing variants",
      "Multi-version generation",
    ],

    chatEyebrow: "Try the engine",
    chatTitle: "Talk directly to the UGC bot",
    chatText:
      "Write a request like in a real SaaS product. The bot sends your prompt to the UGC workflow and returns the reply directly in the page.",
    welcome:
      "Welcome to UGC Ads Engine. Describe the UGC video or ad concept you want to create.",
    placeholder: "Describe the UGC video you want to create...",
    send: "Send",
    thinking: "The UGC bot is thinking...",
    error:
      "Connection error with the UGC workflow. Check the n8n webhook or the workflow response.",
    suggestionsTitle: "Quick suggestions",
    prompts: [
      "Create a UGC video idea for a skincare cream with a strong hook",
      "Write a short UGC script for an e-commerce product",
      "Give me 3 creative angles for a TikTok UGC ad",
    ],
    demoCardTitle: "Premium testing area",
    demoCardText:
      "This module lets you test the product experience directly inside the page without leaving the site.",
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

function SectionTitle({
  eyebrow,
  title,
  text,
}: {
  eyebrow: string;
  title: string;
  text?: string;
}) {
  return (
    <div className="max-w-3xl">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
        {title}
      </h2>
      {text ? (
        <p className="mt-4 text-base leading-8 text-white/68 md:text-lg">
          {text}
        </p>
      ) : null}
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
      createdAt:
        typeof msg.createdAt === "number" ? msg.createdAt : Date.now(),
      imagePreview:
        typeof msg.imagePreview === "string" || msg.imagePreview === null
          ? msg.imagePreview
          : null,
      previewImageUrl:
        typeof msg.previewImageUrl === "string" || msg.previewImageUrl === null
          ? msg.previewImageUrl
          : null,
      storagePath:
        typeof msg.storagePath === "string" || msg.storagePath === null
          ? msg.storagePath
          : null,
      fileName:
        typeof msg.fileName === "string" || msg.fileName === null
          ? msg.fileName
          : null,
      previewCreatedAt:
        typeof msg.previewCreatedAt === "string" ||
        msg.previewCreatedAt === null
          ? msg.previewCreatedAt
          : null,
      actionType:
        msg.actionType === "preview_actions" ? "preview_actions" : null,
      approveUrl:
        typeof msg.approveUrl === "string" || msg.approveUrl === null
          ? msg.approveUrl
          : null,
      modifyUrl:
        typeof msg.modifyUrl === "string" || msg.modifyUrl === null
          ? msg.modifyUrl
          : null,
    };
  });
}

export default function UGCAdsEnginePage() {
  const [lang, setLang] = useState<Lang>("en");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [typingPhase, setTypingPhase] = useState(0);
  const [selectedImage, setSelectedImage] = useState<null | {
    src: string;
    alt: string;
  }>(null);
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

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const savedLang = localStorage.getItem(LANG_KEY) as Lang | null;
    if (savedLang === "fr" || savedLang === "en") {
      setLang(savedLang);
    }

    const rawMessages = localStorage.getItem(STORAGE_KEY);
    if (rawMessages) {
      try {
        const parsed = JSON.parse(rawMessages);
        const normalized = normalizeMessages(parsed);
        if (normalized.length) {
          setMessages(normalized);
          return;
        }
      } catch {}
    }

    setMessages([
      {
        id: uid(),
        role: "assistant",
        content: copy[savedLang === "fr" ? "fr" : "en"].welcome,
        createdAt: Date.now(),
      },
    ]);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(LANG_KEY, lang);
  }, [lang, mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (!messages.length) return;

    try {
      const safeMessages = sanitizeMessagesForStorage(messages);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(safeMessages));
    } catch (error) {
      console.error("Failed to save messages to localStorage:", error);
    }
  }, [messages, mounted]);

  useEffect(() => {
    if (!mounted) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, mounted]);

  useEffect(() => {
    if (!mounted || !loading) return;
    const id = window.setInterval(() => {
      setTypingPhase((prev) => (prev + 1) % 4);
    }, 350);

    return () => window.clearInterval(id);
  }, [loading, mounted]);

  useEffect(() => {
    function handlePostMessage(event: MessageEvent) {
      if (event.data?.type !== "ugc_modify_submitted") return;

      const feedbackPrompt: string = event.data.feedback_prompt ?? "";
      const feedbackIntent: string = event.data.feedback_intent ?? "";
      const jobId: string = event.data.job_id ?? "";

      const content =
        lang === "fr"
          ? `✏️ Modification reçue : "${feedbackPrompt}". Le système régénère votre visuel...`
          : `✏️ Modification received: "${feedbackPrompt}". The system is regenerating your visual...`;
      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content, createdAt: Date.now() },
      ]);

      if (!jobId) return;

      if (feedbackIntent === "VIDEO") {
        if (videoPollingJobsRef.current.has(jobId)) return;
        if (videoPollingRef.current) window.clearInterval(videoPollingRef.current);

        videoPollingJobsRef.current.add(jobId);
        let attempts = 0;
        const MAX_ATTEMPTS = 40;

        videoPollingRef.current = window.setInterval(async () => {
          attempts += 1;

          try {
            const res = await fetch(
              `/api/ugc-status?job_id=${encodeURIComponent(jobId)}`
            );
            const data = await res.json();

            const isVideoReady =
              (data.status === "video_completed" ||
                (data.status === "completed" &&
                  data.current_step === "video_completed")) &&
              !!data.video_url;

            if (isVideoReady) {
              window.clearInterval(videoPollingRef.current!);
              videoPollingRef.current = null;
              videoPollingJobsRef.current.delete(jobId);
              setMessages((prev) => [
                ...prev,
                {
                  id: uid(),
                  role: "assistant",
                  content: lang === "fr" ? "🎬 Ta vidéo est prête !" : "🎬 Your video is ready!",
                  createdAt: Date.now(),
                  actionType: "video_completed",
                  videoUrl: data.video_url,
                  title: data.title ?? null,
                  description: data.description ?? null,
                  hashtags: Array.isArray(data.hashtags) ? data.hashtags : null,
                },
              ]);
              return;
            }
          } catch {
            window.clearInterval(videoPollingRef.current!);
            videoPollingRef.current = null;
            videoPollingJobsRef.current.delete(jobId);
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: "assistant",
                content:
                  lang === "fr"
                    ? "Erreur lors de la vérification de la vidéo. Veuillez réessayer."
                    : "Error checking video status. Please try again.",
                createdAt: Date.now(),
              },
            ]);
            return;
          }

          if (attempts >= MAX_ATTEMPTS) {
            window.clearInterval(videoPollingRef.current!);
            videoPollingRef.current = null;
            videoPollingJobsRef.current.delete(jobId);
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: "assistant",
                content:
                  lang === "fr"
                    ? "La vidéo n'a pas été prête dans le délai imparti. Veuillez réessayer."
                    : "The video was not ready in time. Please try again.",
                createdAt: Date.now(),
              },
            ]);
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
            const res = await fetch(
              `/api/ugc-status?job_id=${encodeURIComponent(jobId)}`
            );
            const data = await res.json();
            const previewSrc = buildPreviewSrc(data);

            if (data.status === "preview_ready" && previewSrc) {
              window.clearInterval(pollingRef.current!);
              pollingRef.current = null;
              pollingJobsRef.current.delete(jobId);
              setMessages((prev) => [
                ...prev,
                {
                  id: uid(),
                  role: "assistant",
                  content:
                    data.reply ||
                    data.message ||
                    data.text ||
                    copy[lang].previewLabel,
                  createdAt: Date.now(),
                  previewImageUrl: previewSrc,
                  storagePath: data.storage_path ?? null,
                  fileName: data.file_name ?? null,
                  previewCreatedAt:
                    data.preview_created_at ??
                    data.created_at ??
                    new Date().toISOString(),
                  actionType: "preview_actions",
                  approveUrl: data.approve_url ?? null,
                  modifyUrl: data.modify_url ?? null,
                },
              ]);
              return;
            }
          } catch {
            window.clearInterval(pollingRef.current!);
            pollingRef.current = null;
            pollingJobsRef.current.delete(jobId);
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: "assistant",
                content:
                  lang === "fr"
                    ? "Erreur lors de la vérification du statut. Veuillez réessayer."
                    : "Error checking the generation status. Please try again.",
                createdAt: Date.now(),
              },
            ]);
            return;
          }

          if (attempts >= MAX_ATTEMPTS) {
            window.clearInterval(pollingRef.current!);
            pollingRef.current = null;
            pollingJobsRef.current.delete(jobId);
            setMessages((prev) => [
              ...prev,
              {
                id: uid(),
                role: "assistant",
                content:
                  lang === "fr"
                    ? "Le visuel n'a pas été prêt dans le délai imparti. Veuillez réessayer."
                    : "The visual was not ready in time. Please try again.",
                createdAt: Date.now(),
              },
            ]);
          }
        }, 3000);
      }
    }

    window.addEventListener("message", handlePostMessage);
    return () => {
      window.removeEventListener("message", handlePostMessage);
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      if (videoPollingRef.current) {
        window.clearInterval(videoPollingRef.current);
        videoPollingRef.current = null;
      }
    };
  }, [lang]);

  const demoImages = useMemo(
    () => [
      {
        src: "/demo/ugc-1.png",
        alt: lang === "fr" ? "Capture démo UGC 1" : "UGC demo screenshot 1",
        title: "Workflow view",
        desc:
          lang === "fr"
            ? "Vue d’ensemble du flow : input, script, validation, génération et QC."
            : "Overview of the flow: input, script, validation, generation, and QC.",
      },
      {
        src: "/demo/ugc-2.png",
        alt: lang === "fr" ? "Capture démo UGC 2" : "UGC demo screenshot 2",
        title: "Validation layer",
        desc:
          lang === "fr"
            ? "Exemple de logique de validation et de contrôle qualité."
            : "Example of validation and quality control logic.",
      },
      {
        src: "/demo/ugc-3.png",
        alt: lang === "fr" ? "Capture démo UGC 3" : "UGC demo screenshot 3",
        title: "Output preview",
        desc:
          lang === "fr"
            ? "Aperçu du résultat final ou d’une étape importante du rendu."
            : "Preview of the final output or an important rendering step.",
      },
    ],
    [lang]
  );

  function usePrompt(prompt: string) {
    setInput(prompt);
  }

  function typingDots() {
    return ".".repeat(typingPhase === 0 ? 1 : typingPhase);
  }

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
        if (file) {
          e.preventDefault();
          await applyFile(file);
          return;
        }
      }
    }
  }

  function clearImage() {
    setImagePreview(null);
    setImageBase64(null);
  }

  function extractTextReply(data: any): string | undefined {
    return (
      data?.output ||
      data?.response ||
      data?.message ||
      data?.reply ||
      data?.text ||
      data?.body ||
      data?.result ||
      data?.data?.reply ||
      data?.data?.message ||
      data?.data?.text ||
      undefined
    );
  }

  function openN8nAction(url?: string | null) {
    if (!url || typeof window === "undefined") return;

    const redirectUrl = `${window.location.origin}/agent/ugc-ads-engine`;

    let finalUrl = url;

    try {
      const parsedUrl = new URL(url, window.location.origin);
      parsedUrl.searchParams.set("redirect_url", redirectUrl);
      finalUrl = parsedUrl.toString();
    } catch (error) {
      const separator = url.includes("?") ? "&" : "?";
      finalUrl = `${url}${separator}redirect_url=${encodeURIComponent(
        redirectUrl
      )}`;
    }

    const popup = window.open(
      finalUrl,
      "ugcFeedbackPopup",
      "width=700,height=900,resizable=yes,scrollbars=yes"
    );

    if (!popup) {
      window.location.href = finalUrl;
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if ((!input.trim() && !imageBase64) || loading) return;

    const messageText = input.trim();

    const nextMessages: Message[] = [
      ...messages,
      {
        id: uid(),
        role: "user",
        content:
          messageText || (lang === "fr" ? "Image envoyée" : "Image sent"),
        createdAt: Date.now(),
        imagePreview,
      },
    ];

    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: messageText,
          user_id: "web-user",
          chat_id: "web-chat",
          language: lang,
          source: "ugc-ads-engine-page",
          imageBase64,
        }),
      });

      const rawText = await res.text();

      if (!res.ok) {
        throw new Error(
          `Webhook HTTP ${res.status}: ${rawText || "Empty response"}`
        );
      }

      let data: any = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        data = rawText;
      }

      const previewSrc = buildPreviewSrc(data);

      const isPreviewReady =
        typeof data === "object" &&
        data !== null &&
        data.status === "preview_ready" &&
        !!previewSrc &&
        !!data.approve_url &&
        !!data.modify_url;

      let assistantMessage: Message;

      if (isPreviewReady) {
        assistantMessage = {
          id: uid(),
          role: "assistant",
          content: data.reply || data.message || data.text || t.previewLabel,
          createdAt: Date.now(),
          previewImageUrl: previewSrc,
          storagePath: data.storage_path ?? null,
          fileName: data.file_name ?? null,
          previewCreatedAt:
            data.preview_created_at ??
            data.created_at ??
            new Date().toISOString(),
          actionType: "preview_actions",
          approveUrl: data.approve_url ?? null,
          modifyUrl: data.modify_url ?? null,
        };
      } else {
        const reply =
          extractTextReply(data) ||
          (typeof data === "string"
            ? data
            : "The workflow returned a response, but no readable message was found.");

        assistantMessage = {
          id: uid(),
          role: "assistant",
          content: String(reply),
          createdAt: Date.now(),
        };
      }

      setMessages([...nextMessages, assistantMessage]);
      clearImage();
    } catch (err) {
      const fallbackMessage =
        err instanceof Error ? `${t.error}\n\n${err.message}` : t.error;

      setMessages([
        ...nextMessages,
        {
          id: uid(),
          role: "assistant",
          content: fallbackMessage,
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  if (!mounted) {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#07111f] text-white">
      <section className="relative overflow-hidden border-b border-white/8">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(54,109,255,0.18),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(124,92,255,0.12),transparent_30%)]" />
        <div className="absolute left-[-10%] top-[-20%] h-[420px] w-[420px] rounded-full bg-[#2b6fff]/10 blur-3xl" />
        <div className="absolute bottom-[-15%] right-[-10%] h-[340px] w-[340px] rounded-full bg-[#7c5cff]/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl px-6 py-20 md:px-10 md:py-28">
          <div className="mb-8 flex justify-end">
            <div className="grid w-[140px] grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setLang("fr")}
                className={`h-[42px] rounded-xl border border-white/10 text-white transition ${
                  lang === "fr" ? "bg-[rgba(124,92,255,0.18)]" : "bg-white/5"
                }`}
              >
                FR
              </button>
              <button
                type="button"
                onClick={() => setLang("en")}
                className={`h-[42px] rounded-xl border border-white/10 text-white transition ${
                  lang === "en" ? "bg-[rgba(124,92,255,0.18)]" : "bg-white/5"
                }`}
              >
                EN
              </button>
            </div>
          </div>

          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="inline-flex rounded-full border border-white/12 bg-white/6 px-4 py-2 text-sm text-white/75 backdrop-blur-sm">
                {t.badge}
              </div>

              <h1 className="mt-6 max-w-5xl text-4xl font-semibold tracking-tight text-white md:text-6xl md:leading-[1.04]">
                {t.heroTitle}
              </h1>

              <p className="mt-6 max-w-3xl text-lg leading-8 text-white/72">
                {t.heroSubtitle}
              </p>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <a
                  href="#demo"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3 font-semibold shadow-[0_10px_30px_rgba(255,255,255,0.08)] transition duration-300 hover:scale-[1.02] hover:shadow-[0_14px_40px_rgba(255,255,255,0.14)]"
                >
                  <span className="!text-[#000000]">{t.primaryCta}</span>
                </a>

                <Link
                  href="/"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/12 bg-white/6 px-6 py-3 font-semibold text-white backdrop-blur-sm transition duration-300 hover:scale-[1.02] hover:bg-white/10 hover:shadow-[0_12px_32px_rgba(255,255,255,0.08)]"
                >
                  {t.secondaryCta}
                </Link>
              </div>

              <div className="mt-10 grid gap-4 md:grid-cols-3">
                {t.stats.map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-3xl border border-white/10 bg-white/5 p-5 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
                  >
                    <p className="text-sm text-white/55">{stat.label}</p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[32px] border border-white/10 bg-white/6 p-6 shadow-2xl shadow-black/30 backdrop-blur-sm transition duration-500 hover:-translate-y-1 hover:shadow-[0_20px_70px_rgba(0,0,0,0.35)]">
              <div className="rounded-[24px] border border-white/10 bg-[#0b1628] p-6">
                <p className="text-sm text-white/50">{t.productBoxTitle}</p>

                <div className="mt-5 space-y-4">
                  {t.productSteps.map((step) => (
                    <div
                      key={step.label}
                      className="rounded-2xl border border-white/8 bg-white/5 p-4 transition duration-300 hover:bg-white/7"
                    >
                      <p className="text-sm text-white/50">{step.label}</p>
                      <p className="mt-1 text-white">{step.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <SectionTitle
          eyebrow={lang === "fr" ? "Problème" : "Problem"}
          title={t.problemTitle}
          text={t.problemText}
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {t.problems.map((item) => (
            <div
              key={item}
              className="rounded-[28px] border border-white/10 bg-white/5 p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
            >
              <p className="text-base leading-8 text-white/82">{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <SectionTitle
          eyebrow={lang === "fr" ? "Solution" : "Solution"}
          title={t.solutionTitle}
          text={t.solutionText}
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {t.solutions.map((item, index) => (
            <div
              key={item}
              className="rounded-[28px] border border-white/10 bg-white/5 p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-white font-semibold text-[#07111f]">
                {index + 1}
              </div>
              <p className="text-base leading-8 text-white/80">{item}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="demo" className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <SectionTitle
          eyebrow={lang === "fr" ? "Démo visuelle" : "Visual demo"}
          title={t.demoTitle}
          text={t.demoText}
        />

        <div className="mt-10 grid gap-8 lg:grid-cols-3">
          {demoImages.map((img) => (
            <button
              key={img.src}
              type="button"
              onClick={() => setSelectedImage({ src: img.src, alt: img.alt })}
              className="rounded-[28px] border border-white/10 bg-white/5 p-4 text-left transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
            >
              <div className="overflow-hidden rounded-[20px] border border-white/10">
                <Image
                  src={img.src}
                  alt={img.alt}
                  width={1400}
                  height={900}
                  className="h-auto w-full transition duration-500 hover:scale-[1.02]"
                />
              </div>
              <h3 className="mt-4 text-xl font-semibold text-white">
                {img.title}
              </h3>
              <p className="mt-2 text-sm leading-7 text-white/65">
                {img.desc}
              </p>
            </button>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr]">
          <div>
            <SectionTitle
              eyebrow={lang === "fr" ? "Workflow" : "Workflow"}
              title={t.workflowTitle}
              text={t.workflowText}
            />
          </div>

          <div className="space-y-4">
            {t.flowSteps.map((step, index) => (
              <div
                key={step}
                className="flex gap-4 rounded-[24px] border border-white/10 bg-white/5 p-5 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white font-semibold text-[#07111f]">
                  {index + 1}
                </div>
                <p className="pt-1 text-base leading-8 text-white/78">{step}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-[32px] border border-white/10 bg-white/5 p-8 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7">
            <SectionTitle
              eyebrow={lang === "fr" ? "Différence" : "Difference"}
              title={t.differenceTitle}
              text={t.differenceText}
            />
            <div className="mt-8 space-y-4">
              {t.differences.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white/80 transition duration-300 hover:border-white/20 hover:bg-white/8"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-white/10 bg-white/5 p-8 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7">
            <SectionTitle
              eyebrow={lang === "fr" ? "Extensions" : "Expansion"}
              title={t.futureTitle}
              text={t.futureText}
            />
            <div className="mt-8 space-y-4">
              {t.futureItems.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4 text-white/80 transition duration-300 hover:border-white/20 hover:bg-white/8"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-16 md:px-10">
        <SectionTitle
          eyebrow={lang === "fr" ? "Cible" : "Target users"}
          title={t.targetTitle}
          text={t.targetText}
        />

        <div className="mt-10 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(t.targets).map(([category, items]) => (
            <div
              key={category}
              className="rounded-[28px] border border-white/10 bg-white/5 p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/7"
            >
              <h3 className="text-xl font-semibold text-white">{category}</h3>
              <div className="mt-4 flex flex-wrap gap-3">
                {items.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-white/10 bg-white/6 px-3 py-2 text-sm text-white/78 transition duration-300 hover:border-white/20 hover:bg-white/10"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-20 md:px-10">
        <div className="rounded-[36px] border border-white/10 bg-gradient-to-r from-[#18233c] via-[#0d1627] to-[#0a1220] p-10 shadow-[0_20px_80px_rgba(0,0,0,0.28)]">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
                {t.chatEyebrow}
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-4xl">
                {t.chatTitle}
              </h2>
              <p className="mt-4 max-w-3xl text-base leading-8 text-white/68 md:text-lg">
                {t.chatText}
              </p>

              <div className="mt-8 rounded-[28px] border border-white/10 bg-white/5 p-6">
                <h3 className="text-lg font-semibold text-white">
                  {t.demoCardTitle}
                </h3>
                <p className="mt-3 text-sm leading-7 text-white/68">
                  {t.demoCardText}
                </p>

                <div className="mt-6">
                  <Link
                    href="/"
                    className="inline-flex items-center justify-center rounded-2xl border border-white/12 bg-white/6 px-6 py-3 font-semibold text-white backdrop-blur-sm transition duration-300 hover:scale-[1.02] hover:bg-white/10"
                  >
                    {t.backHome}
                  </Link>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-4">
                <div className="text-sm font-medium text-white/74">
                  {t.suggestionsTitle}
                </div>
                <div className="mt-3 grid gap-3">
                  {t.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => usePrompt(prompt)}
                      className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left text-sm text-white/82 transition duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/8"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>

              <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#0f1728]/90 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                <div className="max-h-[460px] min-h-[360px] overflow-y-auto p-5">
                  <div className="flex flex-col gap-4">
                    {messages.map((msg) => {
                      const showPreviewCard =
                        msg.role === "assistant" &&
                        msg.actionType === "preview_actions" &&
                        !!msg.previewImageUrl;

                      return (
                        <div
                          key={msg.id}
                          className={`flex ${
                            msg.role === "user" ? "justify-end" : "justify-start"
                          }`}
                        >
                          <div className="max-w-[82%]">
                            {msg.imagePreview ? (
                              <div className="mb-2 overflow-hidden rounded-2xl border border-white/10">
                                <Image
                                  src={msg.imagePreview}
                                  alt="Uploaded preview"
                                  width={800}
                                  height={800}
                                  className="h-auto w-full max-w-[240px] object-cover"
                                  unoptimized
                                />
                              </div>
                            ) : null}

                            {showPreviewCard ? (
                              <div className="mb-2 overflow-hidden rounded-2xl border border-white/10 bg-white p-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedImage({
                                      src: msg.previewImageUrl as string,
                                      alt:
                                        msg.fileName ||
                                        (lang === "fr"
                                          ? "Preview générée"
                                          : "Generated preview"),
                                    })
                                  }
                                  className="block w-full text-left"
                                >
                                  <Image
                                    src={msg.previewImageUrl as string}
                                    alt={
                                      msg.fileName ||
                                      (lang === "fr"
                                        ? "Preview générée"
                                        : "Generated preview")
                                    }
                                    width={1200}
                                    height={1200}
                                    className="h-auto w-full rounded-xl object-cover transition duration-300 hover:scale-[1.01]"
                                    unoptimized
                                  />
                                </button>

                                <div className="mt-3 px-1">
                                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-[#101827]/55">
                                    {t.previewLabel}
                                  </div>
                                  <div className="mt-1 text-sm text-[#101827]">
                                    {msg.fileName || t.previewMetaFallback}
                                  </div>
                                  {msg.previewCreatedAt ? (
                                    <div className="mt-1 text-xs text-[#101827]/55">
                                      {msg.previewCreatedAt}
                                    </div>
                                  ) : null}
                                </div>

                                <div className="mt-4 rounded-xl bg-[#f7f8fb] p-4 text-[#101827]">
                                  <p className="text-lg font-medium">
                                    {t.previewIntro}
                                  </p>

                                  <div className="mt-4 text-base">
                                    <p className="font-medium">
                                      {t.previewChoices}
                                    </p>
                                    <p className="mt-2">{`1️⃣ ${t.approveLabel}`}</p>
                                    <p>{`2️⃣ ${t.modifyLabel}`}</p>
                                  </div>

                                  <div className="mt-5">
                                    <p className="text-base font-medium">
                                      {t.previewQuestion}
                                    </p>

                                    <div className="mt-3 grid gap-3">
                                      <button
                                        type="button"
                                        onClick={() => openN8nAction(msg.approveUrl)}
                                        disabled={loading || !msg.approveUrl}
                                        className="w-full rounded-2xl bg-[#1d2f4a] px-4 py-3 text-left text-white transition hover:bg-[#274062] disabled:opacity-60"
                                      >
                                        1️⃣ {t.approveButton}
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => openN8nAction(msg.modifyUrl)}
                                        disabled={loading || !msg.modifyUrl}
                                        className="w-full rounded-2xl bg-[#1d2f4a] px-4 py-3 text-left text-white transition hover:bg-[#274062] disabled:opacity-60"
                                      >
                                        2️⃣ {t.modifyButton}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ) : null}

                            {msg.content ? (
                              <div
                                className={`rounded-[20px] px-4 py-3 text-sm leading-7 shadow-[0_10px_24px_rgba(0,0,0,0.14)] ${
                                  msg.role === "user"
                                    ? "rounded-br-[8px] bg-gradient-to-r from-[#7c5cff] to-[#4ea1ff] text-white"
                                    : "rounded-bl-[8px] bg-white text-[#101827]"
                                }`}
                              >
                                {msg.content}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}

                    {loading && (
                      <div className="flex justify-start">
                        <div className="max-w-[82%] rounded-[20px] rounded-bl-[8px] bg-white px-4 py-3 text-sm leading-7 text-[#101827] shadow-[0_10px_24px_rgba(0,0,0,0.14)]">
                          {t.thinking}
                          {typingDots()}
                        </div>
                      </div>
                    )}

                    <div ref={bottomRef} />
                  </div>
                </div>

                <form
                  onSubmit={handleSubmit}
                  className="border-t border-white/10 bg-[#0d1424] p-4"
                >
                  {imagePreview ? (
                    <div className="mb-3 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="overflow-hidden rounded-xl border border-white/10">
                        <Image
                          src={imagePreview}
                          alt="Preview"
                          width={72}
                          height={72}
                          className="h-[72px] w-[72px] object-cover"
                          unoptimized
                        />
                      </div>

                      <div className="flex-1">
                        <div className="text-sm font-medium text-white">
                          {t.imageReady}
                        </div>
                        <div className="text-xs text-white/55">
                          {t.uploadHint}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={clearImage}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80"
                      >
                        {t.removeImage}
                      </button>
                    </div>
                  ) : null}

                  <div className="flex items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileChange}
                    />

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-2xl text-white/60 transition hover:bg-white/10"
                      title={t.uploadHint}
                    >
                      +
                    </button>

                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onPaste={handlePaste}
                      placeholder={t.placeholder}
                      className="h-12 flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 text-white outline-none placeholder:text-white/35"
                    />

                    <button
                      type="submit"
                      disabled={loading || (!input.trim() && !imageBase64)}
                      className="h-12 rounded-2xl bg-gradient-to-r from-[#7c5cff] to-[#4ea1ff] px-5 font-semibold text-white shadow-[0_12px_30px_rgba(89,90,255,0.24)] disabled:opacity-60"
                    >
                      {t.send}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </div>
        </div>
      </section>

      {selectedImage && (
        <div
          onClick={() => setSelectedImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-h-[95vh] max-w-[95vw]"
          >
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="absolute right-3 top-3 z-10 rounded-full bg-black/70 px-3 py-1 text-sm text-white"
            >
              ✕
            </button>

            <Image
              src={selectedImage.src}
              alt={selectedImage.alt}
              width={1800}
              height={1200}
              className="max-h-[90vh] w-auto rounded-2xl object-contain"
              unoptimized
            />
          </div>
        </div>
      )}
    </main>
  );
}