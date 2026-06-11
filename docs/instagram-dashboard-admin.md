# Instagram Dashboard Admin - Base de connaissance frontend

Derniere mise a jour: 2026-05-29

Ce document decrit l'etat frontend du dashboard admin Instagram dans `boost-ai-frontend`. Il sert de reference projet pour les vues, routes, contrats no-leak, dependances backend Phone Farm, limites connues et prochaines etapes.

## 1. Etat general

Le dashboard admin Instagram est une interface Next.js server-rendered/admin-only qui consolide les donnees de gestion de comptes Instagram, de sante runtime, de credentials, de devices, de targets/CT, de templates, de settings et de futures actions dashboard.

Etat actuel:

- Deployed en production via Vercel.
- Auth admin requise pour les pages et API dashboard.
- Plusieurs vues sont read-only ou "pending backend" par design.
- Certaines mutations existent deja: Add Profile, lifecycle archive/trash/restore, settings, filters, templates, apply template, targets add/delete/reset, stop run.
- Les credentials Add Profile passent maintenant par le pipeline securise Patch 2B.
- La plupart des controles runtime/device/status restent des preparations UI et ne doivent pas etre presentes comme runtime verified.

Dernier commit frontend de reference deploye:

- `c9bc6aa feat(instagram-dashboard): route add profile credentials securely`

Production:

- `https://www.boostmybusinesses.com`
- `https://boostmybusinesses.com`

Deployment Vercel connu:

- `https://boost-my-businesses-ai-frontend-vercel-mn3dz281l.vercel.app`

## 2. Navigation et vues admin

### Manage

Route: `/instagram-dashboard`

Objectif:

- Vue principale d'inventaire admin.
- Liste les comptes actifs, archives et dans la corbeille.
- Affiche des KPI, statuts credentials, login, provisioning, phone, campagnes, actions et liens vers Account Detail.
- Integre Add Profile, settings drawer, filters drawer, controls drawer et Targets/CT modal.

Source de donnees:

- `getManageData()` dans `app/instagram-dashboard/manage-data.ts`.
- Source primaire si configuree: Admin Dashboard API via `ADMIN_DASHBOARD_API_URL` et `ADMIN_DASHBOARD_INTERNAL_API_TOKEN`.
- Fallback legacy Supabase: `ig_accounts`, `ig_account_settings`, `ig_runs`, `ig_targets`.

Statut actuel:

- Lecture principale.
- Mutations disponibles via composants et API: Add Profile, archive/trash/restore, settings, filters, templates, targets.
- Controls runtime visibles mais plusieurs actions restent futures ou bloquees.

Safe:

- Affiche uniquement des statuts/projections safe pour credentials et devices.
- Ne rend pas de password, `secret_ref`, Vault id, token, raw payload, raw logs ou internals device.

Pending:

- Sync multi-surface admin/client/BotApp.
- Audit produit complet.
- Runtime proof complet pour toutes les actions.
- Permanent delete et cleanup durable.

Ne pas casser:

- La separation entre projections safe et donnees brutes.
- Le fallback Admin API -> legacy tables.
- Les tabs Active / Archives / Trash.
- Add Profile Patch 2B.

### Client Accounts / Accounts

Route: `/instagram-dashboard/client-accounts`

Objectif:

- Vue operationnelle orientee futur dashboard client.
- Regroupe les comptes avec statuts client/customer/subscription/onboarding/provisioning/login/credentials.
- Prepare les transitions de statut et les actions client-safe.

Source de donnees:

- `app/instagram-dashboard/client-accounts-data.ts`.
- Derive de `getManageData()` et `getCredentialsActionsData()`.

Statut actuel:

- Read-only pour les statuts.
- Les selectors de status sont des controles desactives en attente d'un backend audite.
- Les actions sensibles comme Request Password Update sont marquees pending backend.

Safe:

- Affiche `passwordStatus`, `credentialsStatus`, lifecycle et liens safe.
- Pas de password ni secret.

Pending:

- Status mutations auditees.
- Client dashboard reel.
- Sync BotApp/admin/client.
- Secure credential assistance UI quand backend secure link sera pret.

Ne pas casser:

- Les actions pending ne doivent pas devenir actives sans backend.
- Les statuts client ne doivent pas etre presentes comme source de verite runtime.

### Radar

Route: `/instagram-dashboard/radar`

Objectif:

- Vue de monitoring risques: campagnes, incidents, warning logs, devices, comptes a risque.
- Drilldown par compte et liens vers Account Detail.

Source de donnees:

- `app/instagram-dashboard/radar-data.ts`.
- Admin Dashboard API si configuree.
- Fallback legacy Supabase: runs, logs, accounts/settings selon disponibilite.

Statut actuel:

- Read-only.
- Aggregations de monitoring et signaux safe.

Safe:

- Redaction des logs et metadata.
- Pas de raw XML, screenshot path, tokens, secrets ou credentials.

Pending:

- Source incidents/runtime events definitive.
- Workflow d'acquittement/resolution audite.

Ne pas casser:

- Les liens vers Account Detail.
- Les redactions de logs.
- Les signaux de risque qui alimentent Credentials/Actions.

### Server Check

Route: `/instagram-dashboard/server-check`

Objectif:

- Vue de verification serveur/runtime.
- Resume l'etat des runs, comptes, signaux systeme et readiness.

Source de donnees:

- Donnees dashboard/radar derivees.
- Routes API stats/runs/logs selon affichage.

Statut actuel:

- Read-only.

Safe:

- Statuts et compteurs seulement.
- Pas de logs bruts ni metadata sensible.

Pending:

- Health source backend definitive.
- Actions systeme auditees.

Ne pas casser:

- Le comportement non-auth doit rester une redirection vers `/restaurant-login`.

### Compass AI Advisor API

Routes API:

- `POST /api/instagram-dashboard/compass/analyze`
- `GET /api/instagram-dashboard/compass/health`

Objectif:

- Analyse server-side d'un snapshot Compass deja calcule et redige.
- Appel OpenAI uniquement depuis le dashboard admin / relay.
- Retourne un JSON structure exploitable par BotApp et le futur Compass admin.

Configuration:

- `COMPASS_AI_ENABLED=true`
- `COMPASS_AI_PROVIDER=openai`
- `COMPASS_AI_MODEL=gpt-5.5` par defaut si absent
- `OPENAI_API_KEY` cote serveur uniquement
- `BOTAPP_RELAY_API_KEY` optionnel pour autoriser BotApp sans session dashboard

Safe:

- BotApp renderer ne recoit jamais la cle provider.
- BotApp ne stocke pas et ne lit pas `OPENAI_API_KEY`; il configure seulement `BOTAPP_COMPASS_AI_RELAY_URL`.
- Le snapshot est redige avant appel provider.
- L'IA ne peut executer aucune action; elle recommande seulement.
- Les diagnostics bruts client-sensitive restent des signaux internes et non des recommandations client visibles.
- `/compass/health` expose uniquement `provider_key_configured: true/false`, jamais la valeur.
- Grounding obligatoire: `No fact in input = no recommendation`.
- Chaque recommandation acceptee doit etre liee a des `source_facts`, `evidence`, comptes/CT connus du snapshot, et une action supportee.
- Les recommandations generiques, comptes inconnus, actions destructives, categories non autorisees, signaux internes client-visibles et metriques inventees sont filtrees.
- La reponse expose `filtered_recommendations_count` et `filtered_reasons` en valeurs safe.

