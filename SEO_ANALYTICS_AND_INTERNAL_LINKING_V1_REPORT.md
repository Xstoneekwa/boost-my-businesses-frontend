# SEO_ANALYTICS_AND_INTERNAL_LINKING_V1

## Baseline et audit avant modification

Production vérifiée en lecture seule : `4402f85da80e99586d637fff3e96b5a25089371e`, déploiement `dpl_EuBKZaQxJskXtpaLn7fvrT6z81sK`, branche `codex/bmb-partners-v1`, READY. Parent et rollback identiques. Worktree dédié initialement propre : `codex/seo-analytics-internal-linking-v1`.

Tâches inspectées : PHONE FARM 20 + STRIPE 10 (idle, restriction/Supabase), OPTIMISER LATENCE Golden Flow (active, backend). Changements parallèles observés : target-lifecycle runtime-pipeline et anciens assets demo hors périmètre. Aucun chevauchement marketing/layout/metadata/navigation. Les quatre déploiements récents sont les versions Partners connues, aucun drift production.

Toutes les neuf pages renvoient un document rendu et n’exposent pas de directive noindex. Indexable ci-dessous signifie techniquement accessible, pas une garantie d’indexation Google.

| Page | Title actuel | Description actuelle | Canonical | H1 | Indexable | OG / X | Liens / problèmes |
|---|---|---|---|---|---|---|---|
| / | Instagram Growth & AI Automation – BMB | Managed, AI-powered Instagram growth from real phones, with complementary automation systems for calls, leads, support and content. | absent | 1 | oui | absents | Toutes les pages stratégiques accessibles via navigation/footer ; metadata incomplètes |
| /instagram-growth | Instagram Growth – Boost My Businesses | Croissance Instagram automatisée par IA. Abonnés réels, géolocalisés, sans engagement. | absent | 0 parent / 1 iframe | réserve iframe | absents | Tous les liens existent dans iframe ; doublon /index.html, langue parent en / contenu fr, footer H4 de styling |
| /instagram-growth-south-africa | Instagram Growth for South African Businesses – BMB | Managed, AI-powered Instagram growth for South African businesses using relevant audience sources and real-phone infrastructure. | absent | 1 | oui | absents | Retour produit, pricing, verticales, accueil, Partners présents |
| /instagram-growth/real-estate | Instagram Growth for Real Estate – BMB | Managed Instagram audience growth for real-estate agents, agencies, developers and property businesses. | absent | 1 | oui | absents | Liens partagés présents ; metadata incomplètes |
| /instagram-growth/beauty-aesthetics | Instagram Growth for Beauty & Aesthetics – BMB | Managed Instagram growth for salons, skincare, aesthetics, bridal and wellness businesses seeking relevant local audiences. | absent | 1 | oui | absents | Liens partagés présents ; metadata incomplètes |
| /instagram-growth/restaurants | Instagram Growth for Restaurants – BMB | Managed Instagram audience growth for restaurants, hospitality venues and local food brands. | absent | 1 | oui | absents | Liens partagés présents ; metadata incomplètes |
| /instagram-growth/fitness | Instagram Growth for Fitness Brands – BMB | Managed Instagram growth for gyms, trainers, run clubs, coaches and fitness communities. | absent | 1 | oui | absents | Liens partagés présents ; metadata incomplètes |
| /partners | Instagram Growth for Agencies & Resellers – BMB Partners | Add managed Instagram Growth to your agency. Keep your client relationship while BMB handles targeting, real-phone infrastructure and multi-account operations. | public correct | 1 | oui | OG partiel / X hérité | Accueil, Instagram, pricing, Calendly présents ; og:type absent |
| /ai-automation | AI Automation for Real Business Workflows – BMB | Explore AI call assistants, WhatsApp lead automation, support automation, UGC production and custom business workflows. | absent | 1 | oui | absents | Toutes les pages stratégiques accessibles via footer |

Titles et descriptions déjà distincts. Aucune page stratégique orpheline (9/9 accessibles depuis la homepage). Pas d’ajout de liens artificiels nécessaire. JSON-LD absent partout. Sitemap et robots : HTTP 404. Structure URL stable sans redirection sur les neuf routes testées. FR/EN via bmb_lang ; pas de versions linguistiques à URL distincte. Aucun hreflang ne sera inventé.

