# CT System — architecture canonique

## V2-1 observation and shadow boundary

The canonical flow is `existing Worker facts -> versioned observation -> append-only evidence -> pure Availability -> independent Utilization and Performance -> Lifecycle Shadow -> package Policy Shadow`. Only adapter layers may import Supabase. The universal domain imports neither Premium nor UI; Premium may consume universal recommendations. All V2-1 flags default OFF and there is no production caller.

## Statut

Ce document est la synthèse canonique du bloc CT après la Phase 4.2. Le code livré est exclusivement un domaine TypeScript pur, des simulations locales et de la documentation. Il ne lit ni n'écrit Supabase, ne persiste rien et n'active aucun comportement de production.

Décision verrouillée : **l'épuisement d'un compte cible est universel ; seul le remplacement automatique est Premium**. Le `Target Lifecycle Engine` évalue un CT sans connaître le pack. `Plan Policy` traduit ensuite le même assessment en action Growth, Pro ou Premium.

## Audit du couplage Phase 4.1

| Élément | Premium-only réel | Universel | Action retenue |
|---|---:|---:|---|
| `target-utilization.ts` | Non | Oui | logique extraite dans `lib/target-lifecycle/`; compatibilité Premium conservée |
| `target-utilization.test.ts` | Non | Oui | tests historiques préservés, matrice universelle ajoutée |
| modèles de propositions/batches/revue | Oui | Non | restent dans `lib/ct-premium/` |
| shadow reports et snapshots de génération | Oui | Non | restent Premium, consomment à terme un assessment universel |
| gate onboarding 15 / low-stock 5 | politique cross-pack | Oui | contrat existant conservé; stock lifecycle rendu calculable |
| scoring, revue et J+5 | Oui | Non | restent Premium |
| audit de surexploitation | Non | Oui | renommé conceptuellement Target Lifecycle Engine |

La dépendance admise est `ct-premium -> target-lifecycle`. La dépendance inverse n'existe pas. Le moteur universel n'importe ni React, ni Supabase, ni Stripe, ni Worker, ni BotApp, ni email, ni notification, ni UI de plan.

## Flux canonique

```text
                    Target Lifecycle Engine
                              |
          healthy / watch / replacement / exhausted
                              |
              +---------------+---------------+
              |               |               |
           Growth            Pro           Premium
              |               |               |
       Archive + Ask    Archive + Ask   Auto Replacement
       client for CT    client for CT    + Review + J+5
```

Les mentions d'archive ci-dessus décrivent une politique future à certifier. Cette phase ne code aucune suppression ni mutation.

## Les vingt contrats du système CT

1. **Onboarding minimum 15 CT.** Le compte doit atteindre au moins 15 CT valides pour sa readiness initiale. Ce gate ne se confond pas avec le stock courant.
2. **Low-stock à `<= 5`.** Après readiness, cinq CT éligibles ou moins produisent un besoin de réapprovisionnement.
3. **CT actifs dans `ig_targets`.** Cette table reste la future source canonique runtime, mais elle n'est pas lue ou modifiée ici.
4. **Target Lifecycle Engine universel.** `lib/target-lifecycle/` évalue Growth, Pro et Premium avec les mêmes métriques.
5. **Utilisation et épuisement.** `uniqueProfilesEvaluated / estimatedExploitableAudience`; le dernier follower count frais n'est qu'un fallback haut.
6. **FBR indépendant.** Bon ou mauvais FBR ne modifie jamais le taux de consommation d'audience.
7. **Growth Policy.** Observation universelle, notification/email futurs et ajout manuel par le client; jamais de génération automatique.
8. **Pro Policy.** Même contrat que Growth pour le lifecycle; aucune capacité Premium inventée.
9. **Premium Policy.** Peut préparer un remplacement automatique puis utiliser propositions, revue client, J+5 et activation.
10. **Snapshots.** Les snapshots immuables de critères et de scoring restent propres au pipeline Premium.
11. **Scoring.** Le scoring des nouveaux candidats ne participe pas à l'assessment d'épuisement de l'ancien CT.
12. **Génération shadow.** Le provider et les rapports Premium restent sans persistance ni activation.
13. **Revue Premium.** Les propositions sont acceptées/rejetées dans un scope strict `tenantId + accountId`.
14. **J+5.** Seules les propositions Premium encore pending peuvent suivre la politique de timeout après revalidation.
15. **Replacement-first.** Ancien CT maintenu, remplacement préparé, validé puis activé, ancien CT archivé ensuite.
16. **Archivage.** Recommandation universelle seulement; archive immédiate réservée à un futur contrat de preuve terminale forte.
17. **Notifications/emails futurs.** Growth/Pro demandent des CT au client; les intents et livraisons seront séparés et idempotents.
18. **Séparation application/DB.** Le domaine émet assessments et décisions; de futurs adaptateurs seulement pourront persister ou muter.
19. **Roadmap.** La progression va du domaine local au Live Shadow, puis Policy/Replacement Shadow et activation contrôlée.
20. **Limitations actuelles.** Aucun journal durable exhaustif de profils évalués, baseline DB non récupérée, seuils non calibrés sur terrain et aucun port production implémenté.