Prompt Compass AI:

- Prompt actuel: `app/api/instagram-dashboard/compass/analyze/compass-ai-contract.ts`.
- Construction: `buildCompassAiPrompt(snapshot)`.
- Version: `COMPASS_AI_PROMPT_VERSION`.
- Texte par defaut: `COMPASS_AI_DEFAULT_PROMPT_TEXT`.
- Guardrails verrouilles: `COMPASS_AI_LOCKED_GUARDRAILS_TEXT`.
- Schema JSON: `COMPASS_AI_OUTPUT_SCHEMA`.
- Les futurs prompts custom ne doivent remplacer que la formulation/priorisation. Les guardrails verrouilles, le schema et le validateur restent imposes apres la reponse IA.

Contrat futur AI Prompts:

- `GET /api/instagram-dashboard/ai-prompts` -> liste des prompts actifs/drafts, versions, source, audit safe.
- `POST /api/instagram-dashboard/ai-prompts/draft` -> sauvegarde d'un draft server-side.
- `POST /api/instagram-dashboard/ai-prompts/activate` -> activation auditee d'une version.
- `POST /api/instagram-dashboard/ai-prompts/test` -> test sur sample safe sans mutation.
- `POST /api/instagram-dashboard/ai-prompts/restore-default` -> rollback vers prompt default.

Fallback:

- Si la configuration provider manque, `/compass/health` et `/compass/analyze` retournent `reason: provider_key_missing`.
- Si le provider echoue ou si le JSON est invalide, la route retourne un etat safe `ai_unavailable` / `invalid_ai_output` avec les faits rules-only conserves.
- Si `BOTAPP_RELAY_API_KEY` est configure cote serveur, BotApp doit envoyer `Authorization: Bearer <key>` ou `X-BotApp-Relay-Key`.

### BotApp API Gateway / relay contracts

Objectif:

- Permettre a chaque installation BotApp packagée de configurer un relay stable sans `npm run dev`.
- Centraliser les integrations server-side: Compass AI, scoped keys, webhooks, recent safe API call audit, public relay endpoint.
- Garder toutes les valeurs secretes cote serveur/relay ou Electron main, jamais dans le renderer.

Routes deja actives:

- `GET /api/instagram-dashboard/compass/health`
- `POST /api/instagram-dashboard/compass/analyze`

Routes/contrats a brancher quand le stockage API Gateway est pret:

- `GET /api/botapp/gateway/health` -> status global, version, schema, relay/dashboard reachability, last health check.
- `GET /api/botapp/gateway/api-keys` -> prefixes only, name, scopes, status, created_at, last_used_at, call_count_today, production_call_count.
- `POST /api/botapp/gateway/api-keys` -> create scoped key; full key may be returned once only if policy allows it.
- `POST /api/botapp/gateway/api-keys/:id/rotate` -> rotate and return new one-time secret only if policy allows it.
- `POST /api/botapp/gateway/api-keys/:id/revoke` -> revoke key, audited.
- `GET /api/botapp/gateway/webhooks` -> masked URL, provider, events, status, last delivery, latest safe error.
- `POST /api/botapp/gateway/webhooks` -> save webhook URL/signing value server-side.
- `POST /api/botapp/gateway/webhooks/:id/test` -> dry-run or signed test delivery.
- `POST /api/botapp/gateway/webhooks/:id/retry` -> retry latest failed delivery.
- `POST /api/botapp/gateway/webhooks/:id/disable` -> disable delivery.
- `DELETE /api/botapp/gateway/webhooks/:id` -> remove webhook metadata and secret reference.
- `GET /api/botapp/gateway/api-calls?window=24h` -> safe request summaries only, no headers, no raw payloads.
- `GET /api/botapp/gateway/openapi.json` -> public contract docs if exposed.

Webhook events prepared:

- `slack.incident`
- `discord.incident`
- `credential.action_required`
- `account.blocked`
- `device.offline`
- `run.failed`
- `compass.critical_recommendation`
- `ct.quality_alert`
- `profile.created`
- `profile.updated`
- `profile.archived`
- `profile.targets.updated`
- `profile.session_status.changed`

Required relay headers / fields:

- `Authorization: Bearer <scoped token>` or `X-BotApp-Relay-Key` when relay auth is enabled.
- `X-Request-Id` on every request.
- `X-External-User-Id` for operator/client attribution.
- `X-Idempotency-Key` for writes and retries.
- `dry_run=true` for tests/previews.
- Response shape: `{ ok: true, data }` or `{ ok: false, error: { code, message } }`.

Security:

- API key lists return prefixes only.
- Webhook lists return masked URLs and safe errors only.
- Recent API calls never include raw payloads, bearer headers, webhook signatures, service role values, passwords, XML, screenshots, or log paths.
- OpenAI remains server-side only through the Compass relay.

### Devices / Phones

Route: `/instagram-dashboard/devices`

Objectif:

- Inventaire read-only des hosts, phones et comptes assignes.
- Regroupe les comptes par phone/mac safe label.

Source de donnees:

- `app/instagram-dashboard/devices-data.ts`.
- Combine `getManageData()` et `getRadarData()`.
- API `/api/instagram-dashboard/devices` pour Add Profile et inventaire simple.

Statut actuel:

- Inventaire principalement read-only.
- Add phone actif via route server-side safe labels only.
- Controls restart/stop/order notes desactives ou pending.

Safe:

- Affiche `phoneName`, `macHostName`, slot/source label safe.
- Cache les internals: `device_udid`, `adb_serial`, `usb_port`, `hub_port`, `app_package`, clone internals.

Pending:

- Inventory source dediee.
- Controls runtime reels.
- Sync assignments admin/BotApp/client.

Ne pas casser:

- Aucun internal device ne doit etre expose cote client.

### Activity Log

Route: `/instagram-dashboard/activity-log`

Objectif:

- Vue produit d'investigation interaction/CT, alignee avec BotApp Activity Log.
- Repondre a deux questions: un compte interagi vient de quel CT, et l'outil a-t-il reellement interagi avec un username donne.
- Les logs runtime/system/worker/device ne doivent plus etre le coeur de cette route; ils iront dans `Server Check`.

Source de donnees:

- `app/instagram-dashboard/activity-log-data.ts`.

Statut actuel:

- Read-only.
- Source interactions complete pending.
- La projection CT actuelle lit `ct_target_audit_events`, mais ne suffit pas pour prouver toutes les interactions.
- Remplacement cible: projection safe combinant `ig_interacted_users`, `ig_targets`, `ct_target_audit_events`, `ig_runs`, `account_run_requests` et labels compte client.

Safe:

- Doit recevoir uniquement des `safeSummary`, `sourceLabel`, metadata redacted.

Pending:

- Projection interaction evidence: `interacted_username`, `action_type`, `action_status`, `occurred_at`, `source_target_id`, `ct_username`, `run_id`, `request_id`, device label safe.
- Migration si necessaire pour persister le lien CT -> interaction directement dans `ig_interacted_users`.
- Variante client-safe sans device IDs internes, payload worker, logs bruts ou donnees cross-client.

Ne pas casser:

- Ne jamais remplacer cette vue par des raw logs techniques.
- Deplacer plus tard les logs techniques/admin/system/failed vers `Server Check`.

### DM Templates

Route: `/instagram-dashboard/dm-templates`

Objectif:

- Vue de gestion/lecture des templates DM et contenu outreach.

Source de donnees:

- `app/instagram-dashboard/dm-templates-data.ts`.
- Templates/settings selon sources disponibles.

Statut actuel:

- Principalement read-only/admin prep selon source disponible.
- Mutations templates se font via API templates.

Safe:

- Contenu template visible seulement comme contenu metier admin.
- Pas de secret, token, credentials, raw metadata.

Pending:

- Audit apply/save template.
- Runtime proof des templates appliques.
- Client-safe subset futur.

Ne pas casser:

- Le filtrage/redaction des payloads template.

### Credentials / Dashboard Actions

Route: `/instagram-dashboard/credentials-actions`

Objectif:

- Liste les comptes qui necessitent une action credentials/login/provisioning.
- Prepare les futures actions: update password, resolve checkpoint, complete 2FA, reconnect, acknowledge/dismiss.

Source de donnees:

- `app/instagram-dashboard/credentials-actions-data.ts`.
- Derive de `getManageData()`.

Statut actuel:

- Read-only pour la plupart des actions.
- Actions dashboard persistantes et resolutions backend pending.

Safe:

- Affiche `passwordDisplay`, `credentialsStatus`, `twoFactorDisplay`, `reauthRequired` comme statuts safe.
- Ne rend jamais password, `secret_ref`, Vault id/value ou token.

Pending:

- Backend `instagram-credentials` pour autres actions.
- Secure link client.
- Resolve/ack/dismiss persistants.
- Activity Log.

Ne pas casser:

- Ne pas activer Request Password Update avant backend secure link.

### Growth Settings

Route: `/instagram-dashboard/growth-settings`

Objectif:

- Vue read-only des settings growth, filters, package labels, sources/CT et runtime proof.

Source de donnees:

- `app/instagram-dashboard/growth-settings-data.ts`.
- Derive de Manage, settings et filters safe projections.

Statut actuel:

- Read-only.
- Tous les champs restent `runtime unverified` ou `pending proof` sauf preuve explicite.

Safe:

- Affiche seulement des projections safe.
- Ops internals caches.

Pending:

- Audit runtime Python/backend.
- Matrice requise: UI field -> API payload -> DB table/column -> Python module/function -> env hard cap -> effet runtime -> admin/client/pricing/ops.
- Pricing/client readiness.

Ne pas casser:

- Ne jamais marquer client-ready/pricing-ready sans audit runtime.

### Account Detail

Route: `/instagram-dashboard/accounts/[accountId]`

Objectif:

- Detail read-only d'un compte.
- Consolide operation status, credentials safe, assignment safe, incidents radar, targets/DM pending.

Source de donnees:

- `getManageData()` puis resolution par `accountId` ou username.

Statut actuel:

- Read-only.

Safe:

- Credentials safe only.
- Pas de password, secret reference ou Vault identifier.
- Assignment safe labels uniquement.

Pending:

- Targets summary connectee.
- DM summary connectee.
- Actions detail/audit.

Ne pas casser:

- Les retours depuis Manage/Radar/Server Check.
- La projection no-leak.

### Targets / CT modal

Surface:

- Modal/panel dans Manage via `app/instagram-dashboard/InstagramAccountTargetsPanel.tsx`.

Objectif:

- Gerer les target accounts / CT par compte.

Source de donnees:

- API `/api/instagram-dashboard/targets`
- Table legacy: `ig_targets`
- Helpers: `app/instagram-dashboard/targets-data.ts`

Etat actuel:

- Liste CT par compte.
- Colonnes: Username/avatar safe, verification, quality V1, followers_count CT, FBR performance,
  Added at/source/batch, Actions.
- KPI: Total, Deleted, Archived.
- Add / Import en jaune-orange.
- Table scrollable avec header sticky.
- `followers_count` est le nombre de followers du CT. FBR est une metrique future
  de performance apres usage du CT: followers gagnes / follows envoyes depuis ce CT.
  FBR peut rester `pending source` sans bloquer CT quality V1.
- Add single passe par la verification publique safe si le provider est active
  local/staging. `not_found` clair devient `rejected_not_found`; les limites ou
  erreurs provider restent `review_provider_unavailable` et ne rejettent jamais
  definitivement.
- Bulk import normalise/deduplique et cree des lignes `pending_verification`.
  Il ne lance pas de verification provider massive pendant le formulaire. CT-2
  cree des jobs durables qui sont verifies ensuite par petits lots.
- `POST /api/instagram-dashboard/targets/verify-batch` traite un petit lot de
  jobs `ct_target_verification_jobs` avec cache/throttle provider existants,
  met a jour `ig_targets`, puis ecrit un audit safe.
- Delete UI est mappe en archive/soft state pour garder l'historique et eviter
  une divergence silencieuse backend/frontend.

Safe:

- Username target, statut, timestamps, compteurs safe.
- Pas de raw discovery payload.
- Pas de raw provider metadata dans la table ni l'export.

Pending:

- Backend Target Discovery Service.
- Cache durable provider / quota tracking long terme.
- FBR <= 8% apres volume suffisant, uniquement comme metrique performance future.
- No followable profiles after X scrolls.
- Auto-archive avec raison.
- Source quality/FBR future.
- Sync admin/client/BotApp/backend.
- Recherche CT Pro/Premium.

Ne pas casser:

- Ne pas presenter FBR comme followers_count ni comme critere CT quality V1.
- Ne pas confondre delete target et delete account.

### Settings drawer legacy durci no-leak

Surface:

- Drawer settings dans `InstagramDashboardButtons.tsx`.
- API `/api/instagram-dashboard/settings`.

Objectif:

- Lire et modifier les settings legacy d'un compte avec projection safe.

Source de donnees:

- `ig_account_settings`.

Statut actuel:

- Mutation settings existante.
- Les champs sensibles/proteges sont preserves cote backend.

Safe:

- Le drawer retire les champs sensibles de l'edition directe.
- API retourne `password_status`, `email_display`, `device_status`, `app_package_status`, etc.

Pending:

- Migration complete vers settings safe/runtime verified.
- Audit settings.
- Client-safe subset.

Ne pas casser:

- Ne pas reintroduire password/email/device/app package bruts dans la response client.

### Add Profile wizard securise Patch 2B

Surface:

- `app/instagram-dashboard/AddProfileWizard.tsx`
- API `/api/instagram-dashboard/accounts/create`

Objectif:

- Creer un compte Instagram admin et ingester les credentials de facon securisee.

