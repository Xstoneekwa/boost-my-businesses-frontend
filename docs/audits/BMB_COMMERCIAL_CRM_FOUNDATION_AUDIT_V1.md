# BMB Commercial Dashboard + Lead/CRM Foundation V1

## Statut du document

- Nature : audit en lecture seule et proposition architecturale.
- Date de vérification : 2026-08-14 (SAST).
- Code audité : `/Users/admin/Projects/boost-commercial-resume-dashboard-blocker-v1`.
- Branche / commit : `fix/commercial-resume-dashboard-blocker-v1-20260814` / `cd6c3cae0d26370b93dd3db6494decdc6075bde5`.
- Supabase vérifié : projet actif `boost-my-businesses-ai` (`zgafnshkjywfltxgbtzg`, région `eu-west-1`, PostgreSQL 17.6.1).
- Portée : schéma réel, volumes, contraintes, RLS/policies/grants, vues et fonctions pertinentes, migrations/baseline, routes/API, code serveur, écrans Admin et chemin checkout/Stripe.
- Limite : aucune inspection du Dashboard Stripe externe ni d'un runtime n8n en cours. Les auteurs n8n historiques sont établis par les commentaires de schéma et la forme des payloads, pas par l'observation d'un workflow actif le 2026-08-14.
- Tous les volumes sont un instantané et peuvent évoluer.

## 1. Executive summary

La fondation client et paiement BMB est exploitable, mais il n'existe pas encore de CRM commercial générique et canonique.

Les éléments solides à conserver sont :

- `clients.id` comme identifiant canonique du client BMB après conversion ;
- `client_users`, `client_instagram_accounts`, `client_subscriptions`, `client_account_entitlements` et les tables Stripe pour la vie post-paiement ;
- le shell Admin, ses cartes, tableaux, filtres, badges, modales et conventions d'API ;
- les patterns de journal append-only, d'idempotence, de curseur et de worker avec réservation durable.

Les tables Restaurant ne doivent pas être généralisées en place. Elles constituent un legacy utile comme corpus et comme retour d'expérience, mais leur modèle mélange business, contact, lead, campagne, message et workflow. Il existe même deux identités Restaurant parallèles (`restaurant_prospect_leads` et `restaurant_prospects`) qui ne sont pas reliées de façon canonique. La bonne option est donc **Option 3 maintenant : conserver le Restaurant CRM legacy et créer un domaine Commercial BMB séparé**, avec une éventuelle migration contrôlée plus tard.

Le domaine cible doit rester internal/founder-only avant conversion. En V1, Liam est le seul utilisateur autorisé : le rôle générique `superadmin` ne suffit pas. Un prospect ne doit pas créer prématurément un tenant, un utilisateur Auth, un client BMB ou un Stripe Customer. Au paiement confirmé, le flux existant crée/résout l'utilisateur, crée `clients`, relie `tenant_users` et `client_users`, puis crée checkout/entitlement et les projections Stripe. Une nouvelle table de conversion devra relier explicitement le lead d'origine à `clients.id`, au checkout, au Stripe Customer/subscription et éventuellement au compte Instagram, tout en gelant l'attribution d'origine.

Le principal risque de sécurité découvert concerne les vues historiques de prospection : plusieurs ont `SELECT` pour `anon` et `authenticated`, sans option `security_invoker=true`. Elles ne doivent pas être reprises pour le nouveau CRM. Les nouvelles tables doivent avoir RLS activé, droits `anon`/`authenticated` révoqués, accès `service_role` uniquement et exposition exclusivement via des routes serveur vérifiant à la fois la session, le rôle interne attendu et une permission owner explicite liée à l'UUID Auth de Liam. BotApp/relay ne doit pas accéder à cette surface en V1.

Recommandation synthétique :

```text
Architecture = nouveau domaine commercial founder-only, relié au domaine client uniquement lors de la conversion
Restaurant = KEEP_LEGACY
Customer identity = clients.id
State = statuts orthogonaux + événements append-only + transitions atomiques
Attribution = immutable conversion snapshot + clés étrangères vers lead/client/checkout/Stripe
Dashboard = nouvelle route dans le shell Admin, UI existante adaptée
Automation = files durables/idempotentes, arrêt ferme sur SALES_QUALIFIED_RESPONSE
```

## 2. Existing Supabase inventory

### 2.1 CRM/prospection historique

| Objet | Type / volume | Rôle et colonnes importantes | Relations / ownership | Lecteurs et auteurs observés | RLS / risques | Décision |
|---|---:|---|---|---|---|---|
| `restaurant_prospect_leads` | table, 67 | Lead Restaurant aplati : `external_id`, `campaign_id`, coordonnées, score, priorité, statut, `analysis`, `outreach` | Aucun `client_id`/`tenant_id`; aucun FK vers `restaurant_prospects` | Écriture historique n8n documentée dans le baseline; aucun writer applicatif actuel trouvé | RLS actif, aucune policy, mais grants larges; dépend du service role | `KEEP_LEGACY` |
| `restaurant_prospect_events` | table, 574 | Événements append-only, `event_type`, `payload`, `campaign_id`, `external_id` | FK optionnel `prospect_id -> restaurant_prospects.id`; pas de FK vers `restaurant_prospect_leads` | Historique n8n; vues de conversion | Même posture RLS/grants; payload JSON potentiellement sensible | Pattern à adapter, données legacy |
| `restaurant_prospect_tasks` | table, 40 | File HITL, `task_type`, `status`, `due_at`, review, payload | Liaison logique par `external_id`, pas de FK lead | Historique n8n; vue `v_tasks_due` | Même posture RLS/grants | Pattern à adapter, table legacy |
| `restaurant_prospects` | table, 131 | Deuxième registre prospect : restaurant/contact/email/téléphone/source/statut | Événements reliés par `prospect_id`; pas de lien canonique avec les 67 leads | Vues conversion | Identité en doublon avec `restaurant_prospect_leads` | `KEEP_LEGACY` |
| `restaurant_*_backup_prelaunch` | 3 tables, 2 événements et 0 autres lignes | Sauvegardes pré-lancement | Aucune ownership commerciale | Aucun usage applicatif trouvé | Ne pas intégrer au nouveau domaine | Archive/legacy |
| `instagram_prospect_leads` | table, 0 | Lead orienté Instagram : business, handle, web, contact, ville/pays/niche, score, priorité, statut, analyse/outreach, timestamps | Pas de tenant/client; `external_id` unique | Aucun usage applicatif ou writer trouvé | RLS actif sans policy, grants larges | Pas assez générique; ne pas adopter |
| `instagram_prospect_events` | table, 0 | Journal d'événements par lead | FK `lead_id -> instagram_prospect_leads.id` cascade | Aucun usage trouvé | Même posture RLS/grants | Pattern seulement |
| `instagram_prospect_tasks` | table, 0 | File de tâches par lead | FK `lead_id -> instagram_prospect_leads.id` cascade | Aucun usage trouvé | Même posture RLS/grants | Pattern seulement |
| `instagram_prospect_accounts` | table, 0 | Comptes expéditeurs et quota DM | Aucun lien au modèle client/`ig_accounts` | Aucun usage trouvé | RLS sans policy, grants larges | Remplacer, ne pas créer une seconde identité de comptes |
| `instagram_action_queue` | table, 0 | Ancienne file simplifiée `lead_id`, handle, message, statut, tentatives | Pas de FK observé dans le modèle audité | Aucun usage actuel trouvé | Trop faible pour délivrabilité/idempotence/audit | Remplacer |
| `ig_dm_jobs` | table, 40 | File DM opérationnelle : compte, destinataire, template, campagne, priorité, retries, lease, idempotence, statuts/timestamps | FK/logique du domaine `ig_accounts`; pas un registre de leads commerciaux | Écrite/lue par les services DM et `enqueue_outreach_dm_job` | RLS + policy service role; ne pas exposer le contenu au tenant hors contrats existants | Réutiliser via adapter au moment de l'envoi |
| `ig_dm_templates` / `ig_account_dm_settings` | tables, 2 / 8 | Templates et limites Welcome/Outreach par compte client | Domaine client/account | Admin/client DM settings | RLS sans policy sur ces tables; accès effectif serveur | Ne pas en faire le catalogue de campagnes sales |
| `prospecting_call_logs` | table, 0 | Logs d'appels et coûts Restaurant | Données Restaurant aplaties | Vues `prospecting_*` | Pas un CRM; RLS sans policy | Legacy analytics |
| `prospecting_fixed_costs` | table, 0 | Coûts fixes mensuels | Aucun ownership | Vue ROI | Legacy analytics |