## Modèle lifecycle universel

Le scope obligatoire est `(tenantId, accountId, targetId, normalizedUsername)`. Un profil est évalué une seule fois par username canonique dans ce scope. Un retraitement met à jour/complète l'évidence future sans incrémenter le numérateur unique. `followed`, `skipped`, `ineligible`, `unavailable`, `already_processed`, `duplicate` et `blacklisted` sont des breakdowns diagnostiques : ils ne sont jamais additionnés pour fabriquer le numérateur. Un historique incomplet dégrade explicitement la confiance.

Le dénominateur porte `value`, `kind`, `version`, `source`, `observedAt` et `reliability`. La confiance combine fraîcheur, couverture historique, couverture des évaluations uniques, fiabilité du dénominateur, attribution source et couverture des versions Worker. Le résultat expose score, niveau et raisons.

| Ratio initial non productif | État |
|---:|---|
| 75 % | `watch` |
| 80 % | `replacement_recommended` |
| 85 % | `replacement_pending` candidat shadow |
| 90 % + confiance forte + minimum absolu | `exhausted` |
| 95 % + preuve terminale | confirmation conservatrice future |

Les minimums initiaux sont 250, 500, 1 000 ou 2 500 évaluations selon la taille d'audience. Ils sont centralisés et restent recalibrables.

## États, stock et transitions

États : `healthy`, `watch`, `replacement_recommended`, `replacement_pending`, `exhausted`, `archived`, `stale_data`, `insufficient_data`. Les quatre premiers comptent dans le stock éligible. `archived` ne compte jamais. `exhausted` est exclu seulement lorsque l'assessment l'a établi avec forte confiance. Les données obsolètes ou insuffisantes échouent fermées.

Un compte avec 6 CT dont 1 exhausted passe à 5 et satisfait le gate low-stock. Growth/Pro demandent alors des CT au client; Premium peut anticiper un remplacement avant retrait. Le calcul filtre toujours tenant et account, y compris pour une agence mixte.

## Matrice FBR × utilisation

| FBR | Utilisation | État moteur | Recommandation |
|---|---|---|---|
| Bon | Faible | `healthy` | conserver |
| Bon | Élevée | replacement/exhausted | remplacer |
| Faible | Faible | lifecycle `healthy` | décision low-FBR séparée |
| Faible | Élevée | `exhausted` | priorité remplacement/archivage futur |

`auto_low_followback_ratio` appartient à la politique FBR existante. Les reasons lifecycle sont distinctes : `target_utilization_threshold_reached`, `target_replacement_recommended`, `target_replacement_pending`, `target_audience_exhausted`, `target_exploitable_audience_depleted`, `target_utilization_data_insufficient`, `target_follower_count_stale`, `target_utilization_confidence_low`, `target_archived_after_replacement`, `target_archived_terminal_exhaustion`.

## Politiques de pack

`evaluateTargetLifecyclePlanPolicy` reçoit plan, assessment, stock, onboarding, état du remplacement, état abstrait de notification et instant injecté. Sa sortie explicable expose action, archivage permis/différé, remplacement requis/automatique, notification/email, recalcul stock, reason codes et explication.