Statut actuel:

- Mutation active.
- Password write-only vers la route server-side.
- Credential orchestration backend appelee apres creation account/settings/filters.

Safe:

- Password jamais retourne au browser.
- Password jamais stocke dans `ig_account_settings.password` pour les nouveaux comptes.
- Response credentials whitelist uniquement.

Pending:

- Transaction complete Add Profile.
- Audit complet.
- Dashboard action persistante.
- Client linkage final.
- Username verification/avatar backend.
- Full Add Profile e2e prod success path avec session admin + cleanup complet.

Ne pas casser:

- Le contrat write-only password.
- L'appel server-side a `submit_add_profile_credentials`.
- L'absence de fallback legacy password.

## 3. Routes frontend

### Pages

| Route | Vue | Etat |
| --- | --- | --- |
| `/instagram-dashboard` | Manage | Active, mutations limitees |
| `/instagram-dashboard/client-accounts` | Client Accounts / Accounts | Read-only, mutations pending backend |
| `/instagram-dashboard/radar` | Radar | Read-only monitoring |
| `/instagram-dashboard/server-check` | Server Check | Read-only |
| `/instagram-dashboard/devices` | Devices / Phones | Read-only |
| `/instagram-dashboard/activity-log` | Activity Log | Read-only, source pending |
| `/instagram-dashboard/dm-templates` | DM Templates | Read-mostly/admin prep |
| `/instagram-dashboard/credentials-actions` | Credentials / Dashboard Actions | Read-only actions pending |
| `/instagram-dashboard/growth-settings` | Growth Settings | Read-only, runtime proof pending |
| `/instagram-dashboard/accounts/[accountId]` | Account Detail | Read-only |

### API routes

#### `/api/instagram-dashboard/accounts/create`

Methode: `POST`

Role:

- Creer un compte Instagram depuis Add Profile.
- Creer `ig_accounts`, `ig_account_settings`, `ig_account_filters`.
- Appeler le backend credentials securise.

Mutations:

- Insert `ig_accounts`.
- Insert `ig_account_settings`.
- Insert `ig_account_filters`.
- Update `ig_accounts.status = "support_required"` si credential ingestion echoue apres creation.

D donnees sensibles interdites:

- Password dans DB settings.
- Password dans logs/response.
- `secret_ref`, Vault id/value, token, Authorization.

Projection safe:

- `password_status`
- `credentials_status`
- `credentials_version`
- `reauth_required`
- `next_action`
- account summary safe

Env:

- `INSTAGRAM_CREDENTIALS_API_URL`
- `INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN`

Etat:

- Patch 2B actif.
- Non transactionnel complet.

#### `/api/instagram-dashboard/accounts/lifecycle`

Methode: `POST`

Role:

- Archive, trash ou restore un compte.

Mutations:

- Update `ig_accounts`.

Actions:

- `archive`
- `trash`
- `restore`

D donnees sensibles interdites:

- Aucun credential/device/token.

Projection safe:

- Row account mise a jour.

Etat:

- Soft lifecycle actif.
- Permanent delete absent.
- Scheduler/purge absent.
- Audit/sync absent.

#### `/api/instagram-dashboard/settings`

Methodes: `GET`, `PUT`, `PATCH`, `POST`

Role:

- Lire/upsert les settings d'un compte.

Mutations:

- Insert/update `ig_account_settings`.

D donnees sensibles interdites:

- Password brut.
- Email brut.
- `device_udid`, `app_package`, clone internals dans projection client.

Projection safe:

- Settings editables + statuts safe comme `password_status`, `email_display`, `device_status`, `app_package_status`.

Etat:

- Mutation legacy durcie no-leak.

#### `/api/instagram-dashboard/filters`

Methodes: `GET`, `PUT`, `PATCH`, `POST`

Role:

- Lire/upsert les filters d'un compte.

Mutations:

- Insert/update `ig_account_filters`.

D donnees sensibles interdites:

- Pas de credentials, tokens, metadata brute.

Projection safe:

- Filters et defaults safe.

Etat:

- Mutation active.
- Runtime proof pending.

#### `/api/instagram-dashboard/templates`

Methodes: `GET`, `POST`

Role:

- Lister ou creer des templates account setup/settings/filters.

Mutations:

- Insert `ig_account_templates`.
- Creation possible du template safe par defaut.

D donnees sensibles interdites:

- `password`, `email`, `device_udid`, `app_package`, `secret_ref`, `vault_id`, `token`, `authorization`, `service_role`.

Projection safe:

- Template safe redige.

Etat:

- Actif avec redaction minimale.

#### `/api/instagram-dashboard/templates/apply`

Methode: `PATCH`

Role:

- Appliquer un template a un compte.

Mutations:

- Upsert `ig_account_settings`.
- Upsert `ig_account_filters`.

D donnees sensibles interdites:

- Meme blacklist que templates.
- Ne doit pas injecter credentials/device internals via payload template.

Projection safe:

- Settings/filters appliques, sans payload sensible.

Etat:

- Actif avec redaction minimale.
- Audit apply pending.

#### `/api/instagram-dashboard/logs`

Methode: `GET`

Role:

- Lire logs techniques/runs avec redaction.

Mutations:

- Read-only.

D donnees sensibles interdites:

- Raw logs contenant password/token/secret.
- Raw XML.
- Screenshot path.
- Metadata brute sensible.

Projection safe:

- Logs redacted.

Etat:

- Disponible comme source technique, pas comme Activity Log produit.

#### `/api/instagram-dashboard/devices`

Methode: `GET`

Role:

- Lister les devices/phones disponibles pour Add Profile et vues inventory.

Mutations:

- Read-only.

D donnees sensibles interdites:

- `device_udid`, `adb_serial`, USB/hub ports, clone internals, `app_package`.

Projection safe:

- Labels device/phone/mac safe.

Etat:

- Disponible, inventory source encore partielle/pending.

#### `/api/instagram-dashboard/devices/add-phone`

Methode: `POST`

Role:

- Ajouter un phone a l'inventaire depuis l'onglet Devices.
- Accepte uniquement des labels safe: `phone_name`, `host_name`, `platform`, `status`, `notes`.

Mutations:

- Insert `ig_devices`.

D donnees sensibles interdites:

- `device_udid`, `adb_serial`, USB/hub ports, clone internals, `app_package`, tokens, Authorization.

Projection safe:

- Meme projection safe que `/api/instagram-dashboard/devices`.

Etat:

- Actif pour labels inventory admin.
- Ne prouve pas la disponibilite runtime du telephone.

#### `/api/instagram-dashboard/runs`

Methode: `GET`

Role:

- Lire les runs d'un compte.

Mutations:

- Read-only.

D donnees sensibles interdites:

- Raw runtime metadata sensible.

Projection safe:

- Run status/timestamps/counts.

Etat:

- Disponible.

#### `/api/instagram-dashboard/stats`

Methode: `GET`

Role:

- Lire stats, runs et action logs d'un compte.

Mutations:

- Read-only.

D donnees sensibles interdites:

- Raw logs ou metadata sensible non rediges.

