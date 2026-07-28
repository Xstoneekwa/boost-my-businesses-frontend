# CT Premium — architecture non-DB

## Périmètre et statut

Cette phase implémente le domaine métier des propositions automatiques de comptes cibles Premium sans persistance, fournisseur externe, route API active, scheduler, notification ou email réel. Le code est isolé dans `lib/ct-premium/`. La preview React est montée uniquement sur `/ct-premium-preview` en développement ; la page appelle `notFound()` dans tout build de production et n'apparaît dans aucune navigation.

La baseline de développement est le successeur applicatif canonique `3690e6cf035f341572a1ee1a6dfeaa513d4e7d05`. Elle remplace la référence historique `d651643` du brief, conformément à la coordination SAST postérieure.

## Décisions produit

- Toute opération est scoped par `tenantId` **et** `accountId`. Une agence ne constitue jamais une unité de partage implicite.
- `ig_targets` reste la future source canonique des CT actifs, mais n'est ni lu ni écrit ici.
- Le seuil minimal d'onboarding reste 15 CT valides. Le déclencheur low-stock est `eligibleTargetCount <= 5`, quel que soit le plan.
- Growth et Pro n'obtiennent aucune génération automatique. Premium exige existence du compte, ownership actif, entitlement actif, absence de pause/cancel/blocker et lifecycle compatible.
- La revue expire exactement cinq jours après `reviewWindow.startedAt`. Toutes les règles temporelles reçoivent un `CtClock`; aucune logique métier n'appelle `Date.now()`.
- Un rejet est terminal. L'expiration ne traite que les propositions `pending`, après revalidation explicite.
- Downgrade, pause et expiration d'entitlement gèlent le batch. Cancel l'annule. Une réactivation crée éventuellement un nouveau besoin mais ne rouvre jamais l'ancien batch.
- La whitelist Unfollow n'appartient pas au domaine de proposition et ne participe donc à aucun filtre.

Les paramètres produit sont centralisés dans `config.ts` : onboarding 15 CT valides, low-stock 5, batch par défaut 10, maximum 20, cooldown rejet 30 jours et revue 5 jours.

## Modèle de domaine

Les identifiants `TenantId`, `AccountId`, `BatchId`, `ProposalId`, `SnapshotId` et `TargetId` sont des types brandés légers. Les agrégats principaux sont :

- `CtTargetingCriteriaSnapshot` : copie immuable des critères, CT actifs, historique, blacklist, configuration de revue et version de scoring ;
- `CtProposalBatch` : scope, snapshot, entitlement, fenêtre de revue, statut, version optimiste et clé d'idempotence ;
- `CtProposal` : username normalisé, score explicable, statut, décision et version ;
- `CtProposalEvent` : acteur, source, date, scope et métadonnées sûres ;
- `CtCommercialState` et `CtAccountRuntimeState` : entrées courantes des gates ;
- `CtBatchSummary` et `CtBatchActionAvailability` : projections calculées, jamais stock implicite.

## Statuts

### Batch

| Statut | Sens |
|---|---|
| `preparing` | Snapshot/recherche simulée en préparation. |
| `ready_for_review` | Propositions disponibles, fenêtre J+5 ouverte. |
| `partially_reviewed` | Au moins une décision manuelle, d'autres propositions restent pending. |
| `review_expired` | L'instant d'expiration est atteint. |
| `auto_validation_pending` | Revalidation des pending en cours ou relançable. |
| `activating` | Activations admissibles en cours. |
| `completed` | Aucun travail restant. |
| `frozen` | Lecture seule après downgrade, pause ou entitlement invalide/remplacé. |
| `canceled` | Annulation commerciale ; aucune réouverture automatique. |
| `failed` | Erreur de préparation/validation/activation au niveau batch. |

### Proposition

| Statut | Sens |
|---|---|
| `pending` | Aucune décision. Seul statut candidat à l'auto-validation. |
| `accepted` | Acceptée manuellement. |
| `rejected` | Rejet terminal et auditable. |
| `auto_accepted` | Acceptée par timeout après revalidation. |
| `invalidated` | Revalidation négative explicite. |
| `activation_pending` | Adaptateur d'activation invoqué. |
| `activated` | Activation simulée réussie. |
| `activation_failed` | Échec simulé explicite et relançable selon le futur contrat. |

Les sources de décision sont `client`, `system_timeout`, `operator` et `system_revalidation`. Les outcomes sont `accepted`, `rejected`, `auto_accepted`, `invalidated`, `activated`, `activation_failed`, `frozen` et `canceled`.

## Machine d'états

Les matrices exécutables vivent dans `state-machine.ts`. Toute transition vérifie l'état source, retourne un nouvel objet et au moins un événement, ou lève un `CtDomainError` stable.

