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
| `verification_required` | Challenge Instagram actif (`login_status=verification_pending` et/ou action runtime `enter_email_verification_code`) |
| `verification_code_submitted` | Code consommé, reprise provisioning en cours |
| `connected` | `login_status=connected` confirmé côté backend |
| `failed` | Échec terminal client-safe (hors challenge attendu) |
| `blocked` | Connect refusé (readiness, droits, capacité) |
| `not_created` | Aucune request créée |
| `already_queued` | Doublon évité |

`verification_required` provient de **`/api/instagram-client/accounts/:id/connect/progress`** (runtime canonique : request active + statuts compte + action challenge), jamais d'une simulation React seule.

---

## Progression client

1. POST Connect → statut initial (`queued`, `already_queued`, `running`, …).
2. Modal process + polling **`GET .../connect/progress`** toutes les ~8 s.
3. Étapes runtime client-safe (file, ouverture Instagram, vérification, finalisation).
4. Refresh page → reprise via même endpoint (même challenge, pas de second provisioning).
5. `connected` → fermeture popup challenge, carte compte actualisée.

---

## Challenge code — contrat canonique

Pipeline partagé worker / BotApp / dashboard client :

- RPC `submit_account_verification_code` + `createLoginEmailCodeResumeRunRequest` ;
- reprise sur la **même** request `login_provisioning` lorsque le worker détecte un challenge email (pause contrôlée, pas d'échec terminal).

Route client autorisée (session client + ownership) :

`POST /api/instagram-client/accounts/:id/connect/submit-verification-code`

Délègue au service canonique partagé (`submitAccountVerificationCode`).

Garanties :

- code **write-only** (jamais relu côté UI après submit) ;
- aucune valeur de code dans logs, audit, diagnostics, exports ;
- idempotence : reprise du **même** provisioning, pas de nouveau Connect ;
- code invalide / expiré / déjà consommé → message JSON client-safe.

Popup client : **`Vérification requise`** — champ « Code de vérification », bouton « Valider le code ». Fermeture sans annuler le provisioning. CTA persistant **« Saisir le code de vérification »** après fermeture du modal.

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
- Utiliser BotApp (deep link client) pour voir l'écran Instagram pendant la vérification.

---

## Parcours client attendu (Lucie)

1. Dashboard client → ajout compte → Check Readiness → Connect.
2. Worker ouvre Instagram sur le téléphone assigné.
3. Si Instagram affiche « Check your email / Enter the code » :
   - request `login_provisioning` reste **active** (`running`) ;
   - statuts compte publiés : `verification_pending` / `login_verification_pending` ;
   - dashboard client : carte **Vérification requise**, popup code, CTA BotApp.
4. Client saisit le code → reprise automatique sur la même request.
5. `connected` → fin du flow.

Aucune étape ne demande au client d'ouvrir un autre dashboard ou d'attendre une action opérateur manuelle.
