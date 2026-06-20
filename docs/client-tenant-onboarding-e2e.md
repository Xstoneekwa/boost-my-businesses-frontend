# Client tenant onboarding — E2E (internal)

Document interne pour le bootstrap ops → dashboard client → admin → BotApp relay.  
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

Compte théorique `@tenant_next` tracé après `POST /api/instagram-client/accounts`.

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
| Source | Insert via `createClientInstagramAccount` |
| Champs clés | `onboarding_status`, `provisioning_status`, `login_status` |
| Refresh | Lecture directe Supabase à chaque load/GET |
| État initial typique | onboarding=pending, provisioning=not_started, login=unknown |
| Divergence | Worker met à jour login/provisioning sans notifier le client → polling + Actualiser |

### 3.3 `client_subscription_accounts` + `account_commercial_packages`

| Attribut | Valeur |
|----------|--------|
| Source | `ensureAddProfileOwnership` dans create-account |
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
| Source | `tryAutoAssignOnboardingSchedule` → RPC `assign_account_slot` |
| Usage client | **Interne** — détermine faisabilité prep, jamais affiché |
| Refresh | `assignmentStatusByAccount` dans loader |
| Divergence | pending_assignment côté backend pendant que client voit « Préparation en cours » après connect |

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

---

## 4. Étapes fonctionnelles

### 4.1 Ajout compte (client)

1. `POST /api/instagram-client/accounts` — username, password, email optionnel  
2. Crée `ig_accounts`, lien `client_instagram_accounts`, ownership subscription/package  
3. Credentials → Vault (Edge API) si configuré  
4. Auto-assignment tenté (non bloquant)  
5. UI : refresh GET → badge **Compte ajouté**

### 4.2 Connecter

1. `POST .../connect` → `runReadinessNow` + `connectNowFromReadiness`  
2. Peut queue login preflight worker  
3. Réponse inclut `account` snapshot + `operationPending` si async  
4. UI : **Préparation en cours** + polling borné + **Actualiser**

### 4.3 Vérifier la préparation

1. `POST .../check-readiness` → `runReadinessNow` audience client  
2. Met à jour perception connected/readiness  
3. UI : **Compte connecté** ou **Préparation vérifiée** selon `onboarding_status`

### 4.4 Credentials / action requise

- Challenge 2FA, checkpoint, password → `login_status` action set  
- UI : **Action requise** + **Connexion à vérifier**  
- Reprise via reconnect / assistance admin (hors scope client copy)

### 4.5 Login / provisioning worker

- Worker `instagram_login_provisioner_orchestrator.py` met à jour DB  
- Client ne voit que phases client-safe ; refresh/polling rattrape les changements

### 4.6 Readiness

- `onboarding_status=ready` + login connected → **Préparation vérifiée**  
- Source : readiness-now + champs link table

---

## 5. Refresh contract (Phase 1)

| Action | Refresh |
|--------|---------|
| Add account | GET accounts immédiat après POST OK |
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
- [ ] Add account → badge « Compte ajouté », pas de termes techniques  
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
| Pas d’abonnement actif | POST add-account 403 |
| Username invalide / pris | Message erreur générique |
| Credentials API down | Add peut réussir ; connect/action required plus tard |
| Assignment indisponible | « Préparation en cours » après connect ; pas d’exposition assignment |
| Worker timeout | Polling expire → Actualiser manuel |
| RPC ownership fail | 403 sur actions compte |

---

## 9. Fichiers Phase 1

- `lib/instagram-client/client-account-state.ts` — machine d’états client-safe  
- `lib/instagram-client/load-client-instagram-accounts.ts` — loader partagé SSR/API  
- `lib/instagram-client/client-account-refresh.ts` — snapshot post-action  
- `lib/instagram-client/connect-account.ts` — retourne account complet  
- `app/api/instagram-client/accounts/route.ts` — GET liste  
- `app/instagram-client/ClientAccountsSection.tsx` — refresh + polling borné  
- `lib/instagram-client/client-account-state.test.mjs` — tests états  

---

*Dernière mise à jour : Phase 1 onboarding tenant — juin 2026.*