### 2.2 Vues historiques

Objets trouvés :

- `prospecting_dashboard`
- `prospecting_roi_dashboard`
- `restaurant_conversion_funnel`
- `restaurant_conversion_speed`
- `restaurant_conversion_timeseries`
- `restaurant_dashboard_filtered`
- `restaurant_dashboard_summary`
- `restaurant_prospect_funnel`
- `v_pipeline_summary`
- `v_tasks_due`

Les pages Restaurant lisent notamment `restaurant_dashboard_filtered`, `restaurant_conversion_speed`, `restaurant_conversion_timeseries` et `restaurant_prospect_funnel`. Le code ne lit pas directement les tables brutes Restaurant pour construire un CRM admin.

Toutes les vues listées ont des grants `SELECT` pour `anon`, `authenticated` et `service_role`; aucune n'a `security_invoker=true` dans `reloptions`. Plusieurs définitions sont en outre liées au domaine Restaurant et certaines figent la campagne `restaurant_call_assistant_v2`. Elles sont **NO-GO pour réutilisation directe**.

### 2.3 Enums, triggers et fonctions

- `lead_priority` : `high`, `medium`, `low`.
- `lead_status` : `new`, `low_score`, `qualified`, `contacted`, `replied`, `booked`, `closed`, `not_interested`, `unreachable`.
- `task_status` sert la file Restaurant (`pending_review`, puis approbation/envoi/échec selon le contrat documenté).
- Triggers Restaurant observés : mise à jour de `updated_at` sur leads et tâches uniquement.
- Aucun trigger ou RPC ne porte une state machine commerciale générique.
- `enqueue_outreach_dm_job` est `SECURITY DEFINER`, exécutable seulement par `service_role`; il fournit un bon pattern de job idempotent, mais son domaine est l'exécution DM d'un compte Instagram client.
- `client_can_enqueue_outreach`, `client_can_manage_instagram_account` et `dm_job_idempotency_key_outreach` concernent le domaine client/runtime, pas le pré-sales CRM.
- Les fonctions commerciales existantes concernent checkout, plan change, lifecycle et Stripe; aucune ne relie un lead à un client.

### 2.4 Migrations et provenance

Les objets prospect Restaurant/Instagram apparaissent dans le baseline versionné `supabase/baseline/20260728001632_public_schema.sql`, mais aucune migration source moderne et autonome créant ce domaine n'a été trouvée dans `supabase/migrations`. À l'inverse, checkout et Stripe ont des migrations dédiées, notamment :

- `20260615143000_commercial_checkout_entitlements.sql`
- `20260710150000_commercial_stripe_test_foundation.sql`
- `20260710150400_commercial_stripe_per_entitlement_multicomponent_billing.sql`
- `20260710150500_stripe_checkout_webhook_foundation_v1.sql`

Cela renforce la séparation entre un legacy importé/capturé et le domaine commercial BMB maintenu activement.

### 2.5 Posture RLS et accès applicatif

| Groupe | RLS/policies/grants live | Usage applicatif | Conséquence |
|---|---|---|---|
| `restaurant_prospect_*`, `restaurant_prospects`, `instagram_prospect_*`, `instagram_action_queue` | RLS actif, aucune policy; grants de table encore présents pour `anon/authenticated/service_role` | Les appels directs anon/auth sont bloqués par RLS; le service role contourne RLS | Ne pas copier cette posture ambiguë; révoquer explicitement anon/auth sur le nouveau domaine. |
| `clients`, `client_users`, `client_instagram_accounts` | RLS actif; policies tenant SELECT + policy service role historique; grants larges | Dashboard client via vérification membership, Admin via serveur | Réutilisable après conversion seulement. |
| `tenant_users`, `ig_accounts` | RLS actif sans policy; grants larges | Accès serveur/service role dans le code audité | Ne pas exposer directement au CRM browser. |
| Checkout, entitlements et tables Stripe | RLS actif, généralement sans policy; grants larges | Routes/services checkout et webhook en service role | Fonctionnel côté serveur, mais modèle de grants à durcir dans les nouveaux objets. |
| `runtime_events`, `account_dashboard_actions`, `ct_target_audit_events` | RLS + policies service role; grants anon/auth révoqués sur les objets modernes vérifiés | Routes Admin et projections safe | Meilleur modèle de sécurité à reproduire, en remplaçant les checks legacy `auth.role()` par des grants explicites. |

