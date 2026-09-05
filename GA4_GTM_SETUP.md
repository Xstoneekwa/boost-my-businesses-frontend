# GA4 + GTM + Consent Mode v2 — BMB

## Identifiants confirmés

- Conteneur GTM Web : **GTM-TW42V8MQ**.
- Flux GA4 : **G-BFWT2ZDXJ1**.
- Aucun autre ID, aucun script GA4 direct, aucun Vercel Analytics ni Meta Pixel ajouté.

## Architecture de la Preview

Installation unique dans le layout global : bootstrap Consent Mode puis GTM en head (Next Script beforeInteractive, chargement réseau asynchrone). Le noscript est le premier enfant applicatif du body, avant tout contenu ; React 19 ajoute lui-même un marqueur Suspense vide et caché devant. Aucune installation supplémentaire dans les pages ni dans l’iframe Instagram.

La bannière native FR/EN propose Tout refuser, Personnaliser et Tout accepter, sans cases précochées. Les catégories sont analytics et publicité ; la seconde pilote ensemble ad_storage, ad_user_data et ad_personalization. Le bouton permanent Confidentialité / Privacy choices permet de modifier ou retirer son choix.

Les quatre paramètres sont denied AVANT le chargement du conteneur. Le choix explicite déclenche consent update sur place, sans rechargement ni page_view manuelle. Cookie nécessaire bmb_consent_v1, versionné, durée 180 jours, SameSite=Lax, Secure en HTTPS, sans identifiant visiteur. Valeurs invalides/expirées : retour au refus. Le retrait efface aussi les cookies Google analytics/publicitaires de première partie reconnus et la session UTM du bridge. Aucun cookie d’authentification n’est touché.

Mode avancé : GTM est chargé globalement avec stockage refusé par défaut. Des pings sans cookies peuvent exister lorsque la Google tag est configurée ; ce n’est pas une promesse de zéro transmission avant choix. La bannière l’indique. Aucun tag publicitaire n’est ajouté. Les tags du conteneur doivent respecter les règles de consentement ; les balises non-Google nécessitent leur propre contrôle.

Le noscript passe par /analytics/gtm-noscript : sans JavaScript, on ne peut pas appliquer les quatre commandes sélectives. Le endpoint ne redirige vers le vrai iframe GTM que si un choix explicite valide a déjà accepté TOUTES les catégories. Absence de choix, refus, consentement partiel ou expiré : HTTP 204, aucune requête Google. Réponse privée no-store, noindex, sans referrer ; aucune modification des API produit. Cette protection remplace volontairement un iframe Google inconditionnel.

C’est une implémentation technique native, pas une certification CMP ni un avis juridique. La politique de confidentialité et l’adéquation aux marchés réellement servis doivent être validées avant production.

## Audit du conteneur publié

Le script public GTM est HTTP 200. Au contrôle du 5 septembre 2026, il ne contient pas G-BFWT2ZDXJ1 et aucune balise Google tag / GA4 Event n’a été identifiée dans la version publique. Aucun changement de configuration distant n’a été effectué.

Dans GTM, auditer les tags existants puis ajouter au maximum UNE **Google tag** avec **G-BFWT2ZDXJ1** si elle est toujours absente. Conserver les mesures améliorées déjà activées par le propriétaire. Ne pas ajouter de GA4 directement au site.

La réception GA4 Realtime/DebugView ne peut pas être déclarée validée tant que cette liaison n’est pas publiée et testée. Publier un conteneur ne déploie pas le site, mais ses tags peuvent changer le comportement des pages qui l’utilisent : revalider la Preview après toute publication.

## Propriété des événements / anti-doublons

