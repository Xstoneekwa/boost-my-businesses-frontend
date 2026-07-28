# CT Premium — Phase 4 Shadow Validation

## Objectif et périmètre

Cette phase certifie le comportement synthétique du moteur CT Premium avant toute décision de Live Shadow. Elle utilise uniquement des objets en mémoire, des providers synthétiques et une horloge fixe au `2026-07-28T12:00:00.000Z`.

HEAD initial : `dd22aadc586715bb37e2e9e19bf001fa6c2758e6`.

## Carte de configuration auditée

| Élément | Valeur actuelle | Configurable | Couvert par tests |
|---|---:|---:|---:|
| Poids scoring | 16/8/10/14/8/12/8/8/8/8, somme 100 | Oui, config versionnée | Oui |
| Seuil reject | `< 45` | Oui | Oui |
| Seuil recommended | `>= 75` | Oui | Oui |
| Pénalité profil incomplet | 12 | Oui | Oui |
| Batch par défaut | 10 | Oui | Oui |
| Batch maximum | 20 | Oui | Oui |
| Cooldown rejet | 30 jours | Oui | Oui |
| Review duration | 5 jours | Oui | Oui |
| Pool provider | `batchSize × 3` | Par snapshot | Oui |
| Gate onboarding | 15 CT valides | Centralisé | Oui |
| Trigger low-stock | `<= 5` | Centralisé | Oui |
| Reason codes | Unions stables du domaine | Version de code | Oui |
| Seuil warning score moyen | 55 | Oui, validation seulement | Oui |
| Seuil warning part review | 65 % | Oui, validation seulement | Oui |

## Architecture du harness

Le harness accepte une liste de `CtShadowValidationScenario`, reconstruit pour chaque cas un scope synthétique, une `Clock`, un `IdGenerator`, un gate, un snapshot et un provider. Il exécute le pipeline deux fois, compare les rapports, vérifie les invariants puis agrège les métriques dans un `CtShadowValidationSuite` sérialisable.

Les modèles principaux sont `CtShadowValidationRun`, `CtShadowValidationAggregate`, `CtShadowValidationFinding`, `CtShadowValidationVerdict` et `CtShadowQualityThresholds`.

Reproduction :

```bash
npm run test:ct-premium-shadow
```

Runtime requis : Node compatible avec `--experimental-strip-types`.

## Matrice synthétique

168 scénarios couvrent :

- Growth, Pro et Premium ;
- stocks 0, 1, 5, 6, 14, 15 et 20 ;
- mono-compte, agence Premium, agence mixte et comptes d'un même tenant avec critères distincts ;
- ready, onboarding incomplet, pause, cancel, blocker, batch actif, ownership inactive, lifecycle incompatible, entitlement absent/expiré/remplacé ;
- 0, 3, 10, 25 candidats, invalides, doublons, blacklistés, actifs, faibles, moyens, forts et mixtes ;
- critères larges/étroits, analyses partielles/complètes, historiques forts/faibles, followback fort et skip élevé ;
- avant/J+5/après, cooldown actif/expiré, snapshots identical/compatible/materially changed ;
- provider vide/en échec, interruption par changement d'état et conflit idempotent.

Toutes les valeurs portent les préfixes `synthetic_`, `tenant_synthetic_`, `account_synthetic_` ou `svNNN`. Aucun compte réel n'est présent.

## Invariants

Les 25 invariants exigent notamment : zéro batch Growth/Pro, zéro trigger à stock 6, distinction onboarding 15 / low-stock 5, isolation tenant/account, aucune fuite blacklist/target actif/doublon, shadow non activable, aucun effet de bord, rerun déterministe, batch maximum 20, score 0..100, exclusions raisonnées, breakdown complet, rapport sérialisable et fingerprints matériels distincts.

Résultat : **25/25 invariants verts sur 168/168 scénarios**.

## Métriques agrégées

| Métrique | Résultat |
|---|---:|
| Scénarios | 168 |
| Pass rate invariants | 100 % |
| Idempotence stable | 100 % |
| Candidats moyens par scénario | 5,93 |
| Taux d'exclusion | 21,99 % |
| Doublons | 1,41 % |
| Blacklist | 1,31 % |
| Invalides | 0,70 % |
| Propositions moyennes | 3,94 |
| Batch vide | 44,64 % (inclut volontairement gates bloqués et providers dégradés) |
| Remplissage global | 39,40 % |
| Score moyen de tous les profils scorables | 70,09 |
| Médiane | 80 |
| p10 / p25 / p75 / p90 | 25 / 60 / 95 / 95 |
| Reject / Review / Recommended | 186 / 176 / 617 |
| Snapshot new / identical / compatible / materially changed | 144 / 8 / 8 / 8 |

Exclusions principales : `score_below_threshold` 185, `blacklisted` 13, `invalid_username` 7, `duplicate_in_batch` 7 et `duplicate_active_target` 7.

Les erreurs de rapport (16,07 %) proviennent des scénarios explicitement bloqués ou en échec provider ; elles ne représentent pas une instabilité du pipeline.

## Gate 15/5

| Plan | Onboarding | Stock | Entitlement/lifecycle | Action attendue |
|---|---|---:|---|---|
| Growth | ready 15 | 5 | actif | `request_client_targets` |
| Pro | ready 15 | 5 | actif | `request_client_targets` |
| Premium | ready 15 | 5 | Premium actif | `prepare_premium_batch` |
| Premium | ready 15 | 6 | Premium actif | `no_action` |
| Premium | ready 14 | 5 | Premium actif | `onboarding_incomplete` |
| Premium | incomplete | 5 | Premium actif | `onboarding_incomplete` |
| Premium | ready 15 | 5 | paused/canceled/blocker | `blocked` |
| Premium | ready 15 | 5 | batch actif | `batch_already_active` |
| Premium | ready 15 | 5 | ownership/lifecycle invalide | `blocked` |
| Premium | ready 15 | 5 | entitlement absent/expiré | `blocked` |

