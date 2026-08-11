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

---

## Continuité client après soumission du code

La soumission du code ne constitue pas la fin du parcours. Elle fait passer le
compte dans un état de reprise durable, que le client doit pouvoir continuer
sans recréer un onboarding ni perdre le canal de vérification.

Deux CTA partagent désormais la même décision serveur :

- **Actualiser** relit la progression et, si le code est enregistré mais que la
  reprise physique n'est plus active, recrée uniquement la reprise bornée du
  provisioning existant ;
- **Vérifier et connecter** reprend également le provisioning existant avant
  d'en créer un nouveau. Il est donc utilisable après un refresh, une fermeture
  de popup ou un retour sur la carte du compte.

Le contrat est idempotent : une request active est réutilisée, un challenge
actif conserve son action et son canal, et une reprise n'est créée que si le
backend prouve qu'elle manque. Aucun des deux CTA ne crée une session Growth,
ne modifie les caps et ne contourne les gates d'identité.

Implémentations de référence :

- `e1d60c3` — **Actualiser** relance sûrement une reprise devenue absente ;
- `05dd12e` — le CTA principal **Vérifier et connecter** sait continuer une
  connexion déjà engagée.

## Sortie du challenge Instagram et écran post-code

Après acceptation du code, Instagram peut afficher l'écran de configuration
« Set up on new device » / « To use Location services, allow Instagram to
access your location ». Ce n'est ni un nouveau challenge, ni une preuve
d'échec.

Le Worker reconnaît cette famille d'écran dans les deux moteurs de
provisioning actifs, ferme la surface avec un unique retour Android sûr, puis
reprend la vérification du profil attendu. Il ne clique pas sur **Continue**,
n'accepte aucune permission de localisation et ne marque pas le compte connecté
sur la seule présence de cet écran.

L'ordre de livraison Worker est conservé :

- `2382113` — fermeture bornée après saisie du code ;
- `ce79c15` — même garde avant la sortie `connected` ;
- `bed6e63` — parité du moteur réellement dispatché et de l'adaptateur
  historique.

## Publication canonique `connected / ready / ready`

Une réussite physique n'est pas suffisante tant qu'elle n'est pas publiée. Le
chemin `already_connected_expected` doit appeler le publisher canonique au lieu
de terminer localement avec `should_publish_status=false`.

La publication `connected / ready / ready` est autorisée uniquement lorsque :

- le profil Instagram attendu a été ouvert ;
- `expected_username` et `actual_logged_in_username` correspondent après
  normalisation ;
- `expected_identity_verified=true` ;
- `identity_verification_status=verified` ;
- la provenance contient le `run_id` de la vérification physique.

Le RPC canonique met alors à jour atomiquement :

- `client_instagram_accounts.login_status=connected` ;
- `provisioning_status=ready` ;
- `onboarding_status=ready` ;
- la preuve d'identité et sa provenance ;
- `account_credentials.reauth_required=false` ;
- les projections runtime et actions de dashboard associées.

Le champ legacy `ig_accounts.status` n'est pas une source de vérité de login et
ne doit pas être réécrit pour fabriquer la parité. La source canonique est
`client_instagram_accounts`, enrichie par la preuve d'identité.

Le correctif générique est le Worker `9859d66097e5c51463a17a08bb006912a23dd723`.
Il couvre le moteur courant et l'adaptateur historique 07ee.

## Parité DB, Client, Admin et BotApp

Les trois surfaces consomment la même projection Backend :

- le dashboard client charge `client_instagram_accounts`, applique
  `projectCanonicalLoginStatus` et projette un compte connecté en
  `already_connected` ;
- l'admin charge les mêmes statuts et la même preuve d'identité avant de
  calculer la readiness ;
- l'endpoint BotApp `client-accounts` réutilise la projection d'opérations
  Backend, sans recalcul local de `ready`.

Règle produit :

```text
canonical login = connected
+ canonical provisioning = ready
+ canonical onboarding = ready
+ aucun blocker canonique
=> Client, Admin et BotApp affichent connected + ready
```

Un refresh ou un restart de BotApp ne doit pas modifier ce résultat. Une
invalidation explicite et plus récente peut en revanche faire repasser le
compte en état d'assistance ; les snapshots sociaux, un vieux `can_start` ou un
fallback UI ne le peuvent pas.

## Baseline finale certifiée — 11 août 2026

- Backend production : `05dd12e29e174415f548d761e8f1fba4ff215db1` ;
- déploiement Vercel : `dpl_9UYRcgorN8SX8MywUcN2PZbmpn2e` ;
- Worker actif : `9859d66097e5c51463a17a08bb006912a23dd723` ;
- release : `/Users/admin/phonefarm-worker-releases/9859d66-login-ready-publish-v1` ;
- dispatcher certifié unique depuis cette release ;
- compte terrain `nab_youss` réconcilié depuis la preuve naturelle du run
  `f38924b5-2b54-4860-b1a4-7cad0175286d` et de la request
  `6f53889d-af3e-459f-b5e3-9fdddf8a3384` ;
- état final observé : sept comptes sur sept en
  `connected / ready / ready` dans la DB canonique ;
- admin production : `nab_youss` affiché `Ready`, `connected`, motif
  `all_required_readiness_checks_passed` ;
- aucun code de vérification, secret Vault, XML, screenshot téléphone ou
  donnée d'authentification n'est documenté.

Le rapport détaillé et les invariants de livraison sont archivés dans
[`checkpoints/2026-08-11-verification-resume-connected-ready-parity.md`](./checkpoints/2026-08-11-verification-resume-connected-ready-parity.md).