| Besoin | Mesure prévue |
|---|---|
| page_view | GA4 via GTM et mesures améliorées ; aucune copie custom envoyée |
| Formulaires | form_submit automatique si observable ; pas de second submit custom |
| Calendly sur les pages React | click sortant GA4, filtre calendly.com et page_location ; pas de second événement code |
| Calendly dans Instagram iframe | bmb_book_call : le tag parent n’observe pas les clics dans ce document |
| CTA interne | bmb_cta_click, bmb_instagram_growth_click, bmb_south_africa_click ou bmb_vertical_click selon destination |
| Offres/pricing | bmb_view_plans, exactement un événement par clic |
| Départ checkout | bmb_checkout_start, clic plan avant navigation existante |
| Booking confirmé | Non émis : exige un signal Calendly vérifiable |
| purchase / conversion paiement | Non émis : exige un paiement vérifié, un transaction_id et une déduplication |

Un clic n’est jamais un achat ou une réservation confirmée. Le déclenchement submit du navigateur ne prouve pas une acceptation serveur. Aucun prix, devise ou revenu inventé. Aucun formulaire commercial actif n’a été trouvé sur les neuf routes marketing.

Page prête, langue, FAQ et vue du pricing existent dans le diagnostic local mais ne sont pas transmis comme événements custom inutiles. Le diagnostic bmb_page_view n’est PAS poussé dans dataLayer. Les mesures améliorées GA4 ne sont ni désactivées ni doublées par ce code.

## Payload et attribution

Champs : page_path, page_type, language, source_page, source_category, analytics_consent ; selon interaction cta_name, cta_location, destination nettoyée, vertical, plan, months, billing_duration et cinq UTMs filtrés.

Aucune lecture de champs saisis, e-mails, credentials ou données Supabase. Les liens sortants custom sont nettoyés. Les événements custom sont limités aux neuf routes marketing. La présence globale du conteneur n’autorise pas automatiquement la collecte de données privées.

UTMs : mémoire d’onglet avant choix ; sessionStorage (expiration 30 minutes) uniquement si analytics accepté. Pas de stockage serveur, pas de changement checkout ni ajout de paramètres de paiement. Le filtre rejette URLs, e-mails, longues séries numériques et tokens évidents. Les campagnes doivent malgré tout suivre une convention de slugs sans données personnelles : aucun filtre ne peut détecter tout nom de personne. Pas de gclid/fbclid conservé.

Dans GTM : variables Data Layer v2 pour les champs utiles ; déclencheurs custom uniquement pour l’allowlist du tableau avec analytics_consent=granted. Pas de déclencheur manuel redondant All Clicks / History Change / Form Submission. Les tags Google utilisent leurs contrôles de consentement intégrés.

Avant production, contrôler également les valeurs automatiques GA4 : page_location/query sur auth/checkout, URLs sortantes, noms/id de formulaires. Exclure les zones privées ou assainir les valeurs selon l’audit. Les mesures améliorées ne doivent pas exposer de données personnelles. La sécurité produit et les endpoints Stripe restent inchangés.

## Recette obligatoire

1. Local : unique GTM, consent default denied antérieur à gtm.js ; refus, choix sélectif, acceptation, retrait, rechargement, navigation SPA et mobile.
2. Noscript : zéro redirection Google sans acceptation complète valide ; pas de cache partagé.
3. Preview : Tag Assistant → un conteneur ; Consent → quatre paramètres denied avant choix, mises à jour cohérentes.
4. Après liaison GA4 : Realtime/DebugView et réseau collect ; une page_view par navigation pertinente, aucun double événement, bonne propriété de destination.
5. Vérifier les mesures améliorées déjà activées, consentement refusé/retiré, données automatiques et zones privées. La validation locale de dataLayer ne remplace pas cette recette distante.
6. Contrôle frais production/tâches parallèles, owner functional review, puis promotion de la Preview exacte seulement si autorisée. Aucune production effectuée par ce lot à ce stade.

Sources primaires : [Google Analytics via GTM](https://support.google.com/tagmanager/answer/9442095), [Consent Mode natif et ordre des commandes](https://developers.google.com/tag-platform/security/guides/consent), [paramètres GA4](https://developers.google.com/analytics/devguides/collection/ga4/reference/config).
