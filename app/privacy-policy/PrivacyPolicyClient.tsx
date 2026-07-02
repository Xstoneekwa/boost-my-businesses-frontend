import LegalPageShell, {
  type LegalPageContent,
  type LegalSection,
} from "../components/LegalPageShell";

const companyEn =
  "Boost My Businesses Ltd, registered in England and Wales under Company No. 17313018, 167-169 Great Portland Street, 5th Floor, London, W1W 5PF, United Kingdom";
const companyFr =
  "Boost My Businesses Ltd, immatriculée en Angleterre et au Pays de Galles sous le numéro 17313018, 167-169 Great Portland Street, 5th Floor, London, W1W 5PF, Royaume-Uni";

const sectionsEn: LegalSection[] = [
  {
    title: "Who we are and scope",
    body: [
      `${companyEn} is the controller of the personal data described in this policy.`,
      "We process personal data under the UK GDPR and the Data Protection Act 2018. Where we offer services to, or monitor the behaviour of, people in the European Economic Area, the EU General Data Protection Regulation (EU GDPR) also applies.",
    ],
  },
  {
    title: "Personal data we collect",
    body: ["Depending on how you interact with us, we may collect:"],
    list: [
      "identity and contact data, such as your name, email address, telephone number and business details",
      "account and authentication data",
      "billing, subscription and transaction records (payment card details are handled by our payment provider and are not stored in full by us)",
      "communications, support requests and information submitted through forms, email or calls",
      "technical and usage data, including IP address, device/browser information, logs and cookie identifiers",
      "service data, such as call, lead, campaign, workflow and performance data",
      "for Instagram Growth, account connection data or access tokens, audience settings, activity logs, follower and engagement metrics, and campaign reports",
    ],
  },
  {
    title: "Why we use data and our lawful bases",
    body: ["We use personal data only where we have a lawful basis, including:"],
    list: [
      "contract: to create accounts, deliver services, provide support and manage subscriptions",
      "legitimate interests: to secure, operate and improve our services, prevent fraud and respond to business enquiries",
      "legal obligation: to keep tax, accounting and compliance records",
      "consent: for optional cookies and direct marketing where consent is required; consent may be withdrawn at any time",
    ],
  },
  {
    title: "How we share data",
    body: [
      "We do not sell personal data. We may share it with vetted processors where necessary to provide our services, including hosting, database, communications, analytics, automation, infrastructure and payment providers, and with professional advisers or authorities where required by law.",
      "Processors may act only on our instructions and must protect the data. For Instagram Growth, limited data may be shared with infrastructure providers needed to operate the service.",
    ],
  },
  {
    title: "International transfers",
    body: [
      "Some providers may process data outside the United Kingdom or European Economic Area. Where transfer restrictions apply, we use an applicable adequacy decision or approved contractual safeguards, such as the UK International Data Transfer Agreement/Addendum or EU Standard Contractual Clauses, together with supplementary measures where needed.",
    ],
  },
  {
    title: "How long we keep data",
    body: ["We apply the following retention periods unless a longer period is required by law or for a legal claim:"],
    list: [
      "enquiries and general correspondence: up to 24 months after the last substantive contact",
      "account, contract and core service records: while the account is active and up to 6 years after the contract ends",
      "billing, tax and transaction records: 6 years after the relevant financial year or transaction",
      "Instagram campaign credentials, tokens and operational data: while the service is active and normally deleted or anonymised within 90 days after it ends",
      "security and access logs: normally up to 12 months",
      "cookie and analytics data: for the lifetime stated by the relevant cookie or until consent is withdrawn",
    ],
  },
  {
    title: "Security",
    body: [
      "We use appropriate technical and organisational measures designed to protect personal data, including access controls and encrypted transmission. No system can guarantee absolute security.",
    ],
  },
  {
    title: "Your data protection rights",
    body: [
      "Subject to the conditions and exceptions in applicable law, you may request access to, correction or deletion of your data; restriction of or objection to processing; and a portable copy of data you provided. You may withdraw consent at any time and object at any time to direct marketing.",
      "Requests are normally free of charge and answered within one month. You may also complain to the UK Information Commissioner's Office (ICO) or, where the EU GDPR applies, to the supervisory authority in the EEA country where you live, work or believe an infringement occurred.",
    ],
  },
  {
    title: "Cookies",
    body: [
      "We use strictly necessary cookies and local storage for functions such as security, authentication, language and session management. With your consent, we may also use optional analytics or marketing cookies to understand usage and improve our services.",
      "Non-essential cookies should not be set before consent. You can reject or withdraw consent through the available cookie controls and can also manage cookies in your browser; disabling necessary cookies may affect site functionality.",
    ],
  },
  {
    title: "Privacy contact",
    body: [
      `For privacy questions or to exercise your rights, contact our data protection responsible at ${companyEn}:`,
    ],
    contact: "growth@boostmybusinesses.com",
  },
  {
    title: "Changes to this policy",
    body: [
      "We may update this policy to reflect changes to our services or the law. We will post the revised version here and highlight material changes where appropriate.",
    ],
  },
];