### Audit analytics

Aucun GA4, GTM, Meta Pixel, Vercel Analytics, SDK marketing, event bus marketing, collecte UTM ni CMP détecté dans les composants marketing, le layout, la page embarquée ou leurs scripts publics. Les dossiers restaurant-analytics concernent le produit privé, pas la mesure marketing ; ils sont hors scope. Risque de duplication actuel : non. Choix du collecteur demandé au propriétaire avant toute activation d’un nouveau service.

### Décision iframe

Conserver l’architecture et le design dans ce lot. Signaler explicitement la page embarquée à Google avec `noindex,indexifembedded`, sans bloquer son crawl ; canonical du parent propre. Pas de H1 caché ni de contenu dupliqué pour les robots. Une migration SSR native pourra être traitée séparément ; le H1 reste celui du document visible embarqué. Référence : https://developers.google.com/search/blog/2022/01/robots-meta-tag-indexifembedded?hl=en

### Localisation

Metadata stables selon la langue du rendu initial (anglais pour React ; français pour Instagram embarqué). Le choix utilisateur continue de fonctionner sans créer de faux /fr, /en ou en-ZA. Limite : une URL ne représente pas deux versions SEO indépendantes. Référence : https://developers.google.com/search/docs/specialty/international/localized-versions

## Implémentation

Registre unique `lib/marketing/seo.ts` : neuf titles/descriptions distincts, canonical public propre, OpenGraph et Twitter complets utilisant uniquement des assets BMB existants. Sitemap neuf URLs publiques ; robots autorise les pages commerciales et écarte les préfixes techniques. JSON-LD Organization, WebSite, Service et BreadcrumbList selon le contexte, sans avis, prix, adresse locale ou statistiques inventés. Le maillage existant couvre les neuf pages : aucun lien artificiel ajouté.

Les composants visuels, photos éclaircies, animations, navigation Partners, pricing et parcours checkout sont préservés. Seuls cinq H4 de styling du footer embarqué deviennent des paragraphes avec le même style. Réserve explicite : le document parent Instagram reste une enveloppe iframe sans H1 propre ; son document visible contient un H1. Cette architecture n’est pas présentée comme un rendu SSR natif.

### Analytics et consentement autorisés par le propriétaire

Stack unique GTM `GTM-TW42V8MQ` → GA4 `G-BFWT2ZDXJ1`. Aucun SDK GA4 direct, Meta Pixel ou Vercel Analytics ajouté. Installation GTM globale unique, Consent Mode v2 en amont dans le head. Noscript premier enfant applicatif du body ; React 19 préfixe automatiquement un marqueur Suspense vide/caché.

Bannière native FR/EN : tout refuser, personnaliser, tout accepter ; analytics et publicité séparés, aucun pré-cochage ; modification/retrait permanent. Quatre paramètres denied initialement ; choix explicite versionné en cookie nécessaire 180 jours. Au retrait, mise à jour denied et nettoyage des cookies Google reconnus ainsi que de l’attribution session. Mode avancé : des signaux Google sans cookies peuvent exister, sans stockage analytics/ad autorisé avant consentement. Pas de garantie juridique ni de certification CMP revendiquée.

Exception technique frontend nécessaire au consentement : `/analytics/gtm-noscript`, GET privé/no-store/noindex. Redirection vers le vrai noscript Google uniquement avec une acceptation complète encore valide ; sinon 204. Aucune API produit, base de données ou logique métier modifiée.

Événements custom audités : CTA internes, offres, départ checkout et clic Calendly depuis l’iframe (inobservable par le tag parent). Page_view, formulaires et clics sortants React sont laissés aux mesures améliorées GA4, sans duplication custom. Langue, FAQ et apparition du pricing restent des diagnostics locaux non transmis. Pas de purchase, réservation confirmée ni conversion inventés.

Payloads bornés : page/type/langue/source, CTA/destination nettoyée, plan/durée whitelist, verticale et UTMs filtrés. Attribution en mémoire avant consentement, sessionStorage 30 minutes après analytics accepté. Aucun champ de formulaire ni donnée privée lu. Détails et configuration GTM : `GA4_GTM_SETUP.md`.

### Liaison distante encore à valider

