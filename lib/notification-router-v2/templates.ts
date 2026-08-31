import type { NotificationBusinessEventInput, NotificationChannelV2, NotificationEnvironment } from "./contracts";

function text(value: unknown, fallback = "Non renseigné") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function money(value: unknown) {
  const normalized = text(value, "");
  return normalized ? `${normalized}${/€/.test(normalized) ? "" : " €"}` : "";
}

function lines(title: string, entries: Array<[string, unknown] | null>, environment: NotificationEnvironment) {
  const marker = environment === "test" ? "[Stripe Test] " : "";
  return [marker + title, "", ...entries.filter(Boolean).map((entry) => `${entry![0]} : ${text(entry![1])}`)].join("\n");
}

export function renderBusinessMessage(event: Pick<NotificationBusinessEventInput, "category" | "environment" | "eventType" | "businessPayload">) {
  const p = event.businessPayload;
  switch (event.eventType) {
    case "new_client.activated":
      return lines("✅ Nouveau client", [["Compte", p.username], ["Formule", p.plan], ["Durée", p.duration], p.amount ? ["Paiement", money(p.amount)] : null, ["Statut", "Compte activé et prêt"]], event.environment);
    case "new_client.activation_attention_required":
      return lines("⚠️ Nouveau client à vérifier", [["Compte", p.username], ["Problème", "Paiement reçu, mais l’activation du compte nécessite une vérification."], ["Action", "Vérifier l’activation du compte."]], event.environment);
    case "plan_change.completed":
      return lines("🔄 Changement de formule", [["Compte", p.username], ["Ancienne formule", p.previousPlan], ["Nouvelle formule", p.newPlan], ["Échéance", p.expiry], p.remainingCredit ? ["Avoir restant", money(p.remainingCredit)] : null, ["Statut", "Changement terminé"]], event.environment);
    case "auto_login.connected":
      return lines("✅ Connexion Instagram réussie", [["Compte", p.username], ["Formule", p.plan], ["Statut", "Connecté et prêt"]], event.environment);
    case "auto_login.wrong_password":
      return lines("⚠️ Connexion Instagram à vérifier", [["Compte", p.username], ["Problème", "Le mot de passe Instagram a été refusé."], ["Action", "Demander au client de mettre à jour son mot de passe."]], event.environment);
    case "auto_login.challenge":
      return lines("⚠️ Connexion Instagram bloquée", [["Compte", p.username], ["Problème", "Instagram demande une vérification supplémentaire."], ["Action", "Une intervention est nécessaire avant de poursuivre."]], event.environment);
    case "auto_login.identity_mismatch":
      return lines("⚠️ Connexion Instagram à vérifier", [["Compte", p.username], ["Problème", "Le compte Instagram ouvert ne correspond pas au compte attendu."], ["Action", "Vérifier l’identité du compte avant de poursuivre."]], event.environment);
    case "auto_login.device_unavailable":
      return lines("⚠️ Connexion Instagram indisponible", [["Compte", p.username], ["Problème", "Le téléphone ou l’application Instagram n’est pas disponible."], ["Action", "Vérifier la disponibilité du téléphone dans BotApp."]], event.environment);
    case "auto_login.failure":
      return lines("⚠️ Connexion Instagram à vérifier", [["Compte", p.username], ["Problème", p.summary || "La connexion Instagram n’a pas pu être terminée."], ["Action", p.action || "Consulter BotApp pour poursuivre la vérification."]], event.environment);
    case "ct_lifecycle.target_unavailable":
      return lines("⚠️ Compte cible indisponible", [["Client", p.clientUsername], ["Compte cible", p.targetUsername], ["Statut", "Ce compte cible n’est plus utilisable."], ["Action", "Un remplacement est nécessaire."]], event.environment);
    case "ct_lifecycle.target_pool_below_minimum":
      return lines("🟠 Nouveaux comptes cibles nécessaires", [["Client", p.clientUsername], ["Comptes cibles disponibles", p.availableTargets], ["Minimum recommandé", p.minimumTargets], ["Action", "Demander de nouveaux comptes cibles au client."]], event.environment);
    case "ct_lifecycle.premium_replacement_completed":
    case "ct_lifecycle.replacement_completed":
      return lines("🔄 Compte cible remplacé", [["Client", p.clientUsername], ["Ancien compte cible", p.oldTarget], ["Nouveau compte cible", p.newTarget], ["Motif", p.reason], ["Statut", "Remplacement terminé"]], event.environment);
    case "ct_lifecycle.replacement_required":
      return lines("⚠️ Remplacement de compte cible requis", [["Client", p.clientUsername], ["Compte cible", p.targetUsername], ["Motif", p.reason], ["Action", "Remplacer ce compte cible."]], event.environment);
    case "ct_lifecycle.replacement_recommended":
      return lines("🟠 Remplacement de compte cible recommandé", [["Client", p.clientUsername], ["Compte cible", p.targetUsername], ["Motif", p.reason], ["Action", "Examiner un remplacement dans BotApp."]], event.environment);
    case "ct_lifecycle.premium_replacement_stock_required":
      return lines("⚠️ Nouveaux comptes cibles Premium nécessaires", [["Client", p.clientUsername], ["Comptes disponibles", p.availableTargets], ["Action", "Ajouter de nouveaux comptes cibles avant le prochain remplacement."]], event.environment);
    case "incident.opened":
    case "incident.resolved":
      return lines(event.eventType.endsWith("resolved") ? "✅ Incident résolu" : "⚠️ Incident à traiter", [["Compte", p.username], ["Situation", p.summary], p.action ? ["Action", p.action] : null, ["Statut", event.eventType.endsWith("resolved") ? "Résolu" : "Action requise"]], event.environment);
    default:
      return lines("⚠️ Notification opérationnelle", [["Compte", p.username], ["Situation", p.summary], p.action ? ["Action", p.action] : null], event.environment);
  }
}

export function providerPayload(channel: NotificationChannelV2, message: string) {
  return channel === "slack" ? { text: message } : { content: message };
}

export function syntheticTestEvent(category: NotificationBusinessEventInput["category"], environment: NotificationEnvironment): NotificationBusinessEventInput {
  const examples: Record<NotificationBusinessEventInput["category"], Pick<NotificationBusinessEventInput, "eventType" | "businessPayload">> = {
    incident: { eventType: "incident.opened", businessPayload: { username: "@exemple", summary: "Une vérification opérationnelle est nécessaire.", action: "Consulter BotApp." } },
    new_client: { eventType: "new_client.activated", businessPayload: { username: "@exemple", plan: "Pro", duration: "3 mois", amount: "531,90 €" } },
    plan_change: { eventType: "plan_change.completed", businessPayload: { username: "@exemple", previousPlan: "Growth", newPlan: "Pro", expiry: "30 novembre 2026" } },
    auto_login: { eventType: "auto_login.connected", businessPayload: { username: "@exemple", plan: "Pro" } },
    ct_lifecycle: { eventType: "ct_lifecycle.target_unavailable", businessPayload: { clientUsername: "@client", targetUsername: "@cible" } },
  };
  return { idempotencyKey: "synthetic-preview-only", category, environment, ...examples[category] };
}