| Action batch | Sources admises | Destination |
|---|---|---|
| `startPreparation` | `preparing` (événement initial/idempotent) | `preparing` |
| `markReady` | `preparing` | `ready_for_review` |
| `expireReview` | `ready_for_review`, `partially_reviewed` | `review_expired` |
| `startAutoValidation` | `review_expired` | `auto_validation_pending` |
| `startActivation` | `ready_for_review`, `partially_reviewed`, `auto_validation_pending` | `activating` |
| `completeBatch` | `activating`, `partially_reviewed`, `auto_validation_pending` | `completed` |
| `freezeBatch` | tout état non terminal avant activation | `frozen` |
| `cancelBatch` | tout état non finalisé, y compris `frozen` | `canceled` |
| `failBatch` | `preparing`, `auto_validation_pending`, `activating` | `failed` |

| Action proposition | Source | Destination |
|---|---|---|
| accept / reject / auto-accept / invalidate | `pending` | statut terminal de décision correspondant |
| start activation | `accepted`, `auto_accepted` | `activation_pending` |
| activation success / failure | `activation_pending` | `activated`, `activation_failed` |

## Normalisation et déduplication

`normalizeInstagramUsername` applique trim, suppression des `@` initiaux, lowercase et le format `[a-z0-9._]{1,30}`. La clé de déduplication V1 est le username normalisé.

`deduplicateCandidates` renvoie des résultats structurés avec les reason codes : `invalid_username`, `duplicate_in_batch`, `duplicate_active_target`, `duplicate_active_proposal`, `blacklisted`, `missing_profile_data`, `profile_not_eligible`. Le rejet de score ajoute `score_below_threshold`. Les ensembles actifs sont fournis exclusivement pour l'`accountId` concerné ; aucune déduplication inter-compte n'existe.

## Scoring V1

Le scoring est déterministe et ne prétend utiliser ni IA ni recherche réelle. Les dix signaux abstraits ont des poids centralisés totalisant 100 : audience 16, langue 8, géographie 10, catégorie 14, plage followers 8, engagement 12, activité 8, performance source 8, followback historique 8, confiance d'éligibilité 8.

Chaque signal est borné entre 0 et 1. Une absence simultanée de biographie et followers applique une pénalité configurable de 12. Les seuils V1 sont :

- `< 45` : `reject` ;
- `45–74.99` : `review` ;
- `>= 75` : `recommended`.

Le résultat contient total, breakdown, raisons positives, pénalités, exclusions et version `ct-premium-v1`.

## Snapshot et idempotence

Le builder canonique trie et normalise les collections, copie et gèle récursivement les valeurs, puis produit un fingerprint FNV-1a sur une sérialisation canonique excluant l'identifiant et `createdAt`. Il fige scope, entitlement abstrait, stock, ciblage, historiques, signaux, versions, fenêtre de revue, batch, cooldown et trigger. `compareSnapshotCompatibility` distingue `identical`, `compatible`, `materially_changed` et `invalid`.

## Gate 15 / trigger 5

`evaluateCtLowStockGate` est pur et reçoit son horloge. Le minimum de 15 CT valides reste le gate d'onboarding initial et ne peut pas être remplacé par le low-stock. Après readiness, un stock `<= 5` demande des CT client en Growth/Pro et autorise une simulation en Premium actif. Un batch actif, une pause, une annulation, un blocker, une ownership inactive ou un scope divergent échouent fermés. Les valeurs 15, 5, 10, 20, 30 et 5 jours sont centralisées dans `config.ts`.

## Recherche et pipeline shadow

`CtCandidateSearchProvider` abstrait la recherche. Les seuls adaptateurs présents sont fixture, déterministe, vide et en erreur; aucun n'utilise le réseau. `runCtPremiumShadowGeneration` enchaîne gate, snapshot, compatibilité/idempotence, provider, relecture facultative de l'état, normalisation, déduplication, scoring et rapport.

Le rapport expose scope, trace provider, candidats, exclusions, scores, distribution, qualité, recommandation et durées logiques. Il porte toujours `mode: shadow`, `mutationExecuted: false` et `activationAllowed: false`. Le `CtShadowBatch` a un statut distinct et n'implémente aucun port de production; `assertActivatableBatch` le refuse explicitement.

## Construction du batch

`buildProposalBatch` exécute dans l'ordre : eligibility Premium, normalisation, déduplication, scoring, tri score/username, limite maximale, fenêtre J+5, clé d'idempotence et événement `batch.ready_for_review`. Les cas aucun candidat, tous exclus, entitlement absent, stock > 5, pause, cancel et conflit idempotent ont des sorties explicites.

## Revue manuelle et J+5

`decideProposal` et `decideMany` vérifient le scope, le statut `pending`, les gates commerciales/runtime et l'expiration. Une décision ne mute jamais l'objet initial.

`evaluateExpiredBatch` :

1. compare l'horloge injectée à `expiresAt`, y compris l'égalité exacte ;
2. bloque entièrement sur downgrade, pause, cancel, blocker ou entitlement absent ;
3. passe par `review_expired` puis `auto_validation_pending` ;
4. ignore toute proposition non pending, notamment `rejected` ;
5. transforme chaque pending revalidée en `auto_accepted` ou `invalidated` avec reason code ;
6. ne redécide rien lors d'une relance.

L'activation simulée passe ensuite de `accepted`/`auto_accepted` à `activation_pending`, appelle `CtActivationPort`, puis produit `activated` ou `activation_failed`.

