# Client Connect — challenge, code, BotApp phone

Document interne pour le flow **Connect réel** côté dashboard client : progression runtime, challenge Instagram, soumission de code, accès téléphone via BotApp uniquement.

Complète [`client-tenant-onboarding-e2e.md`](./client-tenant-onboarding-e2e.md).

---

## Différence Check Readiness vs Connect réel

| Action | Effet |
|--------|--------|
| **Vérifier la préparation** (`check-readiness`, `dry_run: true`) | Lecture passive : assignment, credentials, capacité. **Aucun** `login_provisioning`. |
| **Connecter le compte** (`connect`, `dry_run: false`) | Enqueue **une** request `login_provisioning` idempotente. Progression réelle jusqu'à `connected` ou challenge. |

---

## États Connect (contrat client-safe)

| État | Signification |
|------|----------------|
| `queued` | Request `login_provisioning` créée / en file |
| `already_queued` | Request active déjà présente (idempotence) |
| `running` | Dispatcher / worker en cours |
| `verification_required` | Action dashboard `enter_email_verification_code` active (runtime) |
| `verification_code_submitted` | Code consommé, reprise provisioning en cours |
| `connected` | `login_status=connected` confirmé côté backend |
| `failed` | Échec terminal client-safe |
| `blocked` | Connect refusé (readiness, droits, capacité) |
| `not_created` | Aucune request créée |
| `already_queued` | Doublon évité |

`verification_required` provient de **`/api/instagram-client/accounts/:id/connect/progress`** (runtime), jamais d'une simulation React seule.

---

## Progression client

1. POST Connect → statut initial (`queued`, `already_queued`, `running`, …).
2. Modal process + polling **`GET .../connect/progress`** toutes les ~8 s.
3. Étapes runtime client-safe (file, ouverture Instagram, vérification, finalisation).
4. Refresh page → reprise via même endpoint (même challenge, pas de second provisioning).
5. `connected` → fermeture popup challenge, carte compte actualisée.

---

## Challenge code — contrat canonique

Réutilise le même pipeline que :

- Auto Login BotApp ;
- Dashboard admin (Credentials Actions / bannière email code) ;
- RPC `submit_account_verification_code` + `createLoginEmailCodeResumeRunRequest`.

Route client autorisée (session client + ownership) :

`POST /api/instagram-client/accounts/:id/connect/submit-verification-code`

Délègue au service canonique partagé (`submitAccountVerificationCode`) utilisé aussi par Admin et BotApp.

L'admin conserve :

`POST /api/instagram-dashboard/dashboard-actions/submit-verification-code`

Garanties :

- code **write-only** (jamais relu côté UI après submit) ;
- aucune valeur de code dans logs, audit, diagnostics, exports ;
- idempotence : reprise du **même** provisioning, pas de nouveau Connect ;
- code invalide / expiré / déjà consommé → message JSON client-safe.

Popup client : **`Vérification requise`** — champ « Code de vérification », bouton « Valider le code ». Fermeture sans annuler le provisioning.

---

## Ouvrir le téléphone — BotApp uniquement

Le navigateur client **ne lance jamais** scrcpy ni ne contrôle un téléphone.

Action : **« Ouvrir le téléphone dans BotApp »**

1. `POST /api/instagram-client/accounts/:id/open-botapp-phone` (ownership vérifié).
2. Backend crée une intent signée `open_device_view` **bornée au compte** (sans exposer serial/device au client).
3. Handoff `botapp://open-device-view?intent=...`.
4. BotApp local (relay authentifié) appelle `POST /api/instagram-dashboard/botapp/open-device-view`, reçoit le serial **assigné uniquement**, ouvre/focus scrcpy. Aucun run, assignment, ni device arbitraire.

Si BotApp local indisponible :

> La vérification nécessite l'assistance de l'équipe de gestion.

Pas de fallback navigateur dangereux.

---

## Sécurité opérateur

- Ne jamais copier/coller un code de vérification dans Slack, tickets, logs ou exports.
- Utiliser BotApp (Profiles / Auto Login ou deep link) pour voir l'écran Instagram.
- Admin : même source challenge via Credentials Actions — une seule action `enter_email_verification_code` par compte.

---

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `lib/instagram-client/connect-client-contract.ts` | Statuts Connect |
| `lib/instagram-client/connect-progress-projection.ts` | Mapping runtime → statuts client |
| `lib/instagram-client/load-client-connect-progress.ts` | Loader `login_provisioning` + actions |
| `app/api/instagram-client/accounts/[accountId]/connect/progress/route.ts` | API progression client |
| `app/instagram-client/ClientVerificationModal.tsx` | Popup challenge |
| `app/api/instagram-dashboard/dashboard-actions/submit-verification-code/route.ts` | Soumission canonique |
| `app/api/instagram-dashboard/botapp/open-device-view/route.ts` | Redemption relay BotApp |
| `BotApp/electron/main.cjs` | Handler `botapp://open-device-view` |

---

## Non-régression

Auto Login BotApp et dashboard admin continuent d'utiliser :

- `account_dashboard_actions.enter_email_verification_code` ;
- `submit_account_verification_code` ;
- `createLoginEmailCodeResumeRunRequest`.

Le client Connect **ajoute une surface**, sans second système parallèle de challenge.
