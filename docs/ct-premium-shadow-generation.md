# CT Premium — génération shadow non persistante

Le déclencheur d'un besoin peut désormais provenir du `Target Lifecycle Engine` universel, mais la recherche, les propositions, la revue et J+5 restent des capacités Premium. Growth/Pro ne doivent jamais appeler ce pipeline : leur policy demande des CT au client. Voir `docs/ct-system-canonical-architecture.md`.

Le pipeline shadow évalue le gate de stock, fige un snapshot canonique, interroge un fournisseur injecté, déduplique et score les candidats, puis retourne un rapport sérialisable. Il ne possède aucun port de persistance, notification, email ou activation.

Le rapport opérateur expose désormais chaque évaluation synthétique, les principales raisons d'exclusion, le score retenu le plus faible, le score rejeté le plus élevé, l'écart au seuil recommended, la santé du provider, la compatibilité du snapshot et une recommandation dérivée (`ready_for_future_live_shadow`, `insufficient_candidates`, `provider_quality_low`, `snapshot_data_incomplete`, `scoring_distribution_suspicious` ou `blocked_by_commercial_state`).

## Contrats de sécurité

- Le déclenchement Premium intervient à `eligibleTargetCount <= 5`, après onboarding valide à au moins 15 CT.
- Tenant et compte doivent correspondre à chaque étape; toute divergence échoue fermée.
- Un snapshot identique est ignoré de façon idempotente. Un changement matériel ou incompatible exige une nouvelle revue.
- L’état du compte peut être relu après la recherche; une pause, annulation ou autre changement bloque la construction.
- Le résultat porte `mode: "shadow"`, `mutationExecuted: false` et `activationAllowed: false`.
- `assertActivatableBatch` rejette toujours un `CtShadowBatch`.

Les fournisseurs fixture, vide et en erreur sont des adaptateurs de test sans réseau. Un fournisseur réel devra implémenter `CtCandidateSearchProvider` sans recevoir de capacité de persistance.

## Promotion future

Un shadow de production futur exigera d'abord une baseline DB certifiée, un provider approuvé, un stockage de rapport isolé et des métriques sur le volume brut, les exclusions, les scores moyen/médian, la distribution des bandes, la stabilité des fingerprints et les changements d'état pendant la recherche. La promotion active ne sera envisageable qu'après revue humaine de ces métriques, tests de concurrence et preuve que le guard shadow ne peut pas atteindre les ports de batch, email, notification ou activation.

La Phase 4 reste une validation synthétique locale. Elle ne constitue pas un Live Shadow et n'autorise aucun branchement de provider ou de persistance.
