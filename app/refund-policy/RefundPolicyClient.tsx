import LegalPageShell, {
  type LegalPageContent,
  type LegalSection,
} from "../components/LegalPageShell";

const sectionsEn: LegalSection[] = [
  {
    title: "Company information",
    body: [
      "Boost My Businesses Ltd is registered in England and Wales under Company No. 17313018. Registered office: 167-169 Great Portland Street, 5th Floor, London, W1W 5PF, United Kingdom.",
    ],
  },
  {
    title: "Scope and statutory rights",
    body: [
      "This policy applies to subscriptions and one-time services bought from Boost My Businesses Ltd. It does not limit rights that cannot be excluded by law.",
      "For UK consumers, our services and digital content are subject to the Consumer Rights Act 2015 and, for distance contracts, the Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013. For EU consumers, applicable national law implementing the Consumer Rights Directive 2011/83/EU also applies.",
      "A consumer is an individual acting mainly outside their trade, business, craft or profession. The statutory cooling-off rights below do not apply to business customers.",
    ],
  },
  {
    title: "14-day right of withdrawal",
    body: [
      "UK and EU consumers who buy online may withdraw without giving a reason within 14 days after the service contract is concluded. To exercise this right, send a clear statement to growth@boostmybusinesses.com before the period expires.",
      "If you expressly ask us to begin a service during the 14-day period and then withdraw, we may deduct or charge a proportionate amount for the service supplied up to withdrawal. If the service has been fully performed after your express request and acknowledgement, the right of withdrawal may be lost where the law permits.",
      "For digital content not supplied on a tangible medium, the withdrawal right may be lost once supply begins only if you gave prior express consent and acknowledged that consequence.",
    ],
  },
  {
    title: "Faulty or non-conforming services",
    body: [
      "Services must be performed with reasonable care and skill and match binding information provided about them. Digital content must meet the statutory standards of satisfactory quality, fitness for purpose and conformity with description.",
      "Where those standards are not met, consumers may be entitled to repeat performance, repair or replacement, a price reduction or refund, as applicable. We will not refuse a remedy that the law requires.",
    ],
  },
  {
    title: "Subscriptions and cancellations",
    body: [
      "You may cancel a subscription to prevent future renewal by contacting us before the renewal date. Access normally continues until the end of the paid period.",
      "After the statutory withdrawal period, unused time is not normally refunded unless the service is faulty, we fail to deliver it, we agree otherwise in writing, or applicable law requires a refund. Duplicate charges and confirmed billing errors will be refunded.",
    ],
  },
  {
    title: "Custom and one-time work",
    body: [
      "For strategy, setup, implementation, consulting or custom work, the order will identify the deliverables and start date. If a consumer validly withdraws after asking us to start, the refund may be reduced by the proportion already supplied. Any exception to withdrawal rights will apply only where legally available and clearly disclosed before purchase.",
    ],
  },
  {
    title: "How to request a cancellation or refund",
    body: ["Send your request to:"],
    contact: "growth@boostmybusinesses.com",
    contactPlacement: "beforeList",
    bodyAfterContact: ["Please include:"],
    list: [
      "your full name and purchase email",
      "the service, plan and order or invoice reference",
      "the purchase date",
      "whether you are withdrawing, cancelling renewal or reporting a service problem",
      "a short explanation and any relevant evidence for a fault or billing error",
    ],
  },
  {
    title: "Refund timing and method",
    body: [
      "Where a consumer validly withdraws, we will issue the amount due without undue delay and no later than 14 days after being informed of the decision to withdraw. Unless otherwise agreed, we use the original payment method and do not charge a refund fee. Your bank or payment provider may need additional time to display the credit.",
      "Other approved refunds are normally initiated within 5 to 10 business days.",
    ],
  },
];

