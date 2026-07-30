# Target Availability — Identity, Assessment, Current et Replay

Statut : `CONSTRUCTED / TESTED / NOT DEPLOYED / NOT OBSERVED IN PRODUCTION`

Date : 2026-07-30

Cette construction transforme des observations Availability déjà scopées en historique/courant d'identité, assessments append-only et projection `availability_current`. Elle ne produit aucune action métier, ne modifie aucun CT et ne dépend ni de React, ni de l'UI, ni de Supabase, ni du Target Lifecycle, ni de Premium Replacement.

## Frontières

```text
observations brutes
        |
        +--> Identity Resolution --> identity_history + identity_current
        |
        +--> Availability Assessment (pur, versionné, rejouable)
                                      |
                                      v
                              availability_current

Performance + Utilization + Availability Current --> Target Lifecycle (hors phase)
Target Lifecycle + policy commerciale -----------> Premium Replacement (hors phase)
```

Availability qualifie l'accessibilité et l'identité. Il n'utilise ni rendement Follow, ni consommation historique, ni package. Lifecycle, archivage, remplacement, notification et email restent strictement hors périmètre.

## Identity Resolution

Le moteur `identity-engine.ts` accepte uniquement un scope complet `(tenant_id, account_id, target_id)`. Il trie les observations, rejette tout scope partiel ou différent, déduplique par clé d'idempotence, puis produit :

- un `identity_history` append-only ;
- un `identity_current` déterministe et reconstruisible ;
- des événements d'observabilité courts et sérialisables.

États canoniques : `identity_confirmed`, `identity_probable`, `username_change_suspected`, `username_change_confirmed`, `identity_conflict`, `identity_ambiguous`, `stable_id_missing`, `stale_identity`, `insufficient_identity_evidence`.

Une correspondance de stable ID déjà certifié peut confirmer un changement de username. Sans stable ID, même une répétition reste fail-closed : aucun renommage automatique, aucune fusion de CT et aucun changement de `target_id`. Un stable ID incompatible produit immédiatement `identity_conflict`.

### Stable Instagram ID

Verdict : **OPTION B — récupérable plus tard via une instrumentation dédiée, mais pas disponible de manière fiable dans le chemin Worker UI actuel.**

- Les lignes CT actuellement auditées ne stockent pas d'ID Instagram stable canonique.
- La navigation UI Worker n'expose pas de numeric ID fiable et aucune nouvelle capture réseau n'est ajoutée ici.
- Le provider de profil public existant sait retourner `instagram_user_id` ou `external_profile_id` lors d'une validation dédiée, avec coût réseau et hors Golden Flow.
- Le Worker accepte déjà un stable ID uniquement lorsqu'une donnée préalablement certifiée le fournit.
- Le username n'est jamais traité comme un stable ID.

Une phase ultérieure devra certifier source, coût, fréquence, droit d'usage et provenance avant d'alimenter le moteur. D'ici là, les transitions sensibles restent `suspected`, `ambiguous` ou `stable_id_missing`.

## Availability Assessment

Le moteur pur `assessment-engine.ts` prend l'identité courante et les observations fraîches, puis produit exactement un assessment append-only. À entrées, horloge et versions identiques, l'ID et le résultat sont identiques.

États : `available`, `likely_available`, `temporarily_unavailable`, `unavailable_suspected`, `unavailable_confirmed`, `identity_changed`, `identity_ambiguous`, `verified_restricted_suspected`, `verified_restricted_confirmed`, `stale`, `insufficient_evidence`, `conflicting_evidence`.

Le résultat explique : observations contributrices/ignorées, répétition, reasons, preuves manquantes, premières/dernières preuves, expiry, règle, moteur et révisions.

### Confidence

Un seul modèle qualitatif est utilisé : `unknown < low < medium < high`.

- `unknown` : aucune preuve fraîche exploitable ;
- `low` : preuve ambiguë/temporaire ou confirmation manquante ;
- `medium` : preuve directe mais encore isolée ;
- `high` : identité stable, récupération démontrée ou règle répétée sur runs distincts.

Le moteur ne possède pas un second score caché. Les poids restent documentaires et centralisés ; le statut final est déterminé par des règles explicites.