const sectionsFr: LegalSection[] = [
  {
    title: "Qui sommes-nous et champ d'application",
    body: [
      `${companyFr} est le responsable du traitement des données personnelles décrit dans cette politique.`,
      "Nous traitons les données conformément au UK GDPR et au Data Protection Act 2018. Lorsque nous proposons des services à des personnes situées dans l'Espace économique européen ou suivons leur comportement, le règlement général sur la protection des données de l'Union européenne (RGPD, règlement (UE) 2016/679) s'applique également.",
    ],
  },
  {
    title: "Données personnelles collectées",
    body: ["Selon votre interaction avec nous, nous pouvons collecter :"],
    list: [
      "données d'identité et de contact : nom, adresse email, téléphone et informations professionnelles",
      "données de compte et d'authentification",
      "données de facturation, d'abonnement et de transaction (les données complètes de carte sont traitées par notre prestataire de paiement et ne sont pas stockées par nous)",
      "communications, demandes d'assistance et informations transmises par formulaire, email ou appel",
      "données techniques et d'utilisation : adresse IP, appareil, navigateur, journaux et identifiants de cookies",
      "données liées aux services : appels, prospects, campagnes, workflows et performances",
      "pour Instagram Growth : données de connexion ou jetons d'accès, paramètres d'audience, journaux d'activité, métriques d'abonnés et d'engagement, et rapports de campagne",
    ],
  },
  {
    title: "Finalités et bases légales",
    body: ["Nous utilisons les données uniquement sur une base légale, notamment :"],
    list: [
      "contrat : création du compte, fourniture du service, assistance et gestion des abonnements",
      "intérêt légitime : sécurisation, exploitation et amélioration des services, prévention de la fraude et réponse aux demandes professionnelles",
      "obligation légale : conservation des documents fiscaux, comptables et de conformité",
      "consentement : cookies facultatifs et prospection lorsque le consentement est requis ; il peut être retiré à tout moment",
    ],
  },
  {
    title: "Partage des données",
    body: [
      "Nous ne vendons pas vos données. Nous pouvons les transmettre à des sous-traitants vérifiés lorsque cela est nécessaire : hébergement, base de données, communications, analytics, automatisation, infrastructure et paiement, ainsi qu'à nos conseils ou aux autorités lorsque la loi l'exige.",
      "Nos sous-traitants ne peuvent agir que sur nos instructions et doivent protéger les données. Pour Instagram Growth, des données limitées peuvent être partagées avec les prestataires d'infrastructure nécessaires au service.",
    ],
  },
  {
    title: "Transferts internationaux",
    body: [
      "Certains prestataires peuvent traiter des données hors du Royaume-Uni ou de l'Espace économique européen. Lorsque les règles sur les transferts l'exigent, nous utilisons une décision d'adéquation applicable ou des garanties contractuelles approuvées, telles que l'IDTA/Addendum britannique ou les clauses contractuelles types de l'UE, complétées si nécessaire.",
    ],
  },
  {
    title: "Durées de conservation",
    body: ["Sauf obligation légale ou contentieux imposant une durée supérieure, nous appliquons les durées suivantes :"],
    list: [
      "demandes et correspondance générale : jusqu'à 24 mois après le dernier échange substantiel",
      "compte, contrat et données principales du service : pendant l'activité du compte puis jusqu'à 6 ans après la fin du contrat",
      "facturation, fiscalité et transactions : 6 ans après l'exercice ou la transaction concernée",
      "identifiants, jetons et données opérationnelles des campagnes Instagram : pendant le service, puis suppression ou anonymisation normalement sous 90 jours",
      "journaux de sécurité et d'accès : normalement jusqu'à 12 mois",
      "cookies et analytics : pendant la durée indiquée pour chaque cookie ou jusqu'au retrait du consentement",
    ],
  },
  {
    title: "Sécurité",
    body: [
      "Nous appliquons des mesures techniques et organisationnelles appropriées, notamment des contrôles d'accès et le chiffrement des transmissions. Aucun système ne peut toutefois garantir une sécurité absolue.",
    ],
  },
  {
    title: "Vos droits",
    body: [
      "Sous réserve des conditions et exceptions légales, vous pouvez demander l'accès, la rectification ou l'effacement de vos données, la limitation du traitement, vous opposer au traitement et obtenir la portabilité des données fournies. Vous pouvez retirer votre consentement et vous opposer à tout moment à la prospection.",
      "Les demandes sont en principe gratuites et traitées sous un mois. Vous pouvez aussi saisir l'Information Commissioner's Office (ICO) au Royaume-Uni ou, lorsque le RGPD européen s'applique, l'autorité de contrôle du pays de l'EEE où vous résidez, travaillez ou estimez qu'une violation a eu lieu.",
    ],
  },
  {
    title: "Cookies",
    body: [
      "Nous utilisons des cookies et du stockage local strictement nécessaires pour la sécurité, l'authentification, la langue et les sessions. Avec votre consentement, nous pouvons utiliser des cookies facultatifs d'analyse ou de marketing afin de comprendre l'utilisation du site et d'améliorer nos services.",
      "Les cookies non essentiels ne doivent pas être déposés avant votre consentement. Vous pouvez refuser ou retirer ce consentement via les contrôles disponibles et gérer les cookies dans votre navigateur ; le blocage des cookies nécessaires peut affecter le fonctionnement du site.",
    ],
  },
  {
    title: "Contact protection des données",
    body: [
      `Pour toute question ou pour exercer vos droits, contactez le responsable de la protection des données de ${companyFr} :`,
    ],
    contact: "growth@boostmybusinesses.com",
  },
  {
    title: "Mises à jour",
    body: [
      "Nous pouvons mettre à jour cette politique pour refléter une évolution de nos services ou de la loi. La nouvelle version sera publiée ici et les changements importants seront signalés lorsque cela est approprié.",
    ],
  },
];

const content: Record<"fr" | "en", LegalPageContent> = {
  en: {
    title: "Privacy Policy",
    intro: "How Boost My Businesses Ltd collects, uses, retains and protects personal data. Effective date: 30 June 2026.",
    sections: sectionsEn,
  },
  fr: {
    title: "Politique de confidentialité",
    intro: "Comment Boost My Businesses Ltd collecte, utilise, conserve et protège les données personnelles. Date d'entrée en vigueur : 30 juin 2026.",
    sections: sectionsFr,
  },
};

export default function PrivacyPolicyClient() {
  return <LegalPageShell content={content} />;
}