## Transitions commerciales

- Premium → Pro/Growth : batch `frozen`, CT déjà actifs hors domaine préservés.
- Pause : batch `frozen`, génération/revue/timeout bloqués.
- Cancel : batch non finalisé `canceled`.
- Entitlement expiré/remplacé : batch existant gelé.
- Réactivation Premium : ancien batch inchangé et read-only ; `requiresNewBatch=true` si stock <= 5.

## Ports et adaptateurs mémoire

Les ports déclarés sont `CtProposalRepository`, `CtSnapshotRepository`, `CtBatchRepository`, `CtTargetReader`, `CtBlacklistReader`, `CtEntitlementReader`, `CtNotificationPort`, `CtEmailPort`, `CtActivationPort`, avec `CtClock` et `CtIdGenerator` dans le domaine.

`InMemoryCtStore` utilise des clés composites tenant/account et des versions optimistes. Les adaptateurs notification/email ne font qu'enregistrer un intent dans un tableau. L'adaptateur d'activation mémorise une tentative idempotente et un outcome synthétique. Aucun provider, Supabase ou `ig_targets` n'est importé.

## Contrats API

`api-contracts.ts` décrit les huit chemins demandés et leurs DTO snake_case, sans fichier sous `app/api`. Les corps répètent obligatoirement `tenant_id` et `account_id`; `assertApiScope` impose l'égalité entre path et body. Les erreurs stables incluent `premium_required`, `account_not_owned`, `account_paused`, `account_canceled`, `campaign_blocked`, `review_expired`, `batch_frozen`, `batch_canceled`, `proposal_not_pending`, `cross_account_access`, `revalidation_failed`, `activation_blocked` et `idempotency_conflict`.

## UI mock et accessibilité

`CtPremiumReviewPreview` couvre préparation, revue, cartes et explications de score, décisions individuelles, sélection et décisions groupées, compteur, avertissements J+5, frozen, canceled, completed, empty et error. Les textes FR/EN indiquent que seules les pending encore éligibles après revalidation seront ajoutées et qu'un rejet ne sera jamais auto-accepté.

Le composant utilise une section nommée, des boutons natifs, labels de checkbox, statuts live et alertes. Une discordance de `tenantId` ou d'`accountId` rend un état erreur. Le harness de développement couvre les scénarios et interactions mockées ; son unique page appelle `notFound()` hors développement et n'est reliée à aucune navigation.

## Fixtures et tests

Les fixtures utilisent uniquement des identifiants `tenant_fixture_*`, `account_fixture_*`, `proposal_fixture_*` et `synthetic_*`. Elles couvrent Premium mono-compte, agence trois Premium, agence mixte, stocks 5/6, dix scores, blacklist, doublon actif, décisions partielles via statuts, J+5, downgrade, pause, cancel, réactivation, conflit de version et activation partiellement échouée.

Les tests Node couvrent les branches critiques du domaine, des adaptateurs, des DTO et de la projection UI. Le composant React est en plus validé par TypeScript, ESLint et le build Next complet.

## Harness de validation shadow

`shadow-validation/` compose 168 scénarios synthétiques avec horloge et identifiants déterministes. Les dimensions incluent plans, stocks, onze états lifecycle/commerciaux, quinze profils de provider/candidats, huit variantes de ciblage, huit états temporels/snapshot et quatre structures tenant. Vingt-cinq invariants fail-closed contrôlent scope, gate 15/5, déduplication, blacklist, targets actifs, idempotence, sérialisation, scoring et impossibilité d'activation.

La commande locale `npm run test:ct-premium-shadow` retourne un code non nul sur tout invariant en échec. Elle ne contacte aucun réseau et n'écrit aucun artefact runtime.

La Phase 4.1 ajoute `CtTargetUtilizationAssessment`, une simulation sans effet de bord de l'utilisation d'un CT. Ce modèle reste en shadow et ne participe pas au calcul de `eligibleTargetCount` : son branchement futur dépend d'une baseline DB certifiée, d'un compteur unique de profils évalués et d'un rollout replacement-first.

## Limitations et décisions ouvertes

- Recherche, vérification de profil et revalidation restent abstraites ; aucun provider réel n'est choisi ou connecté.
- Le mode shadow de production n'est pas actif : les rapports sont uniquement retournés en mémoire par le domaine.
- Les valeurs produit verrouillées sont 10 propositions par défaut, 20 maximum et 30 jours de cooldown.
- Le scheduler de timeout, la transaction d'activation et l'ordre notification/email seront définis pendant la phase DB/runtime.
- La récupération/certification globale de l'historique de migrations demeure extérieure à cette phase. Les migrations SAST héritées de la baseline ne sont pas des changements CT Premium.

## Gel DB

Aucun fichier sous `supabase/`, aucune route de production, aucun contrat email persistant, aucun Stripe, Worker ou BotApp runtime n'est modifié. La phase ne crée ni table, RPC, policy, grant, cron, send intent ou donnée. Le plan futur est détaillé séparément et ne contient aucun SQL.