### Repeat policy et règle Verified Restricted

Toutes les règles vivent dans `engine-policy.ts`, version `target-availability-rules-v1`.

| Signal | Répétitions / runs distincts | Règle ferme |
|---|---:|---|
| `profile_available` | 1 / 1 | Disponibilité probable ; confirmation renforcée par répétition. |
| `profile_unavailable` | 2 / 2 | Jamais permanent au premier passage. |
| `account_deleted`, `account_suspended`, `account_banned` | 2 / 2 | Indisponibilité confirmée seulement après répétition. |
| `username_changed` | 1 / 1 | Confirmé uniquement si le stable ID connu correspond. |
| `username_change_suspected` | 2 / 2 | Reste suspect sans stable ID. |
| `temporary_instagram_error`, `network_error` | aucune confirmation permanente | Conserve une ambiguïté temporaire. |
| `identity_conflict` | immédiat | Fail-closed, aucune mutation d'identité. |
| `verified_followers_restricted` | 2 / 2 | Badge + surface réellement restreinte + fraîcheur + absence de contradiction. |

`verified_badge_present` seul n'est jamais une preuve d'indisponibilité. Badge + restriction sur un seul passage produit au maximum `verified_restricted_suspected`.

### TTL et freshness

| Contrat | Valeur locale V1 |
|---|---:|
| Login wall, erreurs Instagram/réseau, evidence insuffisante | 15 min |
| Profile unavailable, access restriction, followers restriction, UI ambiguity | 1 h |
| Profile available, deleted/suspended/banned | 24 h |
| Username et verified restriction | 7 j |
| Identité stale | 14 j |
| Fenêtre de répétition | 7 j |
| Assessment standard / temporaire / ambigu | 24 h / 1 h / 15 min |

Une observation future ou au timestamp invalide est rejetée. Une preuve hors TTL ne reste pas autoritaire. Une disponibilité plus récente neutralise une suspicion temporaire antérieure ; une erreur temporaire plus récente ne transforme jamais seule une cible en indisponibilité permanente.

## Availability Current

`current-projection.ts` applique un assessment à une projection courante sans effet de bord. La clé reste `(tenant_id, account_id, target_id)`.

- retry exact : `unchanged` ;
- scope différent : `rejected_scope` ;
- assessment plus ancien : `skipped_stale_event` ;
- régression engine/policy : `skipped_version_regression` ;
- concurrence : sélection déterministe par temps puis `assessment_id` ;
- reconstruction complète : même résultat indépendamment de l'ordre d'arrivée.

La projection contient statut Availability, confidence, identité, latest assessment/observation, confirmation, validity/stale, reasons et versions. Elle n'autorise aucune action.

## Replay Harness

Commande locale :

```bash
/Users/admin/.nvm/versions/node/v22.22.2/bin/node --experimental-strip-types lib/target-availability/replay-cli.ts
```

Un fichier JSON alternatif peut être passé en premier argument. Le rapport JSON contient inputs, accepted/rejected, doublons, transitions, identité finale, assessments, current final, invariants, timing et événements locaux.

Les 30 fixtures obligatoires couvrent notamment stable/temporary/permanent, rename avec/sans stable ID, conflits, scope cross-tenant, doublons, out-of-order, Verified Restricted, stale, concurrence, interruption/reprise, version upgrade, réutilisation de username, payload partiel et volumétrie 1 000 observations.

### Mesures locales indicatives

Mesures Node.js 22.22.2 sur cette machine, sans I/O réseau ou DB, à ne pas interpréter comme SLO production :

| Cas | Replay total | Identity | Assessment | Current |
|---|---:|---:|---:|---:|
| 100 observations | 2,066 ms | 0,893 ms | 0,652 ms | 0,093 ms |
| 1 000 observations | 18,274 ms | 1,867 ms | 7,246 ms | 0,013 ms |
| Doublon exact (2 inputs, 1 accepté) | 0,195 ms | 0,106 ms | 0,066 ms | 0,011 ms |
| Deux workers concurrents | 0,067 ms | 0,029 ms | 0,031 ms | 0,001 ms |