Le conteneur public GTM répond 200 mais son code ne contient pas encore `G-BFWT2ZDXJ1` au dernier contrôle. Aucune balise distante n’a été créée ou publiée par ce lot. La présence du conteneur et le runtime Consent sont vérifiables ; GA4 Realtime, Tag Assistant connecté au compte et les requêtes de collecte finales ne sont pas déclarés validés. Créer/auditer une seule Google tag dans GTM, conserver les mesures améliorées et revalider la Preview avant production.

## Vérifications locales

- Build complet `npm run build` : PASS, 46 pages générées ; compilation et contrôle TypeScript du build réussis.
- Typecheck autonome `npx tsc --noEmit` : FAIL préexistant ; sortie strictement identique octet par octet à la baseline (346 lignes), aucun diagnostic ajouté. Aucun contournement de configuration ajouté.
- Tests ciblés : 8/8 PASS (SEO, schémas, classification des CTA, UTMs, iframe, GTM unique, consentement, gate noscript).
- Lint ciblé : 0 erreur, seul avertissement historique des polices du layout.
- `git diff --check` : PASS.
- Recette locale neuf routes × desktop/mobile390 : 18/18 PASS, FR/EN testés sur chaque route, un événement diagnostic par clic pertinent, 0 nouvelle erreur console, pas d’overflow.
- Sitemap/robots HTTP200, neuf URLs publiques uniquement. Un GTM global, aucun GA4 installé directement.
- Consentement navigateur : défaut denied avant gtm.js, analytics seul, persistance, acceptation totale et refus/retrait vérifiés sur les quatre états Google effectifs. Noscript testé pour absence, refus, choix partiel, invalide, expiré et acceptation complète.

Les scripts reproductibles sont `scripts/verify-marketing-foundation.mjs [baseURL]` et `scripts/verify-marketing-consent.mjs [baseURL]`. Les sondes CTA bloquent la navigation pour ne créer ni paiement ni réservation. Le bon href et l’événement avant navigation sont contrôlés ; un checkout réel n’est pas exécuté.

## Gate parallèle et limites

Production recontrôlée : même SHA et même deployment qu’à la baseline. Branche distante Partners identique. Aucun déploiement frontend plus récent observé. Tous les worktrees existants inspectés : deltas parallèles dans les anciens assets demo, target-lifecycle et migrations/tests backend/Supabase, sans chevauchement avec ce lot. Tâches visibles : PHONE FARM 20 + STRIPE 10 idle et OPTIMISER LATENCE Golden Flow actif sur le backend ; la lecture détaillée de cette dernière a expiré, puis le snapshot a été indisponible. Cette limite n’est pas assimilée à une validation distante de son contenu ; l’absence de chevauchement est établie par les fichiers/worktrees et déploiements inspectés.

Performance : aucune dépendance/illustration ajoutée ; chargement GTM asynchrone, bannière fixe sans déplacement de contenu. Le conteneur Google ajoute son poids réseau (environ 331 Ko non compressés au contrôle) ; pas de mesure terrain Core Web Vitals permettant d’affirmer zéro régression. Aucun budget publicitaire ni CMP externe ajouté.

Avant production : vérifier la Google tag dans GTM, mesures améliorées et absence de double page_view réel ; auditer les valeurs automatiques page_location/URLs/formulaires sur les zones privées ; valider la politique de confidentialité ; obtenir l’accord propriétaire ; refaire le gate lineage/drift immédiatement avant toute promotion de la Preview exacte. Sans ces conditions : HOLD.

## Statut avant création de la Preview

Les champs de collecte distants restent volontairement PENDING : un contrôle de dataLayer n’est pas un contrôle de réception GA4.

