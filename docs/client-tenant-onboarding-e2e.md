# Client tenant onboarding — E2E (internal)

Document interne pour le bootstrap ops → dashboard client → admin → BotApp relay.  
Voir aussi [`client-connect-challenge.md`](./client-connect-challenge.md) pour Connect réel, challenge code et BotApp phone.
Les termes techniques ci-dessous **ne doivent jamais** apparaître dans l’UI client.

---

## 1. Pré-requis tenant (ops/admin)

| Étape | Source | Condition |
|-------|--------|-----------|
| Client créé | `clients` | `clients.id` = tenant |
| Accès dashboard | Supabase Auth + `tenant_users` + `client_users` | Utilisateur lié au tenant |
| Abonnement actif | `client_subscriptions` | Statut actif requis pour add-account |
| Pas de self-service tenant | Produit | Le client ne crée **pas** son tenant ; ops bootstrap d’abord |

Scripts ops existants (réf.) : `recover-tenant-mono-account.mjs`, `link-tenant-to-instagram-account.mjs`.

---

## 2. Matrice backend → label client

| État backend réel | Label client | Couleur | Actions visibles |
|-------------------|--------------|---------|------------------|
| Aucun `client_instagram_accounts` | Aucun compte Instagram ajouté | — | Ajouter un compte Instagram |
| Compte créé, `login_status` ≠ connected, pas d’async prep | Compte ajouté | neutral | Connecter · Vérifier la préparation |
| `login_status` connecting/queued OU `provisioning_status` in_progress OU connect `request_queued` | Préparation en cours | neutral | Actualiser · Vérifier la préparation (connect disabled) |
| `login_status` = connected, `onboarding_status` ≠ ready | Compte connecté | success | Vérifier la préparation · Connecté (disabled) |
| `login_status` = connected, `onboarding_status` = ready | Compte connecté + Préparation vérifiée | success | Connecté (disabled) |
| `login_status` in needs_2fa, checkpoint, credentials_missing, etc. | Action requise | warning | Connexion à vérifier |

Implémentation : `lib/instagram-client/client-account-state.ts` (`resolveClientAccountState`).

---

## 3. Parcours add-account → surfaces

