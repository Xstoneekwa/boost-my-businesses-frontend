import {
  formatProvisioningSlotFranceTime,
  type ClientProvisioningSlotReservationRow,
} from "../instagram-dashboard/client-provisioning-slot-presentation.ts";

export type ClientProvisioningSlotLang = "fr" | "en";

const MESSAGES = {
  phonesBusyTitle: {
    fr: "Tous nos téléphones sont occupés.",
    en: "All phones are currently busy.",
  },
  phonesBusyBody: {
    fr: "Votre connexion est réservée à {time}, heure de France.\nVous avez 30 minutes pour connecter votre compte.",
    en: "Your connection is reserved for {time}, France time.\nYou have 30 minutes to connect your account.",
  },
  connectAtTime: {
    fr: "Connecter à {time}",
    en: "Connect at {time}",
  },
  connectNow: {
    fr: "Connecter maintenant",
    en: "Connect now",
  },
  assistedConnect: {
    fr: "Laisser notre équipe connecter mon compte",
    en: "Let our team connect your account",
  },
  assistedAlreadyRequested: {
    fr: "Notre équipe a bien reçu votre demande.",
    en: "Our team has received your request.",
  },
  reservationExpired: {
    fr: "Votre créneau de connexion a expiré. Relancez une vérification pour obtenir une nouvelle disponibilité.",
    en: "Your connection window has expired. Run a new readiness check to get another availability.",
  },
  noSlotAvailable: {
    fr: "Aucun créneau de connexion n'est disponible pour le moment. Vous pouvez demander l'aide de notre équipe.",
    en: "No connection slot is available right now. You can ask our team to connect your account.",
  },
} as const;

function interpolate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  );
}

export function clientProvisioningSlotMessage(
  key: keyof typeof MESSAGES,
  lang: ClientProvisioningSlotLang,
  values: Record<string, string> = {},
) {
  return interpolate(MESSAGES[key][lang], values);
}

export function buildProvisioningSlotClientProjection(input: {
  reservation: ClientProvisioningSlotReservationRow;
  lang: ClientProvisioningSlotLang;
  now?: Date;
  assistedRequested?: boolean;
}) {
  const now = input.now ?? new Date();
  const expiresMs = Date.parse(input.reservation.expires_at);
  const expired = Number.isFinite(expiresMs) && expiresMs <= now.getTime();
  const franceTime = formatProvisioningSlotFranceTime(input.reservation.window_start_utc, input.lang);
  const windowOpen = !expired && Date.parse(input.reservation.window_start_utc) <= now.getTime()
    && Date.parse(input.reservation.window_end_utc) > now.getTime();

  return {
    reservation_id: input.reservation.id,
    window_start_utc: input.reservation.window_start_utc,
    window_end_utc: input.reservation.window_end_utc,
    expires_at: input.reservation.expires_at,
    status: expired ? "expired" : input.reservation.status,
    window_open: windowOpen,
    assisted_requested: input.assistedRequested === true
      || input.reservation.status === "assisted_requested"
      || Boolean(input.reservation.assisted_connect_requested_at),
    france_time_label: franceTime,
    title: clientProvisioningSlotMessage("phonesBusyTitle", input.lang),
    body: expired
      ? clientProvisioningSlotMessage("reservationExpired", input.lang)
      : clientProvisioningSlotMessage("phonesBusyBody", input.lang, { time: franceTime }),
    connect_label: windowOpen
      ? clientProvisioningSlotMessage("connectNow", input.lang)
      : clientProvisioningSlotMessage("connectAtTime", input.lang, { time: franceTime }),
    assisted_connect_label: clientProvisioningSlotMessage("assistedConnect", input.lang),
    connect_disabled: expired || !windowOpen,
    show_assisted_connect: !input.assistedRequested && input.reservation.status !== "assisted_requested",
  };
}