La suite complète de 30 fixtures (1 043 inputs) a pris 46,243 ms lors de la mesure de référence. Les variations d'ordonnancement et de chauffe V8 sont attendues. Seuils de revue proposés, non activés : suivre p50/p95 sur snapshots représentatifs, déclencher une investigation en cas de croissance superlinéaire et conserver le chemin runtime hors de ce calcul jusqu'au Shadow dédié.

## Contrat DB local — NOT DEPLOYED

Migration locale : `supabase/migrations/20260730123708_ct_target_availability_identity_assessment_current_v1.sql`.

Elle complète de manière additive les tables existantes avec les champs d'historique, current, evidence IDs, versions, expirations et projection. Les vocabulaires V3 coexistent avec les colonnes legacy afin de préserver la compatibilité ; aucun backfill et aucune modification de donnée n'est inclus.

Le contrat canonique comporte **41 colonnes additives** (7 Identity History, 8 Identity Current, 14 Assessment, 12 Availability Current) et quatre index. L'inventaire exhaustif, les types, usages, effets de sécurité et l'explication de l'ancien chiffre 37 sont dans `docs/contracts/target-availability-v1-db-column-contract.md`. Le SQL est la source autoritaire et le test statique en dérive automatiquement le total.

Sécurité : RLS activée et forcée, aucun grant `public`, `anon` ou `authenticated`, `service_role` limité à `SELECT/INSERT` sur les journaux append-only et `SELECT/INSERT/UPDATE` sur les projections courantes. Aucune fonction ni `SECURITY DEFINER` n'est ajoutée. Les champs d'explication sont safe/structurés ; aucune trace UI brute ou secret n'est attendu.

Rollback documentaire : `supabase/rollback/20260730123708_ct_target_availability_identity_assessment_current_v1.down.sql`. Il n'est pas autorisé ni appliqué.

## Observabilité locale

Événements : `assessment_created`, `assessment_rejected`, `identity_transition_created`, `identity_conflict`, `current_updated`, `current_skipped_stale_event`, `duplicate_observation_skipped`, `replay_completed`, `invariant_violation`.

Ils sont courts, déterministes, scopés et ne contiennent ni raw UI, ni secret, ni donnée d'authentification. Aucun monitor production n'est branché.

## Readiness et limites

### CONSTRUCTED

- Identity Resolution, Assessment, Current et Replay Harness ;
- 19 signaux, confidence/repeat/TTL versionnés ;
- migration additive locale, rollback documentaire et contrats DB ;
- 30 fixtures et frontières d'import.

### TESTED

- unité, déterminisme, sérialisation, TTL, répétition, idempotence ;
- multi-tenant/cross-account, événements hors ordre, concurrence et reprise ;
- SQL rebuild, RLS, grants minimaux, append-only et compatibilité CT existante ;
- non-régression Backend et Worker à certifier dans le rapport d'exécution final de la branche.

### NOT DEPLOYED

- migration, moteurs, CLI, docs et tests ;
- aucune génération des types DB production et aucun adaptateur runtime.

### NOT OBSERVED IN PRODUCTION

- aucune transition Identity, assessment ou current n'a été produit par cette version ;
- les résultats rares sont synthétiques ;
- les performances locales ne constituent pas un SLO.

### BLOCKED

- branchement runtime et Shadow exigent un GO distinct ;
- stable ID terrain exige une source dédiée certifiée ;
- seuils/TTL exigent calibration Shadow avant toute autorité ;
- la migration doit subir une Deployment Review séparée avant tout GO DB.

## Plan futur de déploiement

1. Revue de migration, checksum, backup/rollback, allowlist et grants effectifs.
2. Application DB contrôlée uniquement après GO explicite, sans runtime.
3. Régénération des types DB depuis le schéma réellement appliqué.
4. Adaptateurs dormant derrière flags OFF ; aucun writer assessment/current.
5. Replay sur snapshot redacted, puis Shadow limité et multi-tenant.
6. Run naturel ultérieur pour comparer observations, identité, assessment et current sans action.
7. Calibration et revue séparée avant toute policy/Lifecycle/Premium.

Aucune de ces étapes suivantes n'est autorisée par cette phase.