```text
SEO_ANALYTICS_AND_INTERNAL_LINKING_V1=PREVIEW_CANDIDATE
PRODUCTION_BASELINE_SHA=4402f85da80e99586d637fff3e96b5a25089371e
PRODUCTION_DEPLOYMENT_BEFORE=dpl_EuBKZaQxJskXtpaLn7fvrT6z81sK
PARALLEL_TASKS_CHECKED=YES_WITH_THREAD_DETAIL_LIMITATION
OVERLAPPING_FILES_DETECTED=NO
PRODUCTION_DRIFT_DETECTED=NO
SEO_AUDIT=PASS
UNIQUE_TITLES=PASS
UNIQUE_META_DESCRIPTIONS=PASS
CANONICAL_TAGS=PASS
HEADINGS_STRUCTURE=PASS_VISIBLE_DOCUMENT_WITH_IFRAME_RESERVATION
OPEN_GRAPH=PASS
TWITTER_METADATA=PASS
SITEMAP=PASS
ROBOTS_TXT=PASS
STRUCTURED_DATA=PASS
BREADCRUMBS=PASS
HREFLANG_IMPLEMENTED=NO
HREFLANG_STATUS=SAME_URL_LANGUAGE_SWITCH_NO_CRAWLABLE_LANGUAGE_VARIANTS
ORPHAN_STRATEGIC_PAGES=0
INTERNAL_LINKING=PASS
CURRENT_ANALYTICS_STACK=GTM_ONLY_NATIVE_CONSENT_MODE_V2_GA4_TAG_PENDING
ANALYTICS_IMPLEMENTATION=LOCAL_PASS_REMOTE_VALIDATION_PENDING
EVENT_NAMING_DOCUMENTED=YES
PAGE_VIEW_TRACKING=PENDING_GA4_ENHANCED_MEASUREMENT_VALIDATION
CTA_CLICK_TRACKING=LOCAL_PASS
VIEW_PLANS_TRACKING=LOCAL_PASS
BOOK_CALL_TRACKING=LOCAL_IFRAME_PASS_REACT_GA4_PENDING
PARTNER_CALL_TRACKING=PENDING_GA4_OUTBOUND_CLICK
CHECKOUT_START_TRACKING=LOCAL_PASS_NO_PAYMENT_EXECUTED
LANGUAGE_TRACKING=DEBUG_ONLY_NOT_SENT
DOUBLE_EVENT_DETECTED=NO_LOCAL_REMOTE_GA4_PENDING
UTM_HANDLING_STATUS=FILTERED_MEMORY_THEN_CONSENT_GATED_SESSION
PERFORMANCE_REGRESSION_DETECTED=NO_OBSERVED_LAYOUT_REGRESSION_FIELD_METRICS_NOT_MEASURED
NEW_CONSOLE_ERRORS=0
STRIPE_CHANGED=NO
CHECKOUT_LOGIC_CHANGED=NO
SUPABASE_CHANGED=NO
BACKEND_CHANGED=NO_PRODUCT_CHANGE_FRONTEND_NOSCRIPT_GATE_ADDED
WORKER_CHANGED=NO
BOTAPP_CHANGED=NO
LINT=PASS_WITH_ONE_BASELINE_WARNING
TYPECHECK=BASELINE_FAILURE_IDENTICAL_NO_NEW_DIAGNOSTIC
TESTS=8_OF_8_PASS
BUILD=PASS
PREVIEW_SMOKE=PENDING_DEPLOYMENT
PRODUCTION_SMOKE=NOT_DEPLOYED
CANDIDATE_PARENT_SHA=4402f85da80e99586d637fff3e96b5a25089371e
CANDIDATE_SHA=RESOLVE_FROM_COMMIT_CONTAINING_THIS_REPORT
PREVIEW_DEPLOYMENT_ID=PENDING_DEPLOYMENT
PRODUCTION_DEPLOYMENT_AFTER=UNCHANGED
ROLLBACK_SHA=4402f85da80e99586d637fff3e96b5a25089371e
ROLLBACK_DEPLOYMENT_ID=dpl_EuBKZaQxJskXtpaLn7fvrT6z81sK
ROLLBACK_PATH_READY=YES
OWNER_FUNCTIONAL_REVIEW_REQUIRED=YES
DOCUMENTATION_FILE=SEO_ANALYTICS_AND_INTERNAL_LINKING_V1_REPORT.md
FAIT=SEO_FOUNDATION_NATIVE_CONSENT_GTM_LOCAL_VALIDATION
EN_COURS=PREVIEW_VALIDATION
EN_ATTENTE=GOOGLE_TAG_CONFIGURATION_REALTIME_OWNER_REVIEW_FINAL_DRIFT_GATE
FINAL_VERDICT=HOLD_PRODUCTION
NEXT_ACTION=PREVIEW_ONLY_THEN_GOOGLE_TAG_AND_OWNER_VALIDATION
```