Objets adjacents examinés puis exclus du CRM : `ig_targets` (audiences cibles d'automation), `client_email_*` (email transactionnel client), `restaurant_followups` (suivi de réservation client), `tickets` (support), `whatsapp_conversations`/`whatsapp_threads` (conversation produit existante). Leur présence ne constitue ni un business/contact model commercial générique ni un pipeline sales BMB.

## 3. Restaurant prospecting system

### 3.1 Données réelles

`restaurant_prospect_leads` :

- 67 leads, une seule campagne ;
- période de création : 2026-05-05 à 2026-05-21 ;
- 67 sites web, 66 téléphones, 0 e-mail ;
- 67 scores, 67 analyses et contenus outreach ;
- 60 `unreachable`, 7 `contacted` ;
- 41 adresses classables Johannesburg/Gauteng, 1 Cape Town/Western Cape, 25 non classables avec certitude depuis le texte d'adresse.

`restaurant_prospect_events` :

| Type | Nombre |
|---|---:|
| `workflow_error` | 276 |
| `vapi_call_ended` | 236 |
| `outreach_prepared` | 40 |
| `link_clicked` | 14 |
| `booking_link_sent` | 8 |

Aucun événement `demo_booked` n'a été observé. La quantité d'erreurs (276) est un signal direct : la nouvelle machine doit rendre les étapes, retries, erreurs terminales et idempotency keys visibles, au lieu de dépendre d'un payload opaque.

`restaurant_prospect_tasks` : 40 tâches, toutes `follow_up_j2` et `pending_review`.

`restaurant_prospects` : 131 lignes dans un deuxième registre :

- 80 `new` / `email_outreach` (1 email, 68 téléphones) ;
- 40 `new` / `vapi_call` (1 email, 40 téléphones) ;
- 10 `new` / `vapi` (7 emails, 1 téléphone) ;
- 1 `booked` / `email_outreach` avec email et téléphone.

### 3.2 Qualité et limites

Points utiles : déduplication externe, score, priorité, analyse, contenu personnalisé, journal d'événements et review humaine.

Limites structurelles :

- business et contact sont fusionnés ;
- deux tables représentent le prospect sans clé canonique commune ;
- le lien lead/tâches passe par une chaîne `external_id`, pas une FK ;
- le modèle est mono-vertical et partiellement mono-campagne ;
- `analysis`, `outreach` et payloads recopient de gros snapshots JSON ;
- le statut mélange qualification, outreach et vente ;
- aucun lien client/tenant/Stripe/conversion ;
- aucun owner commercial typé ;
- l'attribution angle/template/channel n'est pas normalisée ;
- les vues historiques ont une posture de sécurité impropre au futur CRM.

### 3.3 Choix parmi les quatre options

| Option | Verdict | Motif |
|---|---|---|
| 1. Généraliser les tables Restaurant en place | Rejetée | Risque élevé de casser le legacy et de conserver les défauts structurels. |
| 2. Réutiliser quelques tables génériques | Rejetée pour les tables; oui pour les patterns | Aucune vraie table `business`/`contact` générique n'existe. |
| 3. Garder Restaurant legacy et créer Commercial BMB séparé | **Recommandée** | Isolation, migration progressive, modèle propre, aucun risque sur les données historiques. |
| 4. Migration immédiate vers un modèle commun | Différée | Possible seulement après V1, avec mapping, déduplication, dry-run et rapprochement des deux identités Restaurant. |

## 4. Current BMB customer/account model

### 4.1 Identité canonique

`clients.id` est l'identifiant business/client canonique post-conversion. Les 5 clients actifs observés ont tous :

- au moins une membership owner active dans `client_users` ;
- un profil de facturation Stripe ;
- une subscription Stripe active dans la projection DB.

Objets structurants :

| Objet | Volume | Rôle / relations essentielles |
|---|---:|---|
| `clients` | 5 | Workspace client canonique; `id`, nom, statut, metadata. |
| `client_users` | 6 | FK `client_id -> clients`; `auth_user_id`, rôle, statut. Les 6 sont `owner/active`. |
| `tenant_users` | 6 | Session/role : 1 `superadmin`, 5 `tenant`. Tous les `tenant_id` observés correspondent à un `clients.id`, mais **aucune FK DB ne l'impose**. |
| `client_subscriptions` | 5 | FK client, contrat d'abonnement interne. |
| `client_instagram_accounts` | 10 | FK client + `ig_accounts`; ownership et états onboarding/provisioning/login. 8 actifs/ready, 2 inactifs/blocked. |
| `client_subscription_accounts` | 10 | Relie subscription, membership compte et compte Instagram. |
| `account_assignments` | 10 | Relie client/subscription/compte au device/clone/app instance. |
| `ig_accounts` | 13 | Identité opérationnelle du compte Instagram. Contient aussi un champ legacy `password`; le CRM pré-sales ne doit jamais le lire ni le répliquer. |
| `client_account_entitlements` | 9 | FK client + checkout + compte optionnel; 8 consommés, 1 réservé. |

### 4.2 Réponses obligatoires de la mission B

1. **Identifiant business/client canonique ?** Oui : `clients.id` après conversion.
2. **Le prospect doit-il exister avant le tenant ?** Oui. Il doit vivre dans le domaine commercial BMB sans `tenant_id` obligatoire.
3. **Quand créer le tenant ?** Après confirmation irrévocable du paiement/fulfillment, dans le flux idempotent existant. Ne pas le créer à la découverte, qualification, démo ou simple checkout envoyé.
4. **Quand créer le Stripe Customer ?** Au démarrage du checkout payant ou au fulfillment selon le contexte Stripe, jamais pendant discovery/qualification. Pour un client existant, réutiliser `commercial_stripe_billing_profiles`.
5. **Comment rattacher le lead converti ?** Par une table `commercial_conversions` avec FKs explicites vers `commercial_leads`, `clients`, `commercial_checkout_sessions`, profil/subscription Stripe et compte/entitlement quand disponibles; une conversion active unique par lead.
6. **Comment conserver l'attribution ?** Garder les objets source immuables, journaliser l'événement de conversion et figer un `attribution_snapshot` versionné (`source`, campagne, canal, angle, template, lead original, première/dernière touche) dans `commercial_conversions`.
7. **Champs/tables d'acquisition existants ?** Quelques metadata génériques (`checkout_source`, `source`) existent, mais aucun modèle d'acquisition commercial normalisé ni FK lead. Les metadata checkout ne contiennent pas angle/campagne/template/lead d'origine.

## 5. Stripe/customer conversion path

### 5.1 Chaîne réelle vérifiée

```text
Commercial lead (n'existe pas encore)
  -> checkout session préparée
  -> Stripe Checkout attempt
  -> paiement/webhook confirmé
  -> résolution/création auth user
  -> création clients.id
  -> liaison tenant_users + client_users
  -> création client_subscriptions
  -> mise à jour/création commercial_checkout_sessions
  -> création client_account_entitlements
  -> commercial_stripe_billing_profiles
  -> commercial_stripe_subscriptions
  -> client_instagram_accounts / ig_accounts lors de l'onboarding
```

Le code `lib/commercial/activate-client-account-entitlement-from-checkout.ts` confirme que, pour un premier achat public, l'utilisateur Auth est résolu/créé après paiement confirmé, puis le workspace `clients` et ses memberships sont créés. `lib/commercial/stripe/stripe-fulfillment.ts` déclenche cette activation depuis le fulfillment Stripe.

### 5.2 État DB observé

- 10 sessions checkout : 5 `checkout_paid`, 4 `checkout_activated_test`, 1 expirée.
- 6 Stripe checkout attempts : 5 fulfilled, 1 expired.
- 5 billing profiles Stripe.
- 5 subscriptions Stripe actives.
- 35 webhook events Stripe.
- Toutes les lignes Stripe observées ont `livemode=false`.

La structure de lien est claire, mais seules des données test-mode sont visibles dans le projet actif audité. L'absence de données `livemode=true` n'est pas une preuve sur le Dashboard Stripe externe.

### 5.3 Lien de conversion à ajouter

Le futur `commercial_conversions` ne doit pas stocker seulement `stripe_customer_id` en texte. Il doit préférer :

- `lead_id` FK non nul ;
- `business_id` FK non nul ;
- `client_id` FK non nul dès conversion ;
- `checkout_session_id`, `entitlement_id`, `stripe_billing_profile_id`, `stripe_subscription_projection_id`, `instagram_account_id` optionnels selon l'avancement ;
- `paid_at`, `onboarding_started_at`, `active_client_at` ;
- `attribution_snapshot` JSONB versionné et non réécrit ;
- contrainte d'unicité empêchant deux conversions actives du même lead ou le rattachement ambigu d'un checkout.

## 6. Existing Dashboard/Admin reusable UI

| Composant / chemin | Fonction | Réutilisation | Décision / dépendances |
|---|---|---|---|
| `app/instagram-dashboard/layout.tsx` + `AdminShell.tsx` | Shell fixe, sidebar responsive/collapsible | Forte | `REUSE_AS_IS` comme conteneur. |
| `app/instagram-dashboard/AdminSidebar.tsx` | Navigation groupée, état actif, badges/popovers | Forte | Adapter avec un item `Commercial` rendu seulement après permission owner calculée côté serveur; ne pas dupliquer la navigation. |
| `components/restaurant-analytics/DashboardPageHeader.tsx` | Header, description, badges, action | Forte | `REUSE_AS_IS`. |
| `components/restaurant-analytics/AnalyticsSectionCard.tsx` | Carte de section cohérente | Forte | `REUSE_AS_IS`. |
| `components/restaurant-analytics/AnalyticsKpiCard.tsx` | Carte KPI générique | Forte | Tester l'adéquation puis réutiliser; les pages Instagram ont aussi des KPI locaux dupliqués. |
| `components/restaurant-analytics/DataTable.tsx` | Primitive tableau | Moyenne | Adapter au volume, tri et pagination serveur du CRM. |
| `app/instagram-dashboard/client-accounts/page.tsx` | 7 KPI, filtres par URL, table responsive, badges | Très forte comme pattern | Adapter; ses composants locaux ne sont pas encore une librairie partagée. |
| `client-accounts/AccountStatusActionMenu.tsx` | Menu d'action avec confirmation et raison | Forte | Adapter à Approve/Reject/Assign/Mark lost; ne pas réutiliser la logique lifecycle compte. |
| `activity-log/ActivityLogInvestigationLab.tsx` | Recherche, filtres, période, badges, résultats, export safe | Forte | Adapter pour le journal commercial; ne pas mélanger les sources runtime/CT. |
| `VerificationCodeActionModal.tsx` | Modale accessible et retours succès/erreur | Moyenne | Réutiliser le pattern visuel/accessibilité, pas le domaine credentials. |
| `radar/page.tsx` | KPI cliquables, drilldown, worklists, signaux | Forte | Adapter pour la queue Liam et le funnel. |
| `InstagramDashboardButtons.tsx` | Modales/drawers opérationnels complexes | Moyenne | Extraire seulement les primitives nécessaires; ne pas ajouter le CRM dans ce fichier déjà massif. |

Constat important : le design est réutilisable, mais nombre de KPI, badges, filtres et tableaux sont définis localement avec CSS inline/page-scoped. Avant le Commercial Dashboard, extraire un petit ensemble de primitives partagées seulement si cela réduit réellement la duplication : `AdminKpiCard`, `AdminStatusBadge`, `AdminFilterBar`, `AdminDataTable`, `AdminDrawer`. Ne pas lancer une refonte générale du Dashboard.

## 7. Existing backend/RPC/API patterns

### 7.1 Patterns canoniques à reprendre

- Client Supabase serveur-only : `lib/supabase.ts` / `lib/supabase/admin.ts`, utilisant la service role uniquement côté serveur.
- Auth Admin : `requireInstagramAdmin()` dans `app/api/instagram-dashboard/_utils.ts`, fondé sur `getInstagramUserContext()` et le rôle `superadmin`. Ce helper est réutilisable comme première étape d'authentification, mais insuffisant pour le CRM owner-only.
- Réponses : `jsonOk({ ... })` et `jsonError(message, status, { code/reason })`; erreurs DB brutes non exposées.
- Validation : `readJsonBody`, `readString`, `readInteger`, allowlists et limites de longueur.
- Pagination : curseur opaque encodé/décodé, `limit` borné, ordre stable `(timestamp, id)`; le pattern de `app/api/instagram-dashboard/incidents/route.ts` est le meilleur exemple.
- Filtres : normalisation serveur, allowlist, recherche bornée, compteurs calculés par la même requête/RPC que la page.
- RPC : contrat versionné, payload validé après appel, erreur `RPC_MISSING` distincte de l'indisponibilité.
- Idempotence : clés uniques checkout/webhook/DM et replay sûr; excellent pattern pour import, scoring, enqueue outreach et traitement webhook de réponse.
- Mutation lifecycle : fonction/service dédié, préconditions, confirmation pour actions sensibles, journal d'audit, résultat stable.
- Worker queue : `ig_dm_jobs` fournit statuts, tentatives, réservation, retry, idempotency key et timestamps; réutiliser le pattern, pas la table pour tout le CRM.

### 7.2 Routes futures recommandées

Préfixe : `/api/instagram-dashboard/commercial/...` pour rester sous le domaine Admin actuel.

```text
GET  /commercial/dashboard
GET  /commercial/leads?filter=&cursor=&limit=
GET  /commercial/leads/[id]
POST /commercial/leads/[id]/transition
POST /commercial/leads/[id]/assign
POST /commercial/outreach/queue
GET  /commercial/events?lead_id=&cursor=
```

V1 doit utiliser **session owner explicitement autorisée seulement**. Chaque route `/commercial/*` doit appeler un nouveau `requireCommercialOwnerApi()` et ne jamais `requireRelayOrAdmin`. `requireInstagramAdmin()` seul est insuffisant, car il autorise tout `superadmin`. Une intégration machine ultérieure doit avoir une route interne séparée, un scope minimal, une signature/secret distinct et des opérations allowlistées.

## 8. Auth/tenant scoping

### 8.1 Modèle constaté

- Rôles `tenant_users.role` : `superadmin` et `tenant`.
- Les pages Admin appellent `requireInstagramDashboardAccess()` puis `canAccessTenantPages()`, qui n'accepte que `superadmin`.
- Les routes client rejettent l'admin et vérifient le tenant et l'ownership compte via membership/RPC.
- Les accès DB admin passent par service role côté serveur.

### 8.2 Recommandation

1. Les leads sont propriété globale de BMB avant conversion.
2. Ils ne doivent pas avoir de `tenant_id` obligatoire, ni être rangés sous un futur client.
3. Les nouvelles tables sont internal/founder-only; elles ne sont pas admin-wide.
4. RLS activé + `REVOKE ALL` pour `anon` et `authenticated` + grants explicites service role. Les routes serveur appliquent `requireInstagramAdmin()`.
5. Ne pas créer de policy tenant sur les tables CRM; l'absence de policy tenant est intentionnelle.
6. Le Dashboard Commercial peut vivre dans le shell Admin, mais sa route, ses API et sa navigation exigent une permission owner distincte du rôle `superadmin`; aucun composant n'est importé dans `/instagram-client`.
7. **BotApp : NON en V1.** Aucun besoin produit ne justifie l'accès à la base de prospects, aux réponses commerciales ou aux notes sales.

### 8.3 Points à corriger lors de l'implémentation

- Ne pas recopier les policies historiques `auth.role() = 'service_role'`; préférer des grants service role explicites et les patterns Supabase actuels.
- Ajouter une FK ou un contrat de cohérence clair entre `tenant_users.tenant_id` et `clients.id` dans une phase séparée, car les données coïncident mais la DB ne l'impose pas aujourd'hui.
- Toute vue CRM devra être `security_invoker=true` ou service-only sans grant public.
- Aucun secret, mot de passe Instagram, payload provider brut ou contenu sensible non allowlisté ne doit apparaître dans les projections Admin de liste.

### 8.4 Addendum owner-only : audit d'identité et d'autorisation

#### État réel vérifié

- Supabase Auth contient 8 utilisateurs, tous via le provider `email`.
- `tenant_users` contient 6 mappings : 1 `superadmin` et 5 `tenant`.
- `tenant_users.user_id` a une FK vers `auth.users.id` et une contrainte `UNIQUE`.
- L'enum global `user_role` ne contient que `tenant` et `superadmin`.
- Aucun `owner`, `super_owner`, rôle staff, permission interne ou table d'access grants n'existe au niveau plateforme.
- Les 6 rôles `owner` de `client_users` sont des propriétaires de workspaces clients; ils ne représentent pas le fondateur BMB et ne doivent pas être utilisés pour `/commercial`.
- Aucun utilisateur Auth n'a de rôle dans `raw_app_meta_data`; les metadata Auth actuelles ne distinguent donc pas Liam.
- L'unique `superadmin` live est `auth.users.id = 580d7856-d60f-4838-a5f9-3b405d6ae79b`, provider email confirmé. Son `tenant_id` est `c37c9143-ee14-4c9a-9a60-226759241733`, identifié par le code et le runbook comme le workspace protégé de Liam.
- Ce UUID Auth est une identité stable exploitable, mais il n'existe aucun attribut sémantique disant « canonical BMB owner ».
- Aucun `middleware.ts`/`proxy.ts` applicatif n'a été trouvé. Les pages se protègent individuellement avec les helpers de session; le layout Instagram Admin construit actuellement la sidebar sans contexte d'autorisation owner.
- `requireInstagramAdmin()` autorise chaque `superadmin` et contient un bypass local hors production. `requireRelayOrAdmin()` peut également autoriser une clé BotApp relay. Aucun des deux ne doit devenir le gate Commercial.

#### Réponses spécifiques

1. **Rôle owner/super-owner existant ?** Non au niveau plateforme. `superadmin` existe, mais c'est un rôle générique. `client_users.owner` est tenant-local et hors sujet.
2. **Liam est-il distinguable par un attribut stable ?** Son UUID `auth.users.id` est stable et son mapping vers le workspace Liam est vérifié. Toutefois, aucune permission owner canonique ne le distingue sémantiquement d'un futur autre `superadmin`.
3. **Plus petite addition sûre ?** Une table service-only `internal_access_grants` et une ligne active pour le UUID Auth de Liam avec `permission_code='commercial_crm_access'`. Ne pas ajouter un email en dur, un booléen frontend ou du `user_metadata`.
4. **Enforcement `/commercial/*` ?** `request -> Supabase auth.getUser(token) -> tenant_users context -> role == superadmin -> active internal_access_grants row -> allow`. Sinon 401/403 avant toute lecture service-role.
5. **Fail closed DB/RPC ?** Nouvelles tables avec RLS, aucun grant/policy `anon` ou `authenticated`; RPC révoqués à `PUBLIC/anon/authenticated`, service-role only, et vérification interne de l'actor UUID autorisé pour chaque mutation atomique.
6. **Sidebar seulement pour Liam ?** Oui, permission résolue côté Server Component puis booléen transmis à `AdminSidebar`. Pas de comparaison d'email/UUID dans le composant client.
7. **Pourquoi le masquage UI ne suffit pas ?** Le layout/page owner, chaque route API, le service data et chaque RPC de mutation appliquent leur propre contrôle. Une URL directe ou un appel API sans navigation reste refusé.
8. **Délégation future ?** Ajouter explicitement une seconde ligne active `commercial_crm_access` pour un utilisateur Auth approuvé, après lui avoir donné le rôle interne requis. Les autres superadmins restent refusés. Révocation par `status='revoked'`, actor et timestamps audités.

#### Modèle minimal recommandé

```text
internal_access_grants
  auth_user_id uuid -> auth.users.id
  permission_code text = commercial_crm_access
  status text = active | revoked
  granted_by_user_id uuid -> auth.users.id
  granted_at timestamptz
  revoked_by_user_id uuid null
  revoked_at timestamptz null
  reason_safe text null
  primary key (auth_user_id, permission_code)
```

Posture : RLS actif; aucun accès `anon/authenticated`; `service_role` seulement. Ne pas placer le droit dans `raw_user_meta_data`. `raw_app_meta_data` serait plus sûr que user metadata, mais resterait moins adapté ici à cause du cache JWT, de la révocation non instantanée et de l'audit/délégation moins explicites.

Helpers futurs :

```text
getCommercialOwnerContext()
requireCommercialOwnerPage()   -> redirect/notFound avant rendu
requireCommercialOwnerApi()    -> 401 ou 403 JSON
canRenderCommercialNavigation() -> bool calculé côté serveur
```

Le helper ne doit avoir **aucun bypass local automatique**. Les tests peuvent injecter des dépendances/faux contextes sans ouvrir un chemin runtime.

#### Matrice V1 obligatoire

| Acteur | Décision |
|---|---|
| Liam / UUID Auth canonique + grant actif | ALLOW |
| Autre `superadmin` sans grant | DENY |
| `client_users.admin`, operator, support | DENY |
| Tenant/client | DENY |
| BotApp operator / relay key | DENY |
| Non authentifié | DENY |

## 9. Audit/log patterns

### 9.1 Inventaire utile

| Objet | Volume | Usage | Réutilisation |
|---|---:|---|---|
| `commercial_checkout_audit_events` | 49 | Événements checkout/entitlement/client | Conserver pour checkout; ne pas surcharger avec le CRM. |
| `runtime_events` | 36 | Runtime/worker | Pattern service-only; domaine séparé. |
| `account_dashboard_actions` | 128 | Actions admin/client sur comptes | Pattern d'action et worklist, pas sales. |
| `account_incident_review_events` | 32 | Historique de revue d'incident | Bon modèle append-only et actor provenance. |
| `ct_target_audit_events` | 173 | Audit des target accounts | Pattern de projection safe et journal dédié. |
| `restaurant_prospect_events` | 574 | Journal historique du funnel Restaurant | Corpus à migrer éventuellement, pas nouvelle source canonique. |

### 9.2 Décision

Créer plus tard un `commercial_sales_events` dédié, append-only. Ne pas fusionner les événements sales avec `runtime_events`, `ct_target_audit_events` ou `commercial_checkout_audit_events`.

Colonnes minimales :

```text
id, lead_id, business_id, event_type, occurred_at,
actor_type, actor_user_id, actor_label_safe,
source_surface, correlation_id, idempotency_key,
from_state, to_state, reason_code,
metadata_safe, created_at
```

Exigences : aucune mise à jour/suppression applicative, clé d'idempotence optionnelle mais unique quand fournie, métadonnées allowlistées, index `(lead_id, occurred_at desc, id desc)`, et événement écrit dans la même transaction que chaque transition.

## 10. Reuse matrix

| Domaine | Objet/pattern | Verdict | Justification |
|---|---|---|---|
| Restaurant | Tables `restaurant_*` | `KEEP_LEGACY` | Données réelles mais modèle mono-vertical et fragmenté. |
| Instagram prospect | `instagram_prospect_*` | `REPLACED` | Vide, channel-specific, aucune intégration active. |
| Business client | `clients` | `REUSE_AS_IS` après conversion | Identité client canonique. |
| Membership | `client_users` | `REUSE_AS_IS` après conversion | Ownership client canonique. |
| Tenant session | `tenant_users` | `EXTEND/HARDEN_LATER` | Mapping réel vers client, mais FK absente. |
| Compte Instagram | `client_instagram_accounts` + `ig_accounts` | `REUSE_AS_IS` après conversion | Ownership/opérations canoniques; jamais comme compte expéditeur pré-sales par défaut. |
| Checkout/entitlement | Tables `commercial_checkout_*`, `client_account_entitlements` | `REUSE_AS_IS` | Solide et idempotent; ajouter le lien depuis conversion, pas des champs CRM dispersés. |
| Stripe | `commercial_stripe_*` | `REUSE_AS_IS` | Projection client/checkout claire; données actuelles test-mode. |
| DM jobs | `ig_dm_jobs` | `EXTEND` uniquement au point d'envoi Instagram | Bon moteur durable; créer un adapter depuis `commercial_outreach_attempts`. |
| Logs | Tables audit existantes | `EXTEND` par pattern | Garder des streams par domaine. |
| UI Admin | Shell/header/cards/table/filter/modal | `REUSE_AS_IS` ou `ADAPT` | Cohérence et vitesse sans second design system. |
| API | Auth, JSON, cursor, services, idempotence | `EXTEND` pour le CRM | Réutiliser l'authentification et les contrats, puis ajouter la permission owner; `requireInstagramAdmin` seul n'est pas suffisant. |
| Accès founder | Aucun objet actuel | `NEW_OBJECT_REQUIRED` | `internal_access_grants` lie explicitement l'UUID Auth à `commercial_crm_access`. |

## 11. Gap analysis

Manques bloquant une vraie machine commerciale :

- business pré-sales canonique et déduplication multi-source ;
- contacts multiples par business ;
- lead/opportunity par campagne sans dupliquer le business ;
- campagnes, angles et versions de template normalisés ;
- tentatives outreach et états de délivrabilité par canal ;
- conversations/messages entrants et classification IA historisée ;
- ownership sales, tâches et SLA ;
- transitions métier atomiques avec contrôle des chemins autorisés ;
- conversion explicite vers client/checkout/Stripe/account ;
- attribution first-touch/last-touch immuable ;
- dashboard/funnel avec dénominateurs définis ;
- durable queue entre approbation humaine et reprise automation ;
- arrêt garanti de l'automation à la réponse sales-qualified ;
- règles de rétention/PII et suppression contrôlée ;
- sécurité des vues/grants.

## 12. Proposed target data model

### 12.1 Noyau minimal

| Nouvel objet | Finalité | Champs/contraintes clés |
|---|---|---|
| `commercial_campaigns` | Définir marché et expérimentation | `name`, statut, country/cities/vertical, période, objectifs, owner; code unique. |
| `commercial_businesses` | Identité pré-sales dédupliquée | nom, `instagram_handle_normalized`, website/domain normalisé, ville, pays, vertical, subsegment, source timestamps; index uniques partiels. |
| `commercial_contacts` | Contacts d'un business | `business_id`, nom/rôle, email/phone normalisés, préférence canal, provenance, statut de validation; unicité partielle. |
| `commercial_leads` | Opportunité d'un business dans une campagne | `business_id`, `campaign_id`, primary contact, score, P1/P2/P3, trois statuts orthogonaux, owner, qualification/personalization context, approval fields, dates de projections. Unicité `(campaign_id,business_id)`. |
| `commercial_outreach_attempts` | Chaque envoi/essai | lead, channel, angle, template/version, idempotency key, provider ids, queued/sent/delivered/failed, timestamps, safe error. |
| `commercial_conversations` | Thread par lead/canal | lead, channel, provider thread id, état, dernière activité. |
| `commercial_messages` | Historique entrant/sortant | conversation, direction, provider message id, body chiffré ou politique de rétention, classification IA, confidence, received/sent at. |
| `commercial_sales_events` | Journal append-only | transition, actor, reason, correlation/idempotency, metadata safe. |
| `commercial_sales_tasks` | Queue Liam/humaine | lead, type, priority, owner, due_at, status, résolution; unicité pour tâche ouverte équivalente. |
| `commercial_conversions` | Pont immuable vers domaine client | lead/business/client/checkout/entitlement/billing/subscription/account, dates, package et attribution snapshot. |

Objet de sécurité transversal requis avant ces tables : `internal_access_grants`, service-only, avec le grant initial de Liam. Ce n'est ni une ownership tenant ni un rôle admin générique.

### 12.2 Ce qui reste hors du CRM

- `clients` et tenants avant paiement ;
- secrets Instagram et credentials ;
- exécution technique Phone Farm ;
- logs runtime bruts ;
- objets Stripe complets bruts ;
- copies intégrales de payloads provider dans les tables de liste.

### 12.3 Attribution

La source ne doit pas être un simple champ modifiable sur `clients.metadata`. Le lead, les attempts et les événements restent conservés. `commercial_conversions.attribution_snapshot` capture au moment du paiement :

```json
{
  "version": 1,
  "original_lead_id": "...",
  "business_id": "...",
  "campaign_id": "...",
  "discovery_source": "...",
  "first_touch_channel": "instagram",
  "last_touch_channel": "email",
  "winning_angle": "ANGLE_B",
  "winning_template_version": "...",
  "qualified_at": "...",
  "first_contacted_at": "..."
}
```

## 13. Proposed pipeline/state model

### 13.1 Décision

Ne pas créer un enum PostgreSQL unique avec 20 à 40 valeurs. Utiliser :

1. trois statuts orthogonaux et petits ;
2. des contraintes `CHECK` évolutives plutôt que des enums DB globaux en V1 ;
3. une state machine dans une fonction/service de transition unique ;
4. `commercial_sales_events` append-only comme historique ;
5. des timestamps de milestone comme projections pour les KPI.

Proposition :

```text
qualification_status:
  discovered | enriched | qualified | approved | rejected | not_qualified

outreach_status:
  not_started | queued | contacted | replied | no_response | stopped

sales_status:
  not_started | sales_qualified | demo_booked | demo_done |
  checkout_sent | paid | onboarding | active_client | lost

loss_reason:
  not_interested | no_show | lost_after_demo | payment_failed | other
```

Le `pipeline_stage` affiché est dérivé de ces projections. Ainsi `NO_RESPONSE` ne détruit pas l'information qu'un lead était qualifié, et `PAYMENT_FAILED` n'efface pas le checkout envoyé.

### 13.2 Transitions critiques

- `qualified -> approved` exige `approved_by`, `approved_at` et contexte de personnalisation complet.
- L'enqueue outreach n'est permis que si qualification=`approved`, aucun stop flag, et aucune tentative équivalente idempotente.
- Une réponse entrante met outreach=`replied` et crée un événement.
- Classification IA sales-qualified crée une tâche Liam et positionne sales=`sales_qualified` dans la même transaction.
- Dès `sales_qualified`, `automation_stop_at` est non nul; aucun follow-up automatique ne peut être réservé.
- `paid` exige une preuve checkout/Stripe et crée/résout `commercial_conversions` idempotemment.
- `active_client` exige un `client_id` et la projection onboarding appropriée.

## 14. Proposed Commercial Dashboard V1

### 14.1 Route et structure

Route proposée : `/instagram-dashboard/commercial`, entrée dans `AdminSidebar`, accès founder-only via `commercial_crm_access`. Le rôle `superadmin` est une précondition V1 mais ne constitue jamais à lui seul l'autorisation.

Premier écran :

1. Header + fraîcheur/source des données.
2. KPI : Discovered, Qualified, Approved, Contacted, Replies, Hot leads, Demos, Paid customers.
3. Funnel : Qualified -> Contacted -> Replied -> Sales Qualified -> Demo -> Paid.
4. Breakdown : Instagram/Email, Angle A/B, Johannesburg/Cape Town, subsegment, template version.
5. Queue Liam : Needs approval, Hot responses, Demo soon, Needs sales action.
6. Table leads avec pagination curseur serveur.
7. Drawer détail sans navigation complète.

### 14.2 Définitions métriques

Les KPI doivent être basés sur les événements/milestones, avec filtres de cohorte explicites :

- `Discovered` : lead créé dans la période.
- `Qualified` : `qualified_at` dans la période ou cohorte découverte, choix visible.
- `Contacted` : première tentative réellement `sent`, pas seulement queued.
- `Replies` : première réponse humaine reçue; exclure bounce/auto-reply.
- `Hot leads` : classification sales-qualified non résolue.
- `Demos` : `demo_booked_at` et `demo_done_at` séparés.
- `Paid customers` : paiement confirmé et conversion liée, pas checkout ouvert.
- métrique principale : `100 * distinct paid lead conversions / distinct qualified leads` sur une cohorte et une fenêtre affichées.

### 14.3 Table et drawer

Filtres : statut dérivé, ville, subsegment, canal, angle, score, owner, date/campagne. Recherche par nom business, handle, domaine et contact normalisés.

Drawer : résumé business, Instagram, site, score/qualification, contexte de personnalisation, competitors/audiences, outreach attempts, conversation/messages, sales events/tâches, et lien conversion/Stripe safe si converti.

## 15. Migration strategy if needed

### Phase de création

1. Migrations additives uniquement : nouvelles tables/index/contraintes/RLS/grants.
2. Aucun changement sur `restaurant_*`, `instagram_prospect_*`, vues Restaurant ou données existantes.
3. Routes founder-only read-only et dashboard sur données nouvelles, toutes derrière le grant explicite Liam.
4. Transitions/actions après tests d'autorisation, idempotence et audit.

### Migration Restaurant ultérieure, optionnelle

Seulement après stabilisation de V1 :

1. construire un mapping dry-run des 67 leads et 131 prospects ;
2. rapprocher `external_id`, téléphone, email, domaine et nom normalisé ;
3. produire un rapport `matched / ambiguous / orphan / duplicate` ;
4. importer avec `legacy_source_table` + `legacy_source_id` uniques ;
5. réconcilier les comptes avant/après ;
6. conserver les tables legacy en lecture seule jusqu'à validation métier.

Aucune migration Restaurant n'est nécessaire pour lancer Beauty/Aesthetics South Africa.

## 16. Recommended implementation phases

### Phase 1 — Foundation schema + security

- créer `internal_access_grants`, y inscrire uniquement l'UUID Auth canonique de Liam pour `commercial_crm_access`, et tester la révocation ;
- campagne, business, contact, lead, event, contraintes de déduplication ;
- statuts orthogonaux, RLS service-only, grants minimaux ;
- ajouter `requireCommercialOwnerPage/Api`, sans bypass local et sans relay/BotApp ;
- RPC/service de transition atomique et tests négatifs d'accès ;
- aucune automation d'envoi.

### Phase 2 — Admin read-only dashboard

- KPI/funnel/queues/table/drawer ;
- route-group layout owner-only, routes API owner-only, navigation conditionnelle côté serveur et pagination curseur ;
- vues/RPC service-only et `security_invoker` si une vue est réellement nécessaire.

### Phase 3 — Human qualification

- Approve/Reject, owner, notes structurées, tâches Liam ;
- journal append-only dans la même transaction.

### Phase 4 — Outreach adapters

- `commercial_outreach_attempts` et conversations/messages ;
- Email provider et adapter Instagram vers `ig_dm_jobs` ;
- idempotence, quotas, délivrabilité, webhooks et stop flags.

### Phase 5 — AI response + Sales handoff

- classification versionnée et confidence ;
- revue humaine des cas incertains ;
- arrêt automatique + notification Liam sur `SALES_QUALIFIED_RESPONSE`.

### Phase 6 — Checkout attribution/conversion

- `commercial_conversions` ;
- passage contrôlé du `lead_id` dans la metadata checkout signée/validée ;
- liaison transactionnelle au fulfillment Stripe et snapshots d'attribution.

### Phase 7 — Import legacy optionnel

- dry-run, rapprochement, validation humaine, import idempotent, aucun delete.

## 17. Risks / NO-GO points

1. **NO-GO :** réutiliser les vues historiques avec grants `anon/authenticated` et sans `security_invoker`.
2. **NO-GO :** généraliser ou renommer `restaurant_*` en place.
3. **NO-GO :** créer `clients`, tenant, Auth user ou Stripe Customer avant paiement confirmé.
4. **NO-GO :** considérer `superadmin`, `client_users.owner` ou un email frontend comme preuve suffisante d'ownership BMB.
5. **NO-GO :** exposer le CRM via `requireRelayOrAdmin`, BotApp ou le bypass local Admin en V1.
6. **NO-GO :** masquer seulement la sidebar sans protéger page, API, data service et RPC.
7. **NO-GO :** utiliser la service role dans un composant client/browser.
8. **NO-GO :** utiliser un unique statut contenant qualification, delivery, sales, paiement et onboarding.
9. **NO-GO :** laisser l'automation envoyer après une réponse sales-qualified.
10. **NO-GO :** copier les payloads provider complets ou credentials dans les vues/tableaux.
11. **Risque élevé :** déduplication business entre Instagram, domaine, email et téléphone; prévoir normalisation, source confidence et revue des ambiguïtés.
12. **Risque élevé :** KPI incohérents si cohorte, période, timezone et dénominateur ne sont pas explicites.
13. **Risque moyen :** `tenant_users.tenant_id` correspond aujourd'hui à `clients.id` sans FK DB.
14. **Risque moyen :** toutes les données Stripe projetées observées sont test-mode; le go-live exige une certification live séparée.
15. **Risque moyen :** les primitives UI sont parfois locales et dupliquées; extraction ciblée seulement.

RISK_LEVEL=HIGH si le CRM réutilise le gate `superadmin`; MEDIUM après le gate owner, RLS/RPC service-only et les garde-fous state/idempotency.

## 18. Exact next action

Rédiger, faire relire puis implémenter **une seule migration additive Foundation V1**, sans outreach ni UI mutation, créant :

```text
internal_access_grants
commercial_campaigns
commercial_businesses
commercial_contacts
commercial_leads
commercial_sales_events
```

Cette migration doit inscrire uniquement `580d7856-d60f-4838-a5f9-3b405d6ae79b` comme grant actif initial `commercial_crm_access`, puis inclure les clés/uniques/indexes, les trois statuts orthogonaux, les timestamps de milestone, RLS service-only, révocation `anon/authenticated`, grants minimaux, commentaires de contrat et tests SQL négatifs prouvant qu'un tenant, un autre superadmin, BotApp et un utilisateur non authentifié ne peuvent ni lire ni écrire. Ajouter ensuite les helpers owner-only et un RPC/service unique de transition atomique `lead + event`, mais ne brancher aucune automation avant revue.

## Questions finales obligatoires

```text
1. EXISTING_RESTAURANT_CRM_FOUND=YES
2. EXISTING_GENERIC_LEAD_TABLE_FOUND=NO
3. EXISTING_BUSINESS_CONTACT_MODEL_FOUND=NO
4. EXISTING_OUTREACH_MODEL_FOUND=NO
5. EXISTING_SALES_PIPELINE_FOUND=NO
6. EXISTING_UI_COMPONENTS_REUSABLE=YES
7. EXISTING_BACKEND_PATTERNS_REUSABLE=YES
8. EXISTING_AUDIT_PATTERN_REUSABLE=YES
9. STRIPE_CONVERSION_LINKAGE_CLEAR=YES
10. TENANT_SCOPING_MODEL_CLEAR=YES
```

Précisions : `STRIPE_CONVERSION_LINKAGE_CLEAR=YES` signifie que le chemin client/checkout/Stripe est clair; le lien **lead d'origine -> client final** manque et doit être ajouté. `EXISTING_OUTREACH_MODEL_FOUND=NO` signifie qu'il n'existe pas de modèle unifié pré-sales multicanal; les jobs DM opérationnels et objets legacy constituent seulement des patterns réutilisables.

```text
OWNER_IDENTITY_MODEL_FOUND=NO
CANONICAL_OWNER_USER_ID=580d7856-d60f-4838-a5f9-3b405d6ae79b
CURRENT_LIAM_OWNER_DISTINCTION=STABLE_AUTH_USER_ID_AND_VERIFIED_LIAM_WORKSPACE_MAPPING_BUT_NO_SEMANTIC_OWNER_PERMISSION
GENERIC_ADMINS_CURRENTLY_WOULD_HAVE_ACCESS=YES
RECOMMENDED_OWNER_GATE=AUTHENTICATED_SUPERADMIN_PLUS_ACTIVE_INTERNAL_ACCESS_GRANT_COMMERCIAL_CRM_ACCESS
BACKEND_ENFORCEMENT_PATTERN=AUTH_GETUSER_THEN_TENANT_USER_ROLE_THEN_SERVER_SIDE_ACCESS_GRANT_THEN_SERVICE_ROLE_DATA_ACCESS
RLS/RPC_ENFORCEMENT_REQUIRED=YES
BOTAPP_ACCESS=DENY
CLIENT_DASHBOARD_ACCESS=DENY
```

`GENERIC_ADMINS_CURRENTLY_WOULD_HAVE_ACCESS=YES` signifie qu'avec le guard actuel, tout utilisateur futur mappé `superadmin` serait autorisé. Les rôles tenant-locaux `client_users.admin/owner` n'accèdent pas aujourd'hui au Dashboard Admin, mais ils ne constituent pas une identité founder.

```text
RECOMMENDED_ARCHITECTURE=NEW_FOUNDER_ONLY_COMMERCIAL_DOMAIN_LINKED_TO_CLIENTS_AT_CONFIRMED_CONVERSION
REUSE_AS_IS=clients,client_users,client_instagram_accounts,ig_accounts,commercial_checkout_sessions,client_account_entitlements,commercial_stripe_*,AdminShell,DashboardPageHeader,AnalyticsSectionCard,auth_session_resolution_and_json_contracts
EXTEND=AdminSidebar,AdminShell,owner_only_page_and_API_guards,targeted_shared_UI_primitives,checkout_conversion_metadata_handoff,atomic_transition_and_idempotent_job_patterns
KEEP_LEGACY=restaurant_prospect_*,restaurant_prospects,restaurant_conversion_*,prospecting_*,instagram_prospect_*,instagram_action_queue
NEW_OBJECTS_REQUIRED=internal_access_grants,commercial_campaigns,commercial_businesses,commercial_contacts,commercial_leads,commercial_outreach_attempts,commercial_conversations,commercial_messages,commercial_sales_events,commercial_sales_tasks,commercial_conversions
MIGRATIONS_REQUIRED_LATER=YES_ADDITIVE_ONLY_FIRST_NO_LEGACY_MIGRATION_FOR_V1
RISK_LEVEL=HIGH_IF_GENERIC_SUPERADMIN_GATE_MEDIUM_AFTER_OWNER_RLS_STATE_AND_IDEMPOTENCY_GUARDS
```

## Validation finale

```text
CODE_CHANGED=NO
DB_CHANGED=NO
MIGRATION_APPLIED=NO
DEPLOYED=NO
COMMIT_CREATED=NO
NEXT_RECOMMENDED_PHASE=IMPLEMENT_AND_REVIEW_ONE_ADDITIVE_FOUNDER_ONLY_FOUNDATION_MIGRATION_ADDING_INTERNAL_ACCESS_GRANTS_WITH_LIAM_AS_THE_SOLE_INITIAL_GRANTEE_PLUS_CAMPAIGNS_BUSINESSES_CONTACTS_LEADS_AND_APPEND_ONLY_SALES_EVENTS_WITH_SERVICE_ROLE_ONLY_RLS_OWNER_GUARDS_AND_NEGATIVE_ACCESS_TESTS
```