const sectionsFr: LegalSection[] = [
  {
    title: "Identification de la société",
    body: [
      "Boost My Businesses Ltd est immatriculée en Angleterre et au Pays de Galles sous le numéro 17313018. Siège social : 167-169 Great Portland Street, 5th Floor, London, W1W 5PF, Royaume-Uni.",
    ],
  },
  {
    title: "Champ d'application et droits légaux",
    body: [
      "Cette politique s'applique aux abonnements et prestations ponctuelles achetés auprès de Boost My Businesses Ltd. Elle ne limite aucun droit auquel la loi interdit de renoncer.",
      "Pour les consommateurs britanniques, nos services et contenus numériques relèvent du Consumer Rights Act 2015 et, pour les contrats à distance, des Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013. Pour les consommateurs de l'UE, le droit national transposant la directive 2011/83/UE relative aux droits des consommateurs s'applique également.",
      "Un consommateur est une personne physique agissant principalement hors de son activité professionnelle. Le droit de rétractation ci-dessous ne s'applique pas aux clients professionnels.",
    ],
  },
  {
    title: "Droit de rétractation de 14 jours",
    body: [
      "Les consommateurs du Royaume-Uni et de l'Union européenne qui achètent en ligne peuvent se rétracter sans motif dans les 14 jours suivant la conclusion du contrat de service. Envoyez une déclaration claire à growth@boostmybusinesses.com avant l'expiration du délai.",
      "Si vous demandez expressément le démarrage du service pendant ces 14 jours puis vous rétractez, nous pouvons déduire ou facturer un montant proportionnel à la prestation déjà fournie. Si le service a été pleinement exécuté après votre demande expresse et votre reconnaissance de cette conséquence, le droit peut être perdu lorsque la loi le permet.",
      "Pour un contenu numérique sans support matériel, le droit peut être perdu après le début de la fourniture uniquement si vous avez donné votre consentement exprès préalable et reconnu cette conséquence.",
    ],
  },
  {
    title: "Service défectueux ou non conforme",
    body: [
      "Les services doivent être fournis avec diligence et compétence raisonnables et respecter les informations contractuelles. Les contenus numériques doivent satisfaire aux exigences légales de qualité, d'adaptation à l'usage et de conformité à leur description.",
      "En cas de non-conformité, le consommateur peut avoir droit à une nouvelle exécution, réparation ou remplacement, réduction du prix ou remboursement selon le cas. Nous ne refuserons aucun recours imposé par la loi.",
    ],
  },
  {
    title: "Abonnements et annulation",
    body: [
      "Vous pouvez annuler un abonnement pour empêcher son prochain renouvellement en nous contactant avant la date concernée. L'accès continue normalement jusqu'à la fin de la période payée.",
      "Après le délai légal de rétractation, le temps non utilisé n'est normalement pas remboursé, sauf service défectueux ou non fourni, accord écrit de notre part ou obligation légale. Les doubles débits et erreurs de facturation confirmées sont remboursés.",
    ],
  },
  {
    title: "Prestations ponctuelles ou sur mesure",
    body: [
      "Pour le conseil, la stratégie, la configuration, l'implémentation ou les travaux sur mesure, la commande précise les livrables et le début d'exécution. Si un consommateur se rétracte valablement après avoir demandé le démarrage, le remboursement peut être réduit au prorata de la prestation fournie. Toute exception au droit de rétractation ne s'applique que si elle est légalement possible et clairement annoncée avant l'achat.",
    ],
  },
  {
    title: "Demander une annulation ou un remboursement",
    body: ["Envoyez votre demande à :"],
    contact: "growth@boostmybusinesses.com",
    contactPlacement: "beforeList",
    bodyAfterContact: ["Merci d'indiquer :"],
    list: [
      "votre nom complet et l'email utilisé pour l'achat",
      "le service, la formule et la référence de commande ou facture",
      "la date d'achat",
      "s'il s'agit d'une rétractation, d'une annulation de renouvellement ou d'un problème de service",
      "une brève explication et tout justificatif utile en cas de défaut ou d'erreur de facturation",
    ],
  },
  {
    title: "Délai et mode de remboursement",
    body: [
      "Lorsqu'un consommateur se rétracte valablement, nous remboursons la somme due sans retard injustifié et au plus tard 14 jours après avoir été informés de sa décision. Sauf accord contraire, le moyen de paiement initial est utilisé sans frais de remboursement. La banque ou le prestataire de paiement peut mettre plus de temps à afficher le crédit.",
      "Les autres remboursements acceptés sont normalement initiés sous 5 à 10 jours ouvrés.",
    ],
  },
];

const content: Record<"fr" | "en", LegalPageContent> = {
  en: {
    title: "Refund and Cancellation Policy",
    intro: "Cancellation, withdrawal and refund rules for Boost My Businesses Ltd services. Effective date: 30 June 2026.",
    sections: sectionsEn,
  },
  fr: {
    title: "Politique de remboursement et d'annulation",
    intro: "Règles d'annulation, de rétractation et de remboursement applicables aux services de Boost My Businesses Ltd. Date d'entrée en vigueur : 30 juin 2026.",
    sections: sectionsFr,
  },
};

export default function RefundPolicyClient() {
  return <LegalPageShell content={content} />;
}