| Assessment | Growth | Pro | Premium |
|---|---|---|---|
| healthy | `no_action` | `no_action` | `no_action` |
| watch | `monitor` | `monitor` | `monitor` |
| replacement | `request_client_targets` | `request_client_targets` | `prepare_automatic_replacement` |
| exhausted, preuve non terminale | demande manuelle; archive future | demande manuelle; archive future | remplacement d'abord; archive différée |
| remplacement Premium prêt | n/a | n/a | `mark_replacement_pending` + revue/J+5 |
| remplacement Premium activé | n/a | n/a | `archive_after_replacement` |
| preuve terminale forte | contrat futur d'archive immédiate | idem | idem |

## Ports futurs et propriétaires

| Port | Implémentation future responsable |
|---|---|
| `TargetEvaluationEventWriter` | Worker, avec clé unique account/target/username |
| `TargetLifecycleAssessmentRepository` | backend + stockage DB certifié |
| `TargetLifecyclePolicyRunner` | scheduler/backend |
| `TargetArchivePort` | backend transactionnel vers `ig_targets` |
| `TargetReplacementPort` | CT Premium pour Premium; absent Growth/Pro |
| `TargetClientNotificationPort` | système de notifications |
| `TargetClientEmailPort` | système email/outbox |
| `TargetLifecycleMetricsPort` | backend/observabilité/admin et projections BotApp |

Admin/frontend et BotApp ne font que projeter des états; ils ne recalculent pas la vérité lifecycle.

## GLOBAL DOMAIN BOUNDARIES

La revue globale Phase 4.3 est détaillée dans `docs/ct-global-architecture-review.md`. Elle fixe la frontière finale avant récupération DB :

```text
Worker observations
        |
        v
Target Performance (contrat universel)
        |
        v
Target Lifecycle Engine
        |
        v
Plan Policy ---- Growth / Pro / Premium
                               |
                               v
                    CT Premium Replacement Flow
```

- `Target Performance` possède les observations, fenêtres, agrégats et fiabilité; il ne décide aucune archive.
- `Target Lifecycle` possède utilisation, épuisement, statut et besoin de remplacement; il n'absorbe ni FBR policy, ni catalogue, ni discovery.
- `Target Catalog` possède CT actifs/archivés, verification, eligibility catalogue et identité durable.
- Discovery reste un service/provider; Candidate Scoring reste prédictif et Premium; la performance active reste observée et universelle.
- Plan Policy traduit un fait en action. Growth/Pro demandent des CT; Premium orchestre discovery, proposition, revue, J+5 et replacement-first.
- Rotation reste Worker-only. Recommendation et Quality génériques ne deviennent pas des Engines.

Dépendances interdites : domaine universel vers Premium/React/Supabase/UI; Worker vers plan policy; UI/BotApp vers recalcul canonique; discovery vers activation directe. Le contrôle `architecture-boundary.test.mjs` certifie l'absence d'import Premium, React, Supabase ou plan UI depuis `target-lifecycle`, l'arête autorisée Premium vers lifecycle et l'absence de cycle local.

## Roadmap

### Availability universelle avant Live Shadow

`Target Availability` est une dimension d'entrée universelle du `Target Lifecycle Engine`, pour Growth, Pro et Premium. Elle combine identité, disponibilité, badge certifié et exploitabilité de la surface Followers ; elle ne devient pas un Engine séparé.

Un compte certifié peut devenir inexploitable. Le badge et la restriction de surface sont deux evidences distinctes : le badge seul n'autorise pas l'archive. Growth/Pro demandent des CT au client ; Premium prépare automatiquement un remplacement avec revue/J+5 avant archive.

Roadmap canonique : A audit/modèle pur (terminé), B extension DB additive, C shadow read-only, D instrumentation Worker, E policy shadow multi-pack, F activation progressive. Aucune fonctionnalité Availability n'est active. Voir `docs/ct-target-availability-audit.md`.

