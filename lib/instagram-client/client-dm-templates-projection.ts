import { OUTREACH_ADDONS, type OutreachAddonKey } from "../commercial/catalog.ts";
import type { DmDomainProjection } from "../instagram-dashboard/dm-domain-service.ts";

export const DM_USERNAME_VARIABLE = "{{username}}";

export type ClientDmTemplateCardProjection = {
  locked: boolean;
  canConfigure: boolean;
  enabled: boolean;
  message: string;
  lockedTitleFr: string;
  lockedTitleEn: string;
  lockedBodyFr: string;
  lockedBodyEn: string;
  ctaLabelFr: string;
  ctaLabelEn: string;
  ctaPath: string | null;
  unavailableReason: string | null;
};

export type ClientDmTemplatesProjection = {
  accountId: string;
  username: string;
  packageCode: string;
  usernameVariable: typeof DM_USERNAME_VARIABLE;
  canConfigureWelcome: boolean;
  canConfigureOutreach: boolean;
  welcomeUpgradePath: string | null;
  outreachActivationPath: string | null;
  outreachUnavailableReason: string | null;
  welcome: ClientDmTemplateCardProjection;
  outreach: ClientDmTemplateCardProjection;
};

const DEFAULT_OUTREACH_ADDON_KEY: OutreachAddonKey = "outreach_standard";

export function resolveOutreachActivationOffer() {
  const addon = OUTREACH_ADDONS[DEFAULT_OUTREACH_ADDON_KEY];
  if (!addon?.addonKey || !Number.isFinite(addon.baseMonthlyPriceCents) || addon.baseMonthlyPriceCents <= 0) {
    return {
      available: false,
      reason: "outreach_offer_not_configured" as const,
      addonKey: null,
      baseMonthlyPriceCents: null,
    };
  }
  return {
    available: true,
    reason: null,
    addonKey: addon.addonKey,
    baseMonthlyPriceCents: addon.baseMonthlyPriceCents,
    displayNameFr: addon.displayNameFr,
    displayNameEn: addon.displayNameEn,
  };
}

export function buildWelcomeUpgradePath() {
  return "/instagram-client/change-plan?intention=welcome_dm&target=pro";
}

export function buildOutreachActivationPath(accountId: string) {
  const normalizedAccountId = accountId.trim();
  if (!normalizedAccountId) return null;
  const offer = resolveOutreachActivationOffer();
  if (!offer.available) return null;
  const params = new URLSearchParams({
    account_id: normalizedAccountId,
    addon: offer.addonKey ?? DEFAULT_OUTREACH_ADDON_KEY,
  });
  return `/instagram-client/activate-outreach?${params.toString()}`;
}

export function projectClientDmTemplates(input: {
  accountId: string;
  username: string;
  packageCode: string;
  domain: DmDomainProjection;
}): ClientDmTemplatesProjection {
  const canConfigureWelcome = input.domain.welcome_service_active === true;
  const canConfigureOutreach = input.domain.outreach_service_active === true;
  const welcomeUpgradePath = canConfigureWelcome ? null : buildWelcomeUpgradePath();
  const outreachOffer = resolveOutreachActivationOffer();
  const outreachActivationPath = canConfigureOutreach ? null : buildOutreachActivationPath(input.accountId);
  const outreachUnavailableReason = canConfigureOutreach
    ? null
    : outreachOffer.available
      ? null
      : outreachOffer.reason;

  return {
    accountId: input.accountId,
    username: input.username,
    packageCode: input.packageCode,
    usernameVariable: DM_USERNAME_VARIABLE,
    canConfigureWelcome,
    canConfigureOutreach,
    welcomeUpgradePath,
    outreachActivationPath,
    outreachUnavailableReason,
    welcome: {
      locked: !canConfigureWelcome,
      canConfigure: canConfigureWelcome,
      enabled: input.domain.welcome_enabled,
      message: input.domain.welcome_message,
      lockedTitleFr: "Message de bienvenue",
      lockedTitleEn: "Welcome message",
      lockedBodyFr: "Passez à Pro pour envoyer un message de bienvenue à tous vos nouveaux abonnés.",
      lockedBodyEn: "Upgrade to Pro to send a welcome message to all your new followers.",
      ctaLabelFr: "Passer à Pro",
      ctaLabelEn: "Upgrade to Pro",
      ctaPath: welcomeUpgradePath,
      unavailableReason: null,
    },
    outreach: {
      locked: !canConfigureOutreach,
      canConfigure: canConfigureOutreach,
      enabled: input.domain.outreach_enabled,
      message: input.domain.outreach_message,
      lockedTitleFr: "Prospection Instagram",
      lockedTitleEn: "Instagram outreach",
      lockedBodyFr: "Activez la prospection Instagram pour atteindre jusqu'à 30 prospects par jour.",
      lockedBodyEn: "Activate Instagram outreach to reach up to 30 prospects per day.",
      ctaLabelFr: "Activer la prospection",
      ctaLabelEn: "Activate outreach",
      ctaPath: outreachActivationPath,
      unavailableReason: outreachUnavailableReason,
    },
  };
}

export function assertClientCanConfigureWelcome(domain: DmDomainProjection) {
  if (domain.welcome_service_active !== true) {
    return {
      ok: false as const,
      status: 403,
      code: "welcome_dm_locked",
      error: "Welcome DM is not available on your current plan.",
    };
  }
  return { ok: true as const };
}

export function assertClientCanConfigureOutreach(domain: DmDomainProjection) {
  if (domain.outreach_service_active !== true) {
    return {
      ok: false as const,
      status: 403,
      code: "outreach_dm_locked",
      error: "Outreach is not activated for this Instagram account.",
    };
  }
  return { ok: true as const };
}