Projection safe:

- Stats derivees.

Etat:

- Disponible.

#### `/api/instagram-dashboard/statistics`

Methode: selon implementation existante.

Role:

- Endpoint dashboard/statistics legacy ou complementaire.

Etat:

- A garder compatible avec les vues existantes.
- Verifier avant refactor car il peut servir de contrat historique.

#### `/api/instagram-dashboard/runs/health`

Methode: `GET`

Role:

- Read dispatcher readiness for guarded Play activation.

Projection safe:

- `healthy`, `playEnabled`, `dispatcherWorkerId`, `dispatcherStatus`, `lastSeenAt`, `reason`

Variables dashboard host (voir aussi `docs/instagram-dashboard-run-control.env.example`) :

- `INSTAGRAM_RUN_CONTROL_PLAY_ENABLED` : opt-out maintenance only (`false` desactive Play ; absent = active)
- `INSTAGRAM_RUN_CONTROL_DISPATCHER_WORKER_ID` : doit matcher le worker heartbeat du dispatcher Python
- `RUN_CONTROL_DISPATCHER_WORKER_ID` : alias accepte si la variable Instagram-prefixed est absente
- `INSTAGRAM_RUN_CONTROL_DISPATCHER_HEALTH_MAX_AGE_SECONDS` : fraicheur heartbeat (defaut 60)

Etat:

- Play reste disabled tant que `/runs/eligibility` retourne `ok_to_start=false`.
- Raisons run-control explicites : `play_disabled`, `dispatcher_unconfigured`, `dispatcher_unhealthy`, `dispatcher_launch_disabled`.
- Les gates compte (credentials, schedule, phases, DM, etc.) restent evalues apres le health dispatcher.

#### `/api/instagram-dashboard/runs/eligibility`

Methode: `GET`

Role:

- Projection read-only par compte pour le bouton Play (sans creer `account_run_request`).

Projection safe:

- `ok_to_start`, `reason`, `message`, `requested_run_type`, `health`

Etat:

- Le bouton Play suit uniquement `ok_to_start` (+ loading/error UI), pas un gate health global legacy cote client.

#### `/api/instagram-dashboard/runs/eligibility/overview`

Methode: `GET`

Role:

- Projection read-only pour tous les comptes actifs du dashboard admin.

Projection safe:

- `run_control` (`displayState`, `label`, `message`, `healthy`, `playEnabled`, `reason`)
- `accounts[]` : `account_id`, `username`, `readiness_status`, `play_enabled`, `reason`, `message`
- `summary` : `total`, `play_ready`, `blocked`, `needs_assignment`, `needs_credentials_or_login`

Etat:

- Aucune mutation, aucun `account_run_request`, aucun lancement de run.
- Sert a identifier les comptes Play-ready, ceux qui ont besoin d'Assign now, et ceux bloques credentials/login.

#### `/api/instagram-dashboard/assignments/now`

Methode: `POST`

Role:

- Creer ou reparer une assignment actuelle pour un compte admin sans lancer de run.

Payload:

- `account_id`

Projection safe:

- `assignment_created`, `assignment_repaired`, `status`, `reason`, `message`

Etat:

- Utilise les gates schedule existants et `assign_account_slot`.
- Ne cree jamais `account_run_request`.
- Ne route jamais vers `/runs/start`.
- Retourne `already_assigned` si la fenetre courante est deja valide.
- Retourne `capacity_unavailable` si aucun phone/app slot courant n'est disponible.

#### `/api/instagram-dashboard/runs/start`

Methode: `POST`

Role:

- Creer une demande de run production-ready via `create_account_run_request` RPC.

Gates:

- Admin auth
- Account eligibility (archived/trashed/credentials/reauth/support)
- No active `ig_runs`
- No active `account_run_requests`
- Dispatcher health gate

Mutations:

- Insert `account_run_requests` via RPC
- Audit `manual_run_requested` / `manual_run_blocked`

Projection safe:

- `started`, `message`, `request_id`, `status`, `requested_run_type`

Etat:

- Retourne `Run starting.` uniquement si le chemin dispatcher est healthy.

#### `/api/instagram-dashboard/stop`

Methode: `POST`

Role:

- Stopper un run actif et/ou annuler une demande de run en attente.

Mutations:

- Cancel active `account_run_requests` via RPC when queued/claimed/starting/running
- Update `ig_runs.status = "stopped"` when active run exists
- Insert audit `manual_run_canceled` and `run_stopped`

D donnees sensibles interdites:

- Pas de credentials, tokens, raw runtime payload.

Projection safe:

- Resultat stop safe.

Etat:

- Mutation runtime sensible; ne pas etendre sans audit/approval.

#### `/api/instagram-dashboard/targets`

Methodes: `GET`, `POST`, `DELETE`

Role:

- Lire, ajouter/importer et supprimer des target accounts d'un compte.

Mutations:

- Insert `ig_targets`.
- Soft archive `ig_targets` (`status = archived`, `archived_at`, `archive_reason`).

D donnees sensibles interdites:

- Pas de raw discovery payload, credentials, tokens.

Projection safe:

- Username/status/timestamps/metrics disponibles.

Etat:

- Actif pour targets.
- Verification Instagram backend pending.

#### `/api/instagram-dashboard/targets/reset`

Methode: `PATCH`

Role:

- Reset certains targets vers `pending`.

Mutations:

- Update `ig_targets.status`.

D donnees sensibles interdites:

- Pas de secrets ou raw metadata.

Projection safe:

- Counts/resultats safe.

Etat:

- Actif pour targets.

#### `/api/instagram-dashboard/targets/verify-batch`

Methode: `POST`

Role:

- Traiter un petit lot de jobs durables de verification CT bulk.
- Servir de processor backend manuel/admin-safe, reutilisable plus tard par un
  scheduler externe sans activer de cron maintenant.

Mutations:

- Claim atomique via `claim_ct_target_verification_jobs`.
- Update `ig_targets` avec verification/status/quality V1.
- Update `ct_target_verification_jobs`.
- Insert audit safe `ct_target_audit_events`.
- `dry_run=true` preview les jobs claimables sans RPC claim, provider call,
  update target/job ou audit insert.

Projection safe:

- Summary agrege: `claimed_count`, `processed_count`, `succeeded_count`,
  `rejected_count`, `review_count`, `retry_scheduled_count`, `skipped_count`,
  `rate_limited_count`, `provider_error_count`, `duration_ms`.
- `limit` borne a 10, `worker_id` nettoye, `max_duration_ms` borne.
- Si un job renvoie `rate_limited`, le processor stoppe le batch et remet les
  jobs deja claim mais non traites en `retry_scheduled` avec raison safe afin de
  ne pas hammer le provider.
- Aucun raw provider payload, full URL, header, key, cookie, session ou token.

Etat:

- Actif pour verification par lots.
- SearchApi production reste desactive tant qu'il n'y a pas GO operateur/env.
- Cron futur possible via Vercel Cron, Supabase scheduled function ou scheduler
  externe avec petit `limit`, spacing explicite, logs sans secret et monitoring
  sur counts/duration/rate limits.