- **A — Maintenant :** domaine lifecycle universel, revue globale des frontières, simulation multi-pack, test d'architecture et documentation canonique; aucune persistance.
- **B — Récupération baseline DB :** certifier l'historique et confronter les bounded contexts au schéma réel, sans mutation opportuniste.
- **B2 — Design DB :** journal unique des profils évalués, contrat Target Performance, compteurs account/target, assessments et reasons persistants; aucune archive automatique initiale.
- **C — Live Shadow universel :** calcul réel Growth/Pro/Premium aux seuils 75/80/85/90/95, sans suppression.
- **D — Policy Shadow :** actions simulées, emails Growth/Pro simulés, remplacement Premium simulé.
- **E — Replacement Shadow Premium :** remplacements réels préparés mais non activés; ancien CT maintenu.
- **F — Activation progressive :** Growth/Pro archive certifiée puis notifications/emails; Premium replacement-first puis archive.
- **G — Généralisation :** supervision, monitoring, rollback et recalibrage des seuils avec données réelles.

## Gel et limites

Aucun port futur ci-dessus n'est implémenté. Aucun schéma, migration, table, RPC, policy, grant, route, Worker, BotApp runtime, Stripe, email, notification, archive, compte, run, device ou déploiement n'est touché par les Phases 4.2–4.3.

## Phase DB locale

Les ports universels Evaluation/Performance/Lifecycle et les ports Premium snapshots/batches/proposals/review/replacement possèdent désormais une persistance post-cutover et des RPC testées localement. Les adaptateurs Supabase restent fail-closed et non montés. L'archive automatique reste explicitement désactivée; Growth/Pro restent notification + ajout manuel, Premium seul possède replacement-first.

## À reprendre dans la documentation CT canonique finale

La documentation CT consolidée devra intégrer explicitement les frontières
amont et aval suivantes, sans créer une seconde source de vérité :

1. **Credentials → login → identity → readiness.** Les credentials restent dans
   Vault. Auto Login prouve le compte Instagram exact ; une preuve opérateur est
   possible uniquement via le Backend authentifié. `connected != ready` et la
   projection readiness serveur reste l'autorité pour Client, Admin et BotApp.
   Voir [`client-connect-challenge.md`](./client-connect-challenge.md) et
   [`client-tenant-onboarding-e2e.md`](./client-tenant-onboarding-e2e.md).
2. **Gate initial de 15 CT.** La finalisation onboarding recompte en base les CT
   actives, validées et éligibles. Ce gate initial reste distinct du seuil
   ongoing low-stock `<= 5`.
3. **Assignment et scheduler.** L'assignment device/app instance n'est créée
   qu'après le gate initial. Le scheduler ne peut considérer le compte qu'après
   readiness complète et réévalue fenêtre, quota, locks et blockers au tick
   naturel.
4. **Incident et Human Assistance.** Une surface Auto Login inconnue échoue
   fermée, crée l'incident/action opérateur dédupliqués et utilise les
   notifications redacted. Après preuve humaine, la Resume Authorization permet
   une réévaluation normale, jamais un run forcé. Voir
   [`incidents-overview-retention-v1.md`](./incidents-overview-retention-v1.md).
5. **CT Resume.** Checkpoint, lease, anchor/prefix/overlap et business/social
   dedupe restent account/run/target scoped. L'identité Worker doit provenir de
   la release immuable réellement active ; aucun compte futur ne dépend d'une
   allowlist historique.
6. **Unfollow Daily Plan.** `UNFOLLOW_DAILY_PLAN_V1` reste l'autorité immuable :
   même `plan_id` et reliquat lors d'une vraie reprise, traitement Search exact
   dans la même session saine, not-found terminal stable, recovery candidat
   distincte du circuit session et Auto Restart réservé aux interruptions
   anormales. Le contrat dédié est
   [`unfollow-one-healthy-session-contract.md`](https://github.com/Xstoneekwa/instagram-worker-python/blob/e88767d9f035af8cb93fdf176b6167d45fa46228/docs/unfollow-one-healthy-session-contract.md).
7. **Isolation.** Tous les objets login, assignment, CT, checkpoint, plan
   Unfollow, incident et Resume Authorization restent scopés par tenant/account.
   Une preuve, action ou candidat d'un compte ne peut pas autoriser un autre
   compte.
