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

## Challenge code — contrat canonique multi-canal

Pipeline partagé worker / BotApp / dashboard client :

- RPC `submit_account_verification_code` + `createLoginEmailCodeResumeRunRequest` ;
- reprise dans la **même lineage de provisioning** au moyen d'une request
  `login_email_code_resume` bornée au challenge actif ; ce n'est ni une nouvelle
  session métier ni une nouvelle tentative libre de connexion.

Route client autorisée (session client + ownership) :

`POST /api/instagram-client/accounts/:id/connect/submit-verification-code`

Délègue au service canonique partagé (`submitAccountVerificationCode`).

Garanties :

- code **write-only** (jamais relu côté UI après submit) ;
- aucune valeur de code dans logs, audit, diagnostics, exports ;
- idempotence : reprise du **même** provisioning, pas de nouveau Connect ;
- code invalide / expiré / déjà consommé → message JSON client-safe.

Le contrat de challenge est commun aux canaux `email`, `sms`, `whatsapp` et
`authenticator_app`. Le Worker publie `verification_code_required` avec le
`verification_channel` détecté. Le même compte, assignment, device, app
instance, request source et challenge actif doivent être retrouvés avant toute
saisie. Une valeur soumise signifie seulement **code transmis** : elle ne
signifie jamais login réussi. Après soumission, l'Identity Guard doit encore
prouver le profil Instagram exact avant `connected` et `ready`.

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

## Auto Login, identité et readiness — chaîne canonique

```text
CTA Vérifier et connecter
  -> revalidation Backend
  -> assignment + device + app instance
  -> credentials référencés dans Vault
  -> request login_provisioning
  -> Auto Login Worker
  -> challenge éventuel et reprise multi-canal
  -> preuve d'identité exacte
  -> provisioning
  -> readiness canonique
  -> scheduler au prochain passage naturel
```

`connected` et `ready` sont deux faits distincts. `connected` décrit l'état de
login canonique. `ready` exige en plus les gates de lifecycle, package,
credentials, assignment, phone, app instance, CT éligibles, paramètres runtime,
absence de blocker et identité autorisée. Le Worker ou l'UI ne peuvent pas
court-circuiter ce calcul.

Les deux sources de preuve légitimes sont :

- `verification_source=worker` : l'Identity Guard ouvre le profil propre,
  normalise l'username attendu/détecté, prouve le match exact et persiste le run
  source ;
- `verification_source=operator` : un opérateur authentifié confirme
  explicitement le compte affiché sur l'app instance assignée via **Confirm
  login & refresh readiness**.

La preuve conserve status, source, méthode, timestamp, acteur, `account_id`,
`assignment_id`, `device_id`, `app_instance_id`, run source quand applicable,
version et lineage sans secret.

## Confirm login & refresh readiness

L'action opérateur est exposée dans BotApp Profiles. BotApp appelle, via le
relay authentifié, `POST /api/instagram-dashboard/readiness/now` avec
`operator_confirmation=true`. Le même endpoint accepte une identité Admin
authentifiée, mais le bouton Admin actuel **Run readiness now** omet ce flag et
reste donc un contrôle non confirmant. Un appel client ne possède jamais cette
capacité.

Le Backend :

1. authentifie l'opérateur et valide l'idempotency key, le Worker SHA attendu
   et la version de correction lorsque l'action est liée à un incident ;
2. revalide côté serveur account lifecycle, assignment, device, app instance,
   credentials, package runtime, CT éligibles, blockers et absence de run actif ;
3. appelle `confirm_instagram_login_operator_v1` en `service_role` ;
4. persiste une preuve `operator` / `manual_phone_review` liée à l'assignment
   observée ;
5. synchronise `account_dashboard_actions`, résout atomiquement l'incident lié
   quand il existe et prépare au plus une Resume Authorization ;
6. exécute `runReadinessNow(..., dryRun=true)` et renvoie la projection relue.

Le bouton ne fait donc jamais `ready=true` aveuglément. Un blocker retourne
`confirmation_status=blocked` ou `confirmed_not_ready`. Il ne crée aucun run,
aucun tick et aucune action téléphone. Après une résolution éligible, le
prochain tick naturel réévalue le compte avec ses paramètres canoniques ; il
n'existe pas de one-shot spécial à ce flow.

## Human Assistance Auto Login

Une page, popup ou situation inconnue ne doit jamais être interprétée comme un
succès. Le Worker échoue fermé, terminalise atomiquement request et run avec un
reason code client-safe, crée/déduplique l'incident canonique et une
`account_dashboard_action=operator_review_required`, puis utilise le notifier
d'incident Slack/Discord. Les payloads opérateur contiennent account, phase,
reason et références sûres, jamais password, OTP, token, cookie, Vault secret,
raw XML, screenshot ou serial ADB.

La déduplication repose sur le scope incident/run et la clé stable de l'action ;
les canaux possèdent leurs propres états de livraison. Un refresh, replay
idempotent ou succès Slack suivi d'un échec Discord ne crée pas une seconde
résolution ou une seconde notification. L'opérateur inspecte ensuite le compte,
utilise **Confirm login & refresh readiness**, et laisse le scheduler reprendre
au prochain tick naturel uniquement si tous les gates sont verts.

Ce workflow est compatible avec le futur handoff `client demande Auto Login ->
phone busy -> deferred safe login -> intervention équipe`. Cette tâche ne
l'active pas : la capacité de report sûr devra réutiliser la même assignment,
le même incident, la même preuve opérateur et le même recalcul readiness.

## Sécurité opérateur

- Ne jamais copier/coller un code de vérification dans Slack, tickets, logs ou exports.
- Utiliser BotApp (deep link client) pour voir l'écran Instagram pendant la vérification.
- Les secrets restent dans Vault et ne traversent ni BotApp, ni Slack/Discord,
  ni la preuve d'identité.
- L'identité opérateur est établie côté serveur. Le client ne peut pas produire
  `operator_verified` et aucune preuve locale Electron n'est autoritaire.
- `confirm_instagram_login_operator_v1` est `SECURITY DEFINER`, `search_path`
  vide et exécutable uniquement par `service_role` ; `public`, `anon` et
  `authenticated` n'ont aucun droit d'exécution.

---

## Parcours client attendu (Lucie)

1. Dashboard client → ajout compte → Check Readiness → Connect.
2. Worker ouvre Instagram sur le téléphone assigné.
3. Si Instagram demande un code Email, SMS, WhatsApp ou Authenticator :
   - request `login_provisioning` reste **active** (`running`) ;
   - statuts compte publiés : `verification_pending` / `login_verification_pending` ;
   - dashboard client : carte **Vérification requise**, popup code, CTA BotApp.
4. Client saisit le code → reprise bornée dans la même lineage de provisioning.
5. Identity Guard exact → `connected`; recalcul complet → `ready` ou blocker
   explicite.

Le parcours normal reste self-service. Une situation inconnue ou ambiguë
bascule explicitement vers Human Assistance ; elle ne fabrique jamais un succès
local.