#### `/api/instagram-dashboard/targets/verify-cron`

Methode: `GET` ou `POST`

Role:

- Entree interne token-protegee pour declencher le processor CT en petits lots
  depuis un scheduler externe (Vercel Cron, Supabase scheduled function, cron
  ops). Distinct du scheduler Instagram bot / phone runtime.
- Desactive par defaut via env. N'active pas SearchApi production.

Auth:

- `CT_TARGET_VERIFICATION_CRON_TOKEN` cote serveur uniquement.
- Accepte `Authorization: Bearer <token>` ou header
  `x-ct-target-verification-cron-token`.
- Token appelant manquant -> `401`.
- Token appelant invalide -> `403`.
- Token serveur non configure -> reponse bloquee safe, pas d'appel processor.
- Token valide mais cron desactive -> `200` skip `reason=cron_disabled`.

Env safe (defaults):

- `CT_TARGET_VERIFICATION_CRON_ENABLED=false`
- `CT_TARGET_VERIFICATION_CRON_DRY_RUN=true`
- `CT_TARGET_VERIFICATION_CRON_LIMIT=5` (borne 1..10 via processor)
- `CT_TARGET_VERIFICATION_CRON_MAX_DURATION_MS` optionnel (borne processor)
- `CT_TARGET_VERIFICATION_CRON_LOCK_TTL_SECONDS=120` (30..600)
- `CT_TARGET_VERIFICATION_CRON_WORKER_ID=ct_verify_cron` optionnel

Concurrency:

- Lock expirant Supabase via
  `claim_ct_target_verification_scheduler_lock` /
  `release_ct_target_verification_scheduler_lock`.
- Lock occupe -> `200` skip `reason=scheduler_lock_busy`, sans appel processor.

Mutations:

- Reutilise `processTargetVerificationBatch` comme `verify-batch`.
- Claim jobs, update `ig_targets`, update jobs, audit `target_verify` quand
  `dry_run=false` et enabled.

Projection safe:

- Envelope: `enabled`, `dry_run`, `limit`, `worker_id`, `lock_acquired`,
  `skipped`, `reason`, `stopped_early_reason`, `summary.*`.
- Aucun token, secret, raw provider payload, URL avec key, cookie, session ou
  Vault id.

Etat:

- Route presente, disabled-by-default.
- Aucun `vercel.json` cron actif dans le repo.
- Template scheduler externe documente ci-dessous.

Template scheduler externe (exemple, non actif):

```bash
# Exemple ops — adapter l'URL de deploiement. Ne jamais logger le token.
curl -sS -X POST "$APP_URL/api/instagram-dashboard/targets/verify-cron" \
  -H "Authorization: Bearer $CT_TARGET_VERIFICATION_CRON_TOKEN"
```

Pour activer en staging/prod: definir le token serveur, passer
`CT_TARGET_VERIFICATION_CRON_ENABLED=true`, conserver `DRY_RUN=true` jusqu'au GO
operateur SearchApi, puis activer `DRY_RUN=false` avec petit `limit`.

### CT Quality V1 Engine

Source de verite:

- `lib/instagram-target-quality.ts` centralise la decision Quality V1.
- `ig_targets` reste la source de verite partagee admin / client / BotApp pour
  `status`, `quality_status`, `verification_status`, `verification_reason`,
  `rejected_reason`, `source`, `actor_type`, archive/delete soft state et audit.

Regles V1:

- `not_found` clair -> `rejected` / `rejected_not_found`.
- `followers_count < 500` -> `rejected_low_followers`.
- `is_verified=true` -> `rejected_verified`.
- `is_private=true` -> `rejected_private`.
- canonical username different -> `review_username_changed`, sans suppression
  ni rejet brutal.
- `rate_limited`, `unavailable`, `provider_error` et provider-not-configured ne
  deviennent jamais `rejected_not_found`; ils restent pending/review puis
  `review_provider_unavailable` apres max attempts.
- Avatar manquant est un warning seulement; pas un rejet V1.
- FBR reste hors scope: performance future apres usage reel du CT, distincte de
  `followers_count`.

Sync surfaces:

- `valid` / `eligible`: visible admin + client + BotApp comme utilisable.
- `rejected_*`: visible avec raison safe, audit obligatoire pour add/verify.
- `review_*`: visible admin; client/BotApp peuvent recevoir un message safe sans
  raw provider data.
- `archived` / `deleted`: doivent rester des soft states synchronisables entre
  admin, client et BotApp quand ces surfaces existent.

### CT Lifecycle Sync

Source de verite:

- `ig_targets` porte le lifecycle partage: `status`, `archived_at`,
  `deleted_at`, `archive_reason`, `quality_status`, `verification_status`,
  raisons safe, `source` et `actor_type`.
- Quality V1 decide `eligible` / `rejected_*` / `review_*`.
- Lifecycle decide si le CT est utilisable ou non: un CT `archived` conserve sa
  quality connue mais ne doit pas etre utilise par campagne, runtime ou BotApp.

Actions actuelles:

- Delete CT reste un soft archive: `status = archived`, `archived_at = now`,
  `archive_reason = dashboard_archive`.
- Restore / unarchive est explicite via l'action `restore`; il ne cree pas de
  nouveau CT, ne modifie pas FBR/performance et bloque un doublon actif du meme
  `normalized_username` sur le meme `account_id` avec `duplicate_existing_active`.
- Restore remet directement `valid` seulement si le CT archive a encore
  `quality_status = eligible`, `verification_status = found` et une verification
  provider recente. Sinon il passe en `pending_verification` et relance la queue.
- Reset reste une re-verification technique: il ne restore pas un CT archive et
  ne doit pas etre utilise pour changer le lifecycle.

Audit safe:

- `target_archive`, `target_restore` et `target_reset` sont audites dans
  `ct_target_audit_events` avec `actor_type`, `source_surface`, raison safe,
  `previous_status`, `next_status`, `target_id` et `account_id`.
- Les cleanups de smoke doivent toujours viser des IDs explicites
  (`account_id`, `target_id`, `job_id`, `batch_id`) et jamais un `source` seul.

Mapping admin/client/BotApp:

- Admin dashboard peut archive, restore et reset.
- Client dashboard et BotApp n'ont pas encore de surface CT complete dans ce
  patch; quand elles consommeront les CT, elles devront lire la meme source
  `ig_targets` ou une projection derivee safe.
- BotApp ne doit pas selectionner `archived`, `deleted`, `rejected_*`,
  `pending_verification` ou `review_*` comme CT actifs.
- Toute action client future autorisee doit apparaitre cote admin/BotApp avec le
  meme audit safe et sans divergence silencieuse.

### Interaction Investigation Activity Log

Source:

- Activity Log admin doit devenir une projection safe d'investigation interactions/CT.
- Source cible preparee: `activity_log_interaction_evidence_admin_v1` via RPC read-only `get_activity_log_interaction_evidence_admin`.
- Sources combinees: `ig_interaction_events`, `ig_interacted_users`, `ig_targets`, `ig_runs`, `account_run_requests`, `account_assignments`, `phone_devices` et labels compte client.
- Migration additive preparee cote worker/backend: `20260611123000_activity_log_interaction_evidence.sql`.
- `ct_target_audit_events` reste utile pour les operations CT (`target_add_single`, `target_add_bulk`, `target_verify`, `target_archive`, `target_restore`, `target_reset`), mais ne prouve pas a lui seul follow/like/DM/story/unfollow.
- `metadata_safe` n'est jamais rendu brut. Seuls des champs allowlistes et des summaries safe doivent etre exposes.
- La page admin conserve un fallback legacy `ct_target_audit_events` tant que la projection evidence n'est pas appliquee/validee.

Champs affiches:

- timestamp;
- compte client;
- CT source;
- username interagi;
- action type;
- result/status;
- reason safe;
- run/request;
- device label safe cote admin/BotApp, masque cote client;
- evidence summary.

Hors scope:

- raw provider metadata;
- raw worker payloads;
- device IDs internes cote client;
- logs techniques/runtime/system. Ces logs appartiennent au futur `Server Check`.

Client-safe future:

- Reutiliser la meme projection avec filtrage strict `client_id`/`account_id`.
- Afficher seulement compte, CT, username interagi, action, date, status et summary safe.
- Masquer `run_id`, `request_id`, device interne, payloads runtime et toute donnee autre client.
- Les actions remove/archive CT doivent passer par le contrat Targets avec `source = activity_log_investigation`.

## 4. Add Profile Patch 2B

### Avant Patch 2B

Add Profile envoyait un password et la route create pouvait l'ecrire dans `ig_account_settings.password`. C'etait un stockage legacy insuffisant pour le pipeline credentials securise.

### Maintenant

Flow actuel:

1. `AddProfileWizard` collecte le username, password write-only, device/template/defaults.
2. Le browser envoie le password uniquement a `/api/instagram-dashboard/accounts/create`.
3. La route server-side valide l'admin et le payload.
4. La route cree `ig_accounts`.
5. La route cree `ig_account_settings`.
6. `ig_account_settings.password` recoit une valeur vide (`""`) pour les nouveaux comptes.
7. La route cree `ig_account_filters`.
8. La route appelle server-side l'Edge Function backend `instagram-credentials`.
9. Action backend appelee: `submit_add_profile_credentials`.
10. Le backend stocke le credential via Vault / `account_credentials`.
11. La response frontend ne contient que des champs safe.

Payload backend cible:

```json
{
  "action": "submit_add_profile_credentials",
  "account_id": "...",
  "expected_username": "...",
  "password": "write-only",
  "actor_type": "admin",
  "metadata_safe": {
    "flow": "add_profile",
    "external_request_id": "..."
  }
}
```

Response safe attendue:

- `ok`
- `request_id`
- `account_id`
- `provider`
- `credentials_version`
- `credentials_status`
- `status`
- `reauth_required`
- `next_action`
- `password_status = "write_only"`

Env server-only:

- `INSTAGRAM_CREDENTIALS_API_URL`
- `INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN`

Contraintes:

- Jamais `NEXT_PUBLIC`.
- Token jamais logge.
- Password jamais logge.
- Password jamais dans `metadata_safe`.
- Pas de `secret_ref`, Vault id/value ou token cote frontend.
- Pas de fallback legacy password.

Limites restantes:

- Add Profile n'est pas encore transactionnel.
- Si settings/filters echouent apres account create, un compte partiel peut exister.
- Pas encore d'audit complet.
- Pas encore de dashboard action persistante complete.
- Pas encore de client linkage final.
- Pas encore de username verification/avatar backend.
- Full Add Profile e2e prod success path reste a tester avec session admin et cleanup complet.

## 5. Vercel et deployment

Env Production requises:

- `ADMIN_DASHBOARD_API_URL`
- `ADMIN_DASHBOARD_INTERNAL_API_TOKEN`
- `INSTAGRAM_CREDENTIALS_API_URL`
- `INSTAGRAM_CREDENTIALS_INTERNAL_API_TOKEN`

Regles:

- Aucune variable sensible ne doit etre `NEXT_PUBLIC`.
- Redepoyer apres ajout/modification env.
- Ne pas utiliser `npx vercel --prod` depuis un working tree dirty.
- Preferer `vercel redeploy <deployment-url>` ou un auto-deploy Git propre.
- Ne jamais afficher les valeurs d'env dans logs, docs, responses ou UI.

Checks production utiles:

- `/instagram-dashboard` non-auth doit rediriger vers `/restaurant-login`.
- Pas de 500 public.
- Ne pas lancer de vrai Add Profile client en prod sans procedure smoke + cleanup.

## 6. No-leak policy stricte

Ne jamais afficher, logguer, retourner ou documenter en valeur:

- password reel
- 2FA reel persistant
- password hash
- password length
- `secret_ref`
- Vault id/value
- token
- `Authorization` header
- `service_role`
- raw settings payload
- raw templates payload
- raw metadata
- raw logs
- raw XML
- screenshot path
- `device_udid`
- `adb_serial`
- `usb_port`
- `hub_port`
- `app_package` / clone internals
- env values

Autorise:

- `password_status`
- `credentials_status`
- `two_factor_display` safe
- `email_display` masque/safe
- `phoneName` / `macHostName` safe
- `profileImageUrl` uniquement si backend safe/cache/public
- `secret_ref_present = true` seulement pour verification interne controlee, jamais la reference complete

Le password Add Profile peut seulement exister:

- dans le POST browser -> route server-side
- en memoire route server-side
- dans le POST server-side -> Edge Function credentials
- puis dans Vault cote backend

## 7. Lifecycle account

Lifecycle frontend actuel:

- `active`
- `archived`
- `trashed`
- `restore`

Comportement code actuel:

- Archive met `status = "archived"`.
- Archive pose `archived_at = now`.
- Archive pose `scheduled_trash_at = now + 30 jours`.
- Trash met `status = "trashed"`.
- Trash pose `trashed_at = now`.
- Trash pose `scheduled_delete_at = now + 30 jours`.
- Restore remet `status = "active"`.
- Restore clear `archived_at`, `trashed_at`, `scheduled_trash_at`, `scheduled_delete_at`.
- Restore pose `restored_at = now`.
- Permanent delete est visible/prepare mais non implemente.

Ce qui manque:

- Pas de scheduler/purge automatique.
- Pas de passage automatique archive -> trash.
- Pas de suppression definitive.
- Pas de cleanup credentials/Vault.
- Pas de sync BotApp/client/admin/runtime.
- Pas d'audit lifecycle durable.

Regle importante:

- Archive et trash sont restaurables avant suppression definitive.
- Le frontend ne doit pas supposer que credentials/Vault sont supprimes sur archive/trash.
- Cleanup credentials doit attendre suppression definitive ou revoke explicite.
- Archive/trash temporaire n'est pas cleanup credentials.
- Restore doit rester possible.

## 8. Targets / CT roadmap

Etat actuel:

- Liste CT par compte.
- Colonnes: Username, Verification, Quality V1, Followers, FBR performance, Added at, Actions.
- KPI: Total, Valid/eligible, Archived.
- Add / Import en jaune-orange.
- Table scrollable avec header sticky.
- `followers_count` peut etre connu via verification provider. FBR reste pending source
  tant que les follows envoyes et followers gagnes depuis ce CT ne sont pas connectes.
- Bulk import cree des jobs durables `ct_target_verification_jobs`; la verification
  est traitee ensuite par `verify-batch` en petits lots ou par `verify-cron`
  (disabled-by-default, token-protege).
- CT smoke cleanup ne doit jamais supprimer `ct_target_audit_events` par
  `metadata_safe.source` seul. Les valeurs `target_add_bulk` et
  `target_verify_batch` sont des sources fonctionnelles partagees, pas des ids
  uniques de smoke. Collecter explicitement `account_id`, `target_id`, `job_id`
  et `batch_id` pendant le smoke, puis nettoyer seulement ces ids plus le
  username/account smoke strict avec `created_at` comme garde secondaire. Si
  l'audit doit rester immuable, laisser les lignes d'audit smoke plutot que
  supprimer large.
- Incident CT-2 staging: le premier cleanup audit a utilise un predicate trop
  large base sur `metadata_safe.source`. Impact probable: audit-only, environ 25
  rows `ct_target_audit_events` bulk/verify supprimees. Les postchecks n'ont pas
  montre de suppression/modification de targets/jobs reels non-smoke. Les
  identites exactes des rows audit supprimees ne sont pas recuperables depuis la
  DB courante sans PITR/logs.
- Pas encore de vraie recherche CT Pro/Premium.

Roadmap:

- Backend Target Discovery Service.
- Canonical username.
- Avatar.
- `followers_count`.
- Regle CT quality V1: not_found, followers_count < 500, verified, private.
- Restore/unarchive CT et reconciliation archived/deleted.
- FBR future comme metrique de performance, pas comme equivalent de followers_count.
- Sync admin/client/BotApp/backend.
- Activity Log pour add/import/delete/archive/restore.

## 9. Growth Settings runtime proof

Growth Settings est read-only.

Les settings affiches sont `runtime unverified` ou `pending proof` tant qu'aucun audit runtime Python/backend ne prouve l'application reelle.

Aucun champ ne doit etre marque:

- client-ready
- pricing-ready
- runtime-verified

sans audit complet.

Matrice d'audit future requise:

```text
UI field -> API payload -> DB table/column -> Python module/function -> env hard cap -> effet runtime -> admin/client/pricing/ops
```

## 10. Backend coordination

Checkpoints backend associes:

Credential Secure Pipeline foundation:

- commit backend `fc01caf`
- tag `checkpoint-credential-secure-pipeline-foundation-20260529`

Add Profile credential orchestration Patch 2A:

- commit backend `b7bb709`
- tag `checkpoint-credential-secure-pipeline-patch2a-add-profile-orchestration-20260529`

Frontend Patch 2B:

- commit frontend `c9bc6aa`

Coordination actuelle:

- Backend Patch 2C-1 cleanup/revoke en cours cote Cursor.
- Frontend ne doit pas anticiper cleanup credentials sur archive/trash.
- Full smoke Add Profile attend cleanup Vault/DB complet.
- Toute nouvelle action credentials doit rester server-side/no-leak.

## 11. Roadmap frontend

A venir cote frontend/admin:

1. Patch 2C UI adjustments selon backend lifecycle/cleanup.
2. Add Profile full authenticated smoke avec cleanup complet.
3. Client dashboard.
4. Product/pricing page.
5. Secure credential assistance UI quand backend secure link sera pret.
6. Status selector mutations auditees pour Client Accounts.
7. Dashboard Actions resolve/ack/dismiss quand backend pret.
8. Devices controls reels quand backend/runtime pret.
9. Activity Log branche sur vrais audit events.
10. CT research Pro/Premium.
11. Username verification/avatar cache affichage reel.
12. Archive/trash/permanent delete UI sync.

## 12. Checklist avant deploy

Avant deploy:

- `npm run lint`
- `npm run build`
- no-leak scan scoped
- verifier env Vercel sans afficher les valeurs
- verifier absence de `NEXT_PUBLIC_*` sensible
- verifier `/instagram-dashboard` non-auth -> `/restaurant-login`
- verifier `git status --short`
- ne pas deploy depuis working tree dirty
- utiliser redeploy safe via Vercel existing deployment ou Git clean

No-leak scan recommande:

- Chercher `password`, `secret_ref`, `vault`, `token`, `Authorization`, `service_role`, `device_udid`, `adb_serial`, `app_package`, `localStorage`, `NEXT_PUBLIC_INSTAGRAM_CREDENTIALS`, `NEXT_PUBLIC_ADMIN_DASHBOARD`.
- Les mots peuvent exister pour redaction/status/write-only, jamais comme fuite de valeur.

## 13. Smoke Add Profile futur

Procedure future:

- Utiliser uniquement un compte test/fake.
- Utiliser uniquement un password fake.
- Avoir une session admin authentifiee.
- Ne pas utiliser de vrai client.
- Ne pas utiliser de vrai compte Instagram client.
- Ne pas lancer device/provisioner/login.

Verifier:

- Response safe.
- `password_status = "write_only"`.
- `credentials_status = "active"`.
- `credentials_version` present.
- `reauth_required = true`.
- `next_action` present.
- `ig_account_settings.password = ""`.
- `account_credentials.status = "active"`.
- `secret_ref_present = true` si verifie cote DB, sans afficher le `secret_ref`.
- `metadata_safe` ne contient pas password/token/raw body.

Cleanup:

- Supprimer rows test `ig_accounts`, `ig_account_settings`, `ig_account_filters`, `account_credentials`, `account_dashboard_actions` si creees.
- Revoquer/supprimer Vault secret si helper disponible.
- Sinon documenter le risque de secret smoke orphelin sans afficher la reference.

## 14. Ne pas faire

Ne pas faire:

- Afficher/copier password.
- Stocker password dans `ig_account_settings.password`.
- Activer Request Password Update sans backend secure link.
- Supprimer credentials sur archive/trash restaurable.
- Lancer vrai Add Profile prod sans cleanup.
- Lancer device/provisioner pendant smoke Add Profile.
- Deployer avec working tree dirty.
- Exposer tokens en `NEXT_PUBLIC`.
- Inventer `runtime verified` ou `pricing-ready`.
- Retourner `secret_ref`, Vault id/value ou token.
- Logger raw request body ou Authorization.
- Melanger target delete avec account delete.

## 15. Limites connues

- Add Profile reste non transactionnel.
- Lifecycle account ne couvre pas permanent delete.
- Retention 30 jours est stockee/affichee mais non executee automatiquement.
- Credentials cleanup n'est pas branche au lifecycle frontend.
- Activity Log produit est pending.
- Dashboard Actions persistantes sont pending.
- Client linkage final est pending.
- Device/clone assignment dediee est pending.
- Runtime Python proof est pending pour Growth Settings.
- Username verification/avatar backend est pending.
- BotApp/backend/client/admin sync est pending.

