import LegalPageShell, {
  type LegalPageContent,
  type LegalSection,
} from "../components/LegalPageShell";

const addressEn = "167-169 Great Portland Street, 5th Floor, London, W1W 5PF, United Kingdom";
const addressFr = "167-169 Great Portland Street, 5th Floor, London, W1W 5PF, Royaume-Uni";

const sectionsEn: LegalSection[] = [
  {
    title: "Company and acceptance",
    body: [
      `These Terms govern the website and services supplied by Boost My Businesses Ltd, a limited company registered in England and Wales under Company No. 17313018, with its registered office at ${addressEn}.`,
      "By ordering or using a service, you agree to these Terms. If you order on behalf of an organisation, you confirm that you have authority to bind it. Mandatory consumer rights remain unaffected.",
    ],
  },
  {
    title: "Our services",
    body: [
      "We provide AI-powered automation, software access, implementation, consulting and managed digital services. The exact scope, deliverables, service period and price are set out on the relevant product page, checkout, proposal or order confirmation.",
    ],
    list: [
      "Instagram Growth: managed audience targeting, campaign activity and reporting",
      "UGC Ads Engine: AI-assisted content and advertising workflows",
      "WhatsApp Lead System: lead qualification, response and routing automation",
      "AI Call Assistant: automated call handling and related analytics",
      "custom AI agents, integrations, workflow automation and consulting",
    ],
  },
  {
    title: "Your responsibilities",
    body: ["You must:"],
    list: [
      "provide accurate information and keep account credentials secure",
      "use the services lawfully and only for authorised business purposes",
      "have all necessary rights and notices for data or content you provide",
      "not interfere with, reverse engineer, abuse or compromise our systems",
      "comply with the terms of connected third-party platforms, including Meta and Instagram",
    ],
  },
  {
    title: "Orders, subscriptions and payment",
    body: [
      "Prices, billing frequency and taxes are shown before purchase. Subscriptions renew for the period shown at checkout until cancelled. You authorise our payment provider to collect amounts due.",
      "You may cancel future renewal by contacting us before the renewal date. Cancellation takes effect at the end of the paid period unless applicable consumer law or the Refund Policy gives you an earlier right.",
      "We may suspend service for overdue amounts after reasonable notice. We may change future prices or service features by giving reasonable advance notice; changes do not retrospectively alter a paid fixed term.",
    ],
  },
  {
    title: "Third-party platforms",
    body: [
      "Some services interoperate with third-party platforms. We are not affiliated with or endorsed by Meta or Instagram. Their availability, rules and enforcement decisions are outside our control, and you remain responsible for complying with their terms.",
    ],
  },
  {
    title: "Performance and results",
    body: [
      "We will perform services with reasonable care and skill. Unless expressly included in an order, we do not guarantee a specific number of followers, leads, bookings, sales, revenue or other commercial outcome because results depend on factors outside our control.",
    ],
  },
  {
    title: "Intellectual property",
    body: [
      "We and our licensors retain ownership of our platform, branding, methods, templates and pre-existing materials. Subject to payment, you may use deliverables created specifically for you for the purposes stated in the order. You retain ownership of content and data you provide and grant us the limited rights needed to deliver the services.",
    ],
  },
  {
    title: "Liability",
    body: [
      "Nothing in these Terms excludes or limits liability that cannot lawfully be excluded, including liability for death or personal injury caused by negligence, fraud or fraudulent misrepresentation, or your mandatory statutory rights.",
      "For business customers, to the fullest extent permitted by law, neither party is liable for indirect or consequential loss, loss of profit, revenue, goodwill or anticipated savings. Our total aggregate liability arising from the affected service is limited to the fees paid or payable for that service in the 12 months before the event giving rise to the claim.",
      "Consumer customers retain all remedies available under applicable consumer law.",
    ],
  },
  {
    title: "Termination",
    body: [
      "You may stop using the services and cancel renewal as described above. Either party may terminate a service for a material breach that is not remedied within 14 days after written notice, or immediately where the breach cannot be remedied, continued supply would be unlawful, or the other party becomes insolvent.",
      "We may suspend or terminate access immediately where reasonably necessary to protect users or systems from fraud, abuse, a security threat or unlawful activity. On termination, outstanding fees become due and provisions intended to survive termination remain effective. We will provide reasonable access to export customer data where applicable, subject to law, security and payment obligations.",
    ],
  },
  {
    title: "Governing law and courts",
    body: [
      "These Terms of Service are governed by the laws of England and Wales. Subject to any mandatory rights available to consumers in their country of residence, the courts of England and Wales have exclusive jurisdiction.",
    ],
  },
  {
    title: "Contact",
    body: [`Boost My Businesses Ltd, ${addressEn}. Questions or legal notices may be sent to:`],
    contact: "growth@boostmybusinesses.com",
  },
];