Le nouveau parcours passe exclusivement par `GET|POST|PATCH
/api/instagram-client/onboarding`. L'ancien `POST
/api/instagram-client/accounts` répond `instagram_onboarding_required` afin
d'empêcher un contournement des étapes et du seuil serveur.

### 3.1 Dashboard client

| Attribut | Valeur |
|----------|--------|
| Source | SSR `loadClientInstagramAccounts(clientId)` + `GET /api/instagram-client/accounts` |
| Refresh | Immédiat après POST/POST connect/POST check-readiness ; polling borné 8s × 12 max pendant async |
| Cache | `cache: no-store` sur GET client ; `router.refresh()` après refresh |
| Condition | Session client + `client_can_manage_instagram_account` RPC sur actions par compte |
| État affiché | Phase dérivée (Compte ajouté → … → Connecté) |
| Divergence possible | UI locale stale si pas de refresh serveur après action |
| Correction Phase 1 | Refresh serveur obligatoire ; pas de succès local sans snapshot backend |

### 3.2 `client_instagram_accounts`

| Attribut | Valeur |
|----------|--------|
| Source | Validation publique via `createClientInstagramAccount(..., dryRun: true, flowMode: "targeting_setup")`, puis insert atomique via `begin_client_instagram_onboarding` |
| Champs clés | `onboarding_status`, `provisioning_status`, `login_status` |
| Refresh | Lecture directe Supabase à chaque load/GET |
| État initial typique | onboarding=targeting_pending, provisioning=not_started, login=unknown |
| Divergence | Worker met à jour login/provisioning sans notifier le client → polling + Actualiser |

### 3.3 `client_subscription_accounts` + `account_commercial_packages`

| Attribut | Valeur |
|----------|--------|
| Source | RPC atomique `begin_client_instagram_onboarding` après verrouillage de l'entitlement réservé |
| Refresh | Inclus dans `loadClientInstagramAccounts` (package label) |
| Condition | Abonnement actif du tenant |
| Divergence | Rare ; package label peut lag si changement admin seul |

### 3.4 `ig_accounts`

| Attribut | Valeur |
|----------|--------|
| Source | Row créée à l’add-account |
| Admin | Visible dans manage/overview |
| Client | Username + package uniquement |

### 3.5 `account_assignments`

| Attribut | Valeur |
|----------|--------|
| Source | Aucune assignment avant le gate 15/15 ; réservation idempotente via `tryAutoAssignOnboardingSchedule` uniquement après finalisation serveur |
| Usage client | **Interne** — détermine faisabilité prep, jamais affiché |
| Refresh | `assignmentStatusByAccount` dans loader |
| Divergence | Sans capacité physique, l'état reste `pending_assignment`; check-readiness peut réessayer sans lancer Auto Login |

### 3.6 Admin — client-accounts / manage

| Attribut | Valeur |
|----------|--------|
| Source | `getClientAccountsOperationsData` / `getManageData` |
| Refresh | Chargement page admin (pas temps réel) |
| `botAppSync` (admin comptes) | **`connected`** — relay lit la même projection normalisée |
| Divergence | Admin peut montrer détails techniques que le client ne voit pas |

### 3.7 BotApp relay → Profiles

| Attribut | Valeur |
|----------|--------|
| Source | Relay auth → endpoints admin `client-accounts` / profiles |
| Refresh | Selon polling BotApp / ouverture Profiles |
| Condition | Compte lié tenant + relay auth durable |
| État | Profile row quand compte présent dans projection relay |
| Divergence | Délai relay vs DB directe ; pas bloquant onboarding client |

### 3.8 `botAppSync: pending` (targets — point spécial)

| Contexte | `app/instagram-dashboard/targets-data.ts` |
|----------|-------------------------------------------|
| Signification | **Sync write ciblage** vers BotApp pas encore confirmée (`clientSync: pending`, `isSyncPending` sur targets) |
| Obsolete pour comptes ? | **Oui** pour visibilité comptes — `client-accounts-data.ts` expose `botAppSync: connected` car BotApp lit la DB via relay |
| Décoratif ? | Partiellement pour **targets** ; indicateur admin ops, pas état onboarding compte |
| Remplacement client | Aucun — le client ne voit jamais ce champ ; dashboard comptes utilise phases `resolveClientAccountState` |
| Rafraîchissement | Targets : sync jobs / FBR pipeline ; Comptes : GET accounts + champs `client_instagram_accounts` |

### 3.9 Metrics Targets visibles côté client

La surface Client Targeting conserve la sémantique serveur et ne transforme
jamais une absence de donnée en zéro. Added vient de `ig_targets.created_at`,
Sent `null` affiche `—`, et Perf distingue `pending` de `insufficient_data`.
La couverture FBR est certifiée uniquement par
`followbacks_metrics_reliable_at`. Voir
[`target-metrics-contract.md`](./target-metrics-contract.md) et
[`instagram-client-targeting.md`](./instagram-client-targeting.md).

---

## 4. Étapes fonctionnelles

### 4.1 Connexion

1. `POST /api/instagram-client/onboarding` reçoit username, mot de passe,
   email optionnel et clé d'idempotence.
2. Le serveur résout l'entitlement réservé du tenant, crée les liens
   commerciaux canoniques et transmet les identifiants au Vault existant.
3. Le mot de passe n'est jamais stocké dans la session onboarding, relu ou
   renvoyé au navigateur.
4. L'état reste `targeting_pending`; aucune assignment, connexion téléphone,
   Auto Login ou exécution worker n'est lancée.
5. La confirmation signifie uniquement **Identifiants reçus**.

### 4.2 Analyse publique

- Source: projection publique réellement disponible au moment de la création
  (username, nom, biographie, avatar, followers et signaux publics supportés).
- Toute donnée indisponible est affichée **Non détecté**, jamais inventée.
- Les valeurs inchangées gardent la source `public`; les corrections du client
  sont persistées avec la source `user_confirmed`.
- Cette étape est éditable et reprise depuis la session serveur.

### 4.3 Ciblage

- Le client confirme sa niche, son audience, ses thèmes, sa langue et sa zone.
- Ces critères servent uniquement à préremplir la recherche existante de
  comptes cibles. Ils ne créent ni ne valident eux-mêmes une CT.
- Les fonctionnalités de recherche IA restent soumises au droit package
  canonique (Growth verrouillé; Pro/Premium autorisés) et au garde serveur
  existant.

### 4.4 Comptes cibles

- Le drawer et les routes CT existants restent la seule architecture de
  création, validation, archivage et restauration.
- Le compteur onboarding inclut seulement les CT actives, validées et
  éligibles. Pending, rejected, duplicate, archived, deleted ou inéligibles
  sont exclus.
- La transition `advance_client_instagram_onboarding(..., 'complete')` recompte
  directement en base et refuse 0, 14 et toute valeur inférieure à 15; 15
  permet la finalisation.

### 4.5 Terminé

- Le serveur marque la session onboarding comme terminée, puis tente une
  assignment physique idempotente seulement après le recomptage 15/15.
- Si une capacité est réservée, le lien passe à `provisioning_status=login_pending`
  et `login_status=pending_login`. Sans capacité, il reste honnêtement en
  `pending_assignment` et sera réessayé par check-readiness.
- La page confirme l'assignment seulement lorsqu'elle est prouvée. Elle
  n'affirme jamais que le compte est connecté, actif ou prêt à exécuter des
  actions.
- Auto Login reste une action ultérieure déclenchée par un clic explicite ; la
  finalisation ne crée aucun run et n'enqueue aucune connexion.
- Le parcours est idempotent et reprenable; une reprise ne redemande pas au
  serveur de relire des identifiants déjà transmis.

### 4.6 Connecter (phase ultérieure, hors parcours ciblage)

1. `POST .../connect` → `runReadinessNow` + `connectNowFromReadiness`  
2. Peut queue login preflight worker  
3. Réponse inclut `account` snapshot + `operationPending` si async  
4. UI : **Préparation en cours** + polling borné + **Actualiser**

### 4.7 Vérifier la préparation

1. `POST .../check-readiness` → `runReadinessNow` audience client  
2. Met à jour perception connected/readiness  
3. UI : **Compte connecté** ou **Préparation vérifiée** selon `onboarding_status`

### 4.8 Credentials / action requise

- Challenge 2FA, checkpoint, password → `login_status` action set  
- UI : **Action requise** + **Connexion à vérifier**  
- Reprise via reconnect / assistance admin (hors scope client copy)

### 4.9 Login / provisioning worker

- Worker `instagram_login_provisioner_orchestrator.py` met à jour DB  
- Client ne voit que phases client-safe ; refresh/polling rattrape les changements

### 4.10 Readiness

- `onboarding_status=ready` + login connected → **Préparation vérifiée**  
- Source : readiness-now + champs link table

---

## 5. Refresh contract (Phase 1)

| Action | Refresh |
|--------|---------|
| Add account | GET onboarding; session serveur persistée et reprenable |
| Connect | GET accounts + snapshot dans réponse POST |
| Check readiness | idem |
| Async en cours | Poll 8s, max 12 tentatives (~96s), puis stop |
| Processus long serveur | Bouton **Actualiser** visible si `showRefresh` |

Pas de polling infini. Pas de succès UI avant confirmation backend.

---

## 6. Isolation multi-tenant

- `requireClientInstagramSession` → `clientId = tenantId`  
- `authorizeClientInstagramAccount` → RPC `client_can_manage_instagram_account`  
- GET/POST routes scopées tenant ; tenant A ne voit/modifie jamais comptes tenant B

---

## 7. Checklist test réel (prochain tenant)

- [ ] Ops : client + auth user + abonnement actif  
- [ ] Client login → empty state « Aucun compte Instagram ajouté »  
- [ ] Connexion → « Identifiants reçus », aucun Auto Login ni assignment
- [ ] Analyse → uniquement données publiques réelles; champs absents = « Non détecté »
- [ ] Ciblage → critères persistés et préremplissage recherche CT
- [ ] Compteur CT refuse 0 et 14, accepte exactement 15 éligibles
- [ ] Rechargement navigateur reprend l'étape sans doublon commercial
- [ ] Terminé → assignment seulement après 15/15; login pending si assignment prouvée
- [ ] Terminé → aucun Auto Login, aucune action Instagram, aucun run
- [ ] Connect → « Préparation en cours », Actualiser fonctionne  
- [ ] Worker login termine → refresh → « Compte connecté »  
- [ ] Check readiness → « Préparation vérifiée » si onboarding ready  
- [ ] Admin manage : compte visible  
- [ ] BotApp Profiles : compte relay visible  
- [ ] Challenge IG → « Action requise » côté client  
- [ ] Tenant B ne voit pas compte tenant A

---

## 8. Rollback / erreurs attendues

| Erreur | Comportement client |
|--------|---------------------|
| Pas d'entitlement réservé | POST onboarding 403 |
| Username invalide / pris | Message erreur générique |
| Écriture Vault/credentials en échec | La sous-transaction métier est annulée; la session reste `failed_retryable` sans compte, ownership ni entitlement consommé |
| Moins de 15 CT éligibles | Finalisation refusée avec le compteur serveur exact |
| Worker timeout | Polling expire → Actualiser manuel |
| RPC ownership fail | 403 sur actions compte |

---

## 9. Fichiers du parcours ciblage

- `lib/instagram-client/client-account-state.ts` — machine d’états client-safe  
- `lib/instagram-client/load-client-instagram-accounts.ts` — loader partagé SSR/API  
- `lib/instagram-client/client-account-refresh.ts` — snapshot post-action  
- `lib/instagram-client/connect-account.ts` — retourne account complet  
- `app/api/instagram-client/onboarding/route.ts` — session et transitions serveur
- `lib/instagram-client/client-account-onboarding.ts` — orchestration idempotente et projections sûres
- `supabase/migrations/20260721120000_client_instagram_onboarding_sessions.sql` — session RLS + RPC finale 15 CT
- `app/instagram-client/ClientInstagramOnboardingWizard.tsx` — cinq étapes client
- `app/instagram-client/ClientAccountsSection.tsx` — ouverture et reprise du wizard
- `lib/instagram-client/client-account-onboarding.test.mjs` — seuils, reprise et non-régression
- `lib/instagram-client/client-account-onboarding-postgres.test.mjs` — concurrence réelle, rollback Vault, lease, expiration et finalisation atomique

---

*Dernière mise à jour : Phase 1 onboarding tenant — juin 2026.*

## Addendum package Follow — 2026-07-23

Lors de la création d'un compte, les caps Follow configurés sont initialisés
depuis `default_follow_day_cap` et `default_follow_session_cap` du package lié.
Ils peuvent ensuite être abaissés, mais jamais dépasser les maxima du package.
Le warmup n'est pas persisté dans ces champs et l'onboarding ne consomme aucune
journée active sans événement `follow_verified` réel.
