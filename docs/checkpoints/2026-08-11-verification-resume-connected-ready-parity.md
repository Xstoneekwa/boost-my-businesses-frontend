# Checkpoint — Verification Resume et parité Connected/Ready

Date : 11 août 2026  
Scope : onboarding Instagram, reprise multicanal, fin post-code, publication
canonique du login et parité Client/Admin/BotApp.

## Problèmes terrain consolidés

1. Une action de vérification générique pouvait être visible mais non
   soumettable depuis le client.
2. Le canal réel SMS, WhatsApp ou Authenticator pouvait être remplacé par le
   nom historique email lors de la reprise.
3. Après soumission, la reprise physique pouvait ne pas repartir ; **Actualiser**
   ne faisait alors qu'une lecture passive.
4. Le CTA principal **Vérifier et connecter** pouvait créer/rejouer le mauvais
   chemin au lieu de continuer le provisioning existant.
5. L'écran Instagram de configuration de localisation après code bloquait la
   finalisation.
6. Le Worker pouvait prouver le bon profil puis terminer localement sans publier
   `connected / ready / ready`, laissant DB et dashboards sur
   `ready_to_connect / login_required`.

## Contrat final

```text
soumission humaine du code
-> stockage Vault write-only
-> action canonique code_submitted
-> reprise idempotente du provisioning existant
-> dispatcher
-> Worker sur le device/app-instance assigné
-> validation du canal affiché
-> saisie unique du code
-> fermeture bornée de l'écran post-code si présent
-> ouverture du profil attendu
-> identité exacte vérifiée
-> publication atomique connected / ready / ready
-> même projection Client / Admin / BotApp
```

Les canaux supportés sont `email`, `sms`, `whatsapp` et
`authenticator_app`. Une ancienne action sans canal peut adopter uniquement le
canal prouvé par l'UI Instagram courante. Toute divergence reste fail-closed.

## Commits livrés depuis la dernière documentation

### Backend

| Commit | Effet |
| --- | --- |
| `e1d60c3` | **Actualiser** peut recréer la reprise bornée manquante sans nouveau provisioning. |
| `05dd12e` | **Vérifier et connecter** continue une connexion existante comme le chemin de reprise canonique. |

Baseline production Backend :
`05dd12e29e174415f548d761e8f1fba4ff215db1`.  
Déploiement : `dpl_9UYRcgorN8SX8MywUcN2PZbmpn2e`, alias
`www.boostmybusinesses.com`.

### Worker

| Commit | Effet |
| --- | --- |
| `3591d86` | Préserve et vérifie les quatre canaux de challenge. |
| `2382113` | Ferme sûrement l'écran de localisation après le code. |
| `ce79c15` | Applique la même garde avant une sortie connectée. |
| `bed6e63` | Porte le comportement dans le moteur réellement dispatché. |
| `9859d66` | Publie la réussite exacte vers la DB canonique au lieu de terminer localement. |

Baseline Worker active :
`9859d66097e5c51463a17a08bb006912a23dd723`.  
Release immuable :
`/Users/admin/phonefarm-worker-releases/9859d66-login-ready-publish-v1`.

## Cause finale de la divergence Ready

Le run naturel de `nab_youss` avait prouvé le profil exact et terminé avec
`active_profile_matches_expected`, mais le résultat contenait :

```text
publish_attempted=false
publish_reason=not_publishable
published=false
```

La branche `already_connected_expected` forçait
`should_publish_status=false`. Le téléphone était donc connecté alors que
`client_instagram_accounts` restait en attente. Le correctif exige la preuve
d'identité stricte puis appelle le publisher canonique.

Run de provenance : `f38924b5-2b54-4860-b1a4-7cad0175286d`.  
Request de provenance : `6f53889d-af3e-459f-b5e3-9fdddf8a3384`.

## Réconciliation et état final

La réconciliation de `nab_youss` a réutilisé exclusivement la preuve du run
naturel : profil ouvert, username attendu/détecté exact et identité vérifiée.
Elle n'a pas inventé de statut et n'a pas modifié le champ legacy
`ig_accounts.status`.

État canonique final :

- sept comptes sur sept : `login_status=connected` ;
- sept comptes sur sept : `provisioning_status=ready` ;
- sept comptes sur sept : `onboarding_status=ready` ;
- `nab_youss` : preuve d'identité `verified`, profil ouvert et username exact ;
- credentials actifs, `reauth_required=false` ;
- aucune request, aucun run et aucun device lock actif au gate final.

Preuve UI production : la vue Admin projette `nab_youss` en `Ready` et
`connected`, motif `all_required_readiness_checks_passed`. Le Client et BotApp
consomment la même projection canonique Backend ; aucun badge ne fabrique
localement `ready`.

## Tests et sécurité

- Worker : tests historiques et mainline de l'orchestrateur, publisher et CLI
  ciblés verts ; `py_compile` vert ; `git diff --check` vert.
- Backend : tests de projection canonique login/readiness et parité
  Client/Admin/BotApp `12/12` verts.
- Commit Worker poussé et parité remote vérifiée.
- Activation : un switch Worker et un restart dispatcher canoniques, avec
  startup-skip consommé ; aucun doublon dispatcher.
- Runs créés manuellement : `0`.
- Ticks manuels : `0`.
- Actions ADB manuelles : `0`.
- Codes/secrets persistés dans la documentation : `0`.

## Invariants pour les comptes futurs

- aucun hardcode de tenant, account ou username ;
- les quatre canaux partagent le même moteur et la même reprise ;
- un compte déjà connecté publie sa réussite si et seulement si l'identité
  exacte est prouvée ;
- un écran post-code supporté est fermé sans accepter de permission ;
- une réussite téléphone non publiée n'est jamais considérée terminée ;
- la DB canonique précède toujours les badges Client/Admin/BotApp ;
- une invalidation explicite reste autoritaire et fail-closed.

## Verdicts

```text
GENERIC_VERIFICATION_CHANNELS_PRESERVED=YES
CLIENT_REFRESH_CAN_RESUME_EXISTING_PROVISIONING=YES
PRIMARY_CONNECT_CTA_CAN_RESUME_EXISTING_PROVISIONING=YES
POST_CODE_LOCATION_SETUP_IS_BOUNDED_AND_SUPPORTED=YES
EXACT_CONNECTED_IDENTITY_IS_PUBLISHED_CANONICALLY=YES
DB_CLIENT_ADMIN_BOTAPP_SHARE_ONE_LOGIN_READINESS_TRUTH=YES
CURRENT_AND_FUTURE_ACCOUNTS_USE_THE_SAME_CONTRACT=YES
ZERO_SECRET_IN_DOCUMENTATION=YES
```