const sectionsFr: LegalSection[] = [
  {
    title: "Société et acceptation",
    body: [
      `Les présentes Conditions régissent le site et les services fournis par Boost My Businesses Ltd, société à responsabilité limitée immatriculée en Angleterre et au Pays de Galles sous le numéro 17313018, dont le siège social est situé ${addressFr}.`,
      "En commandant ou en utilisant un service, vous acceptez ces Conditions. Si vous agissez pour une organisation, vous confirmez être habilité à l'engager. Les droits impératifs des consommateurs restent inchangés.",
    ],
  },
  {
    title: "Nos services",
    body: [
      "Nous fournissons des solutions d'automatisation par IA, accès logiciels, prestations d'implémentation, conseil et services numériques gérés. Le périmètre, les livrables, la durée et le prix figurent sur la page produit, au checkout, dans la proposition ou la confirmation de commande.",
    ],
    list: [
      "Instagram Growth : ciblage d'audience, activité de campagne et reporting gérés",
      "UGC Ads Engine : contenus et workflows publicitaires assistés par IA",
      "WhatsApp Lead System : qualification, réponse et routage automatisés des prospects",
      "AI Call Assistant : traitement automatisé des appels et analytics associés",
      "agents IA, intégrations, automatisations et conseil sur mesure",
    ],
  },
  {
    title: "Vos responsabilités",
    body: ["Vous devez :"],
    list: [
      "fournir des informations exactes et protéger vos identifiants",
      "utiliser les services légalement et uniquement à des fins autorisées",
      "détenir les droits et fournir les informations nécessaires pour les données ou contenus transmis",
      "ne pas perturber, désassembler, détourner ou compromettre nos systèmes",
      "respecter les conditions des plateformes connectées, notamment Meta et Instagram",
    ],
  },
  {
    title: "Commandes, abonnements et paiement",
    body: [
      "Les prix, taxes et fréquences de facturation sont affichés avant l'achat. Les abonnements se renouvellent pour la période indiquée au checkout jusqu'à leur résiliation. Vous autorisez notre prestataire de paiement à encaisser les sommes dues.",
      "Vous pouvez annuler un renouvellement futur en nous contactant avant sa date. L'annulation prend effet à la fin de la période payée, sauf droit antérieur prévu par la loi applicable ou notre Politique de remboursement.",
      "Nous pouvons suspendre un service impayé après un préavis raisonnable. Toute modification future du prix ou du service fera l'objet d'un préavis raisonnable et ne modifiera pas rétroactivement une période fixe déjà payée.",
    ],
  },
  {
    title: "Plateformes tierces",
    body: [
      "Certains services interagissent avec des plateformes tierces. Nous ne sommes ni affiliés ni approuvés par Meta ou Instagram. Leur disponibilité, leurs règles et leurs décisions échappent à notre contrôle ; vous restez responsable du respect de leurs conditions.",
    ],
  },
  {
    title: "Exécution et résultats",
    body: [
      "Nous exécutons nos services avec diligence et compétence raisonnables. Sauf engagement exprès dans la commande, nous ne garantissons aucun nombre précis d'abonnés, prospects, réservations, ventes ou revenus, ces résultats dépendant de facteurs hors de notre contrôle.",
    ],
  },
  {
    title: "Propriété intellectuelle",
    body: [
      "Nous conservons, avec nos concédants, la propriété de notre plateforme, marque, méthodes, modèles et éléments préexistants. Sous réserve du paiement, vous pouvez utiliser les livrables créés pour vous aux fins prévues dans la commande. Vous conservez vos contenus et données et nous accordez les seuls droits nécessaires à la prestation.",
    ],
  },
  {
    title: "Responsabilité",
    body: [
      "Aucune clause n'exclut une responsabilité qui ne peut légalement l'être, notamment en cas de décès ou dommage corporel causé par négligence, fraude ou déclaration frauduleuse, ni vos droits légaux impératifs.",
      "Pour les clients professionnels et dans les limites de la loi, aucune partie ne répond des pertes indirectes, consécutives, de bénéfice, chiffre d'affaires, réputation ou économies attendues. Notre responsabilité totale liée au service concerné est plafonnée aux sommes payées ou dues pour ce service au cours des 12 mois précédant le fait générateur.",
      "Les clients consommateurs conservent tous les recours prévus par le droit de la consommation applicable.",
    ],
  },
  {
    title: "Résiliation",
    body: [
      "Vous pouvez cesser d'utiliser les services et annuler leur renouvellement comme indiqué ci-dessus. Chaque partie peut résilier en cas de manquement substantiel non corrigé sous 14 jours après notification écrite, ou immédiatement si le manquement est irréparable, si la prestation devient illégale ou en cas d'insolvabilité.",
      "Nous pouvons suspendre ou résilier immédiatement lorsque cela est raisonnablement nécessaire pour protéger les utilisateurs ou systèmes contre la fraude, les abus, une menace de sécurité ou une activité illégale. À la fin du contrat, les sommes dues deviennent exigibles et les clauses destinées à survivre restent applicables. Lorsque pertinent, nous permettons un export raisonnable des données client, sous réserve de la loi, de la sécurité et des paiements dus.",
    ],
  },
  {
    title: "Droit applicable et juridiction",
    body: [
      "Les présentes Conditions d'utilisation sont régies par les lois de l'Angleterre et du Pays de Galles. Sous réserve des droits impératifs dont bénéficie un consommateur dans son pays de résidence, les tribunaux d'Angleterre et du Pays de Galles sont seuls compétents.",
    ],
  },
  {
    title: "Contact",
    body: [`Boost My Businesses Ltd, ${addressFr}. Les questions et notifications juridiques peuvent être envoyées à :`],
    contact: "growth@boostmybusinesses.com",
  },
];

const content: Record<"fr" | "en", LegalPageContent> = {
  en: {
    title: "Terms of Service",
    intro: "Terms governing access to and use of Boost My Businesses Ltd services. Effective date: 30 June 2026.",
    sections: sectionsEn,
  },
  fr: {
    title: "Conditions d'utilisation",
    intro: "Conditions régissant l'accès aux services de Boost My Businesses Ltd et leur utilisation. Date d'entrée en vigueur : 30 juin 2026.",
    sections: sectionsFr,
  },
};

export default function TermsAndConditionsClient() {
  return <LegalPageShell content={content} />;
}
