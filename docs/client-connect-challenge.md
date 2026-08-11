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
| `verification_required` | Challenge Instagram actif (`login_status=verification_pending` et/ou action runtime canonique soumettable ; voir contrat ci-dessous) |
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

### Taxonomie des actions soumettables

La source de vérité est le prédicat partagé
`isSubmittableVerificationAction`. Une action est soumettable uniquement si :

- elle appartient au compte demandé et son statut est actif (`pending`,
  `acknowledged`, `pending_verification` ou `code_submitted`) ;
- son type est directement `enter_email_verification_code` ; ou
- son type est `complete_two_factor`, `resolve_checkpoint` ou
  `review_login_challenge` **et** ses métadonnées prouvent le contrat canonique
  de publication :
  - `source = login_dashboard_action_publisher` ;
  - `stage = post_submit` ;
  - `human_review_required = true`.

Une action de review arbitraire, terminale, publiée par une autre source,
rattachée à un autre compte ou portant un contrat incomplet reste fail-closed.
Le frontend, la projection Connect et le service Backend utilisent le même
prédicat ; ils ne doivent pas reconstruire localement une taxonomie différente.

Lors d'une soumission valide issue d'un challenge générique, le RPC normalise
atomiquement `action_type` vers `enter_email_verification_code` pour le consumer
existant et conserve le type initial dans
`metadata.verification_source_action_type`. Cette normalisation ne se produit
qu'au moment d'une vraie soumission humaine : afficher la popup ou lire la
progression ne modifie aucune action.

### Canal de vérification canonique

Le nom historique `enter_email_verification_code` reste un identifiant de
compatibilité ; il ne signifie plus que le moteur peut remplacer le canal réel
par email. Les canaux supportés sont `email`, `sms`, `whatsapp` et
`authenticator_app`.

- le provisioning publie le canal observé dans `verification_channel` et un
  `challenge_type` cohérent ;
- la soumission humaine transmet ce canal sans le recalculer côté interface ;
- la request de reprise conserve le même canal jusqu'au Worker ;
- le Worker compare ce contrat à l'écran Instagram courant avant de lire le
  secret Vault ou de saisir le code ;
- une ancienne action sans canal n'est jamais transformée silencieusement en
  email : le Worker peut adopter le canal prouvé par l'UI courante, puis reste
  fail-closed en cas d'absence de preuve ou de divergence.

Ainsi, un challenge SMS, WhatsApp ou Authenticator ne peut pas être écrasé par
le fallback email historique. Un libellé générique « Enter code » ne suffit pas
à identifier un canal.

Garanties :

- code **write-only** (jamais relu côté UI après submit) ;
- aucune valeur de code dans logs, audit, diagnostics, exports ;
- stockage éphémère via le mécanisme Vault canonique existant ;
- RPC `SECURITY DEFINER`, appelable uniquement par `service_role`, avec garde
  interne `auth.role() = service_role` ; aucun droit `anon` ou `authenticated` ;
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

---

## Baseline production — Generic Login Verification Action Submit V1

- Migration source :
  `20260811023000_generic_login_verification_action_submit_v1.sql`.
- Version enregistrée en production :
  `20260811003315_generic_login_verification_action_submit_v1`.
- Backend runtime : `df1abb0c8d28bf10d9f31d7dd766909c5c5ea8de`.
- Déploiement : `dpl_DDynHEJk64cRNXGyzGzeQrUSF8HL` (`READY`, alias production
  `www.boostmybusinesses.com`).
- Rollback source :
  `20260811023000_generic_login_verification_action_submit_v1.down.sql`.

La certification de cette baseline vérifie le contrat générique et les droits
du RPC sans soumettre de code réel, sans créer de run/tick et sans toucher au
Worker, à BotApp ou à un téléphone.