Conclusion : aucun chevauchement ambigu. Le gate 15 établit la readiness initiale ; le trigger 5 ne s'applique qu'après readiness.

## Snapshots

- `createdAt`, identifiant et ordre des listes n'affectent pas le fingerprint : `identical`.
- stock, historiques, source performance, followback et signaux skip sont compatibles lorsqu'ils ne changent pas le contrat structurel : `compatible`.
- langue, géographie, niche, follower range, blacklist, CT actifs, scoring/strategy version, batch size et cooldown changent le contrat : `materially_changed`.
- une divergence tenant/account ou un snapshot structurellement invalide : `invalid`.

Les snapshots sont gelés récursivement, sérialisables et sans donnée volatile non injectée.

## Revue scoring V1

| Paramètre | Avant | Après | Justification | Impact |
|---|---:|---:|---|---|
| Poids | somme 100 | inchangé | Sensibilité monotone, aucune domination abusive | Aucun changement |
| Seuil reject | 45 | inchangé | Profils fortement inadéquats rejetés | Aucun changement |
| Seuil recommended | 75 | inchangé | Profils cohérents atteignent recommended | Aucun changement |
| Pénalité incomplète | 12 | inchangé | Effet explicable et borné | Aucun changement |
| Version | `ct-premium-v1` | inchangée | Aucun tuning fonctionnel justifié | Compatibilité préservée |

Le tuning Phase 4 porte uniquement sur l'observabilité des rapports : évaluations par candidat, top exclusions, limites de score, santé provider et recommandations opérateur.

## Recommandations opérateur

Elles sont dérivées du résultat : `ready_for_future_live_shadow`, `insufficient_candidates`, `provider_quality_low`, `snapshot_data_incomplete`, `scoring_distribution_suspicious`, `too_many_duplicates`, `too_many_blacklisted`, `manual_review_recommended` et `blocked_by_commercial_state`.

## Revue UI locale

La preview de développement a répondu HTTP 200 et a été contrôlée en français et en anglais sur les états preparing, ready, partial, frozen, canceled, completed, error, near-expiry, expired et empty. Les cartes couvrent les bandes reject/review/recommended, les décisions individuelles et groupées, les états disabled et la conservation de la sélection lors de l'ouverture d'un profil.

Chaque pseudo est un lien Instagram explicite avec l'icône `↗` adjacente, `target="_blank"`, `rel="noopener noreferrer"`, un libellé accessible FR/EN et un focus clavier visible. La revue desktop et étroite à 500 px a conduit à borner les éléments grid/flex et à autoriser le score à revenir à la ligne : aucun débordement résiduel n'a été observé. Cette route reste protégée par `NODE_ENV === "development"` et n'est pas une route de production connectée.

## Non-régression locale

- suite CT Premium et shadow : 47/47 tests verts ;
- commande dédiée shadow : 7/7 tests verts ;
- ESLint ciblé et `git diff --check` : verts ;
- typecheck ciblé des fichiers ajoutés ou modifiés en Phase 4 : aucun diagnostic ;
- build webpack : compilation réussie, puis arrêt sur l'export Next.js préexistant `buildClientNotificationsUnavailablePatchResponse` ;
- contrôles connexes : contrat notifications vert, deux assertions préexistantes restent rouges sur `whitelist_words` et `persistFilterLists` ; aucun de ces trois points n'a été modifié.

## Performance logique indicative

Mesures locales après échauffement, médiane de sept passages :

| Candidats | Médiane | Min–max observé |
|---:|---:|---:|
| 10 | 0,07 ms | 0,04–1,81 ms |
| 100 | 0,32 ms | 0,24–0,86 ms |
| 1 000 | 2,40 ms | 2,18–4,06 ms |
| 5 000 | 10,09 ms | 9,48–11,04 ms |

Ces chiffres ne constituent pas un SLA. Aucun comportement quadratique manifeste n'a été détecté ; déduplication en ensembles et tri final dominent la complexité.

## Critères futurs de Live Shadow

Avant promotion : baseline DB certifiée, provider réel approuvé, stockage de rapports isolé, feature flag fermé par défaut, vérification des secrets côté serveur, métriques de qualité en observation, concurrence/idempotence certifiées et revue humaine. La sécurité shadow doit rester séparée des ports de persistance, email, notification et activation.

## WHAT THIS PHASE DOES NOT PROVE

- Elle ne valide pas un provider réel.
- Elle ne valide pas la qualité de profils Instagram réels.
- Elle ne valide pas Supabase ni son historique de migrations.
- Elle ne valide pas la persistance.
- Elle ne valide pas les emails ou notifications.
- Elle ne valide pas l'activation dans `ig_targets`.
- Elle ne remplace pas le futur Live Shadow.

## Extension Phase 4.1 — utilisation des CT

Une simulation pure distincte étudie désormais la surexploitation d'un compte cible. Elle compare des profils uniques consommés à une audience exploitable estimée, avec fallback sur un follower count frais, minimum absolu et confiance. Elle ne modifie ni le scoring candidat, ni le gate low-stock, ni le runtime. Voir `docs/ct-target-overutilization-audit.md`.
