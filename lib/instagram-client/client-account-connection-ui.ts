export type ClientAccountConnectionInput = {
  connected: boolean;
  loginStatus?: string;
  onboardingStatus?: string;
  provisioningStatus?: string;
  readinessLabel?: string;
};

export type ClientAccountConnectionUi = {
  badgeLabel: string;
  badgeTone: "success" | "warning" | "neutral";
  readinessLabel: string;
  readinessTone: "success" | "warning" | "neutral";
  readinessDisabled: boolean;
  connectLabel: string;
  connectTone: "success" | "primary" | "neutral";
  connectDisabled: boolean;
};

function label(lang: "fr" | "en", fr: string, en: string) {
  return lang === "fr" ? fr : en;
}

function loginNeedsAction(loginStatus: string) {
  const normalized = loginStatus.toLowerCase();
  return normalized === "needs_2fa"
    || normalized === "checkpoint"
    || normalized === "needs_assistance"
    || normalized === "session_expired"
    || normalized === "update_password"
    || normalized === "credentials_missing";
}

export function resolveClientAccountConnectionUi(
  account: ClientAccountConnectionInput,
  lang: "fr" | "en" = "fr",
): ClientAccountConnectionUi {
  const loginStatus = String(account.loginStatus || "unknown");
  const onboardingStatus = String(account.onboardingStatus || "pending");
  const readinessReady = onboardingStatus === "ready";

  if (loginNeedsAction(loginStatus)) {
    return {
      badgeLabel: label(lang, "Action requise", "Action required"),
      badgeTone: "warning",
      readinessLabel: label(lang, "Connexion à vérifier", "Connection check required"),
      readinessTone: "warning",
      readinessDisabled: false,
      connectLabel: label(lang, "Connexion à vérifier", "Connection check required"),
      connectTone: "neutral",
      connectDisabled: false,
    };
  }

  if (account.connected) {
    if (readinessReady) {
      return {
        badgeLabel: label(lang, "Compte connecté", "Account connected"),
        badgeTone: "success",
        readinessLabel: label(lang, "Préparation vérifiée", "Readiness checked"),
        readinessTone: "success",
        readinessDisabled: true,
        connectLabel: label(lang, "Connecté", "Connected"),
        connectTone: "success",
        connectDisabled: true,
      };
    }

    return {
      badgeLabel: label(lang, "Compte connecté", "Account connected"),
      badgeTone: "success",
      readinessLabel: label(lang, "Vérifier la préparation", "Check readiness"),
      readinessTone: "warning",
      readinessDisabled: false,
      connectLabel: label(lang, "Connecté", "Connected"),
      connectTone: "success",
      connectDisabled: true,
    };
  }

  return {
    badgeLabel: label(lang, "Non connecté", "Not connected"),
    badgeTone: "neutral",
    readinessLabel: label(lang, "Vérifier la préparation", "Check readiness"),
    readinessTone: "neutral",
    readinessDisabled: false,
    connectLabel: label(lang, "Connecter", "Connect"),
    connectTone: "primary",
    connectDisabled: false,
  };
}
