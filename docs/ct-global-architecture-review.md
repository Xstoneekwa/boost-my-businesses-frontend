# CT System — Global Architecture Review

## Décision

Audit Phase 4.3, lecture locale uniquement. Sources auditées : Backend `16d0a81f8dcc423451d9270cde57ba99d191a928`, Worker canonique local `6976e188e3a6bb5c7ae788edfeda30e740a40839`, BotApp canonique local `fac5ac0c01637d6fb343438f4238633744f1da6e` et migrations suivies dans Git. Aucun état Supabase réel n'a été lu; la présence d'un fichier de migration ne certifie pas son application.

Verdict ferme : **aucun autre Engine ne doit être extrait avant la récupération de baseline DB**. Le seul nouveau bounded context universel légitime est `Target Performance`, mais son contrat conceptuel suffit avant DB; une extraction de code maintenant déplacerait des responsabilités runtime et persistence sans baseline certifiée. Discovery, eligibility et catalog lifecycle restent des services. Replacement reste une orchestration Premium. Recommendation et Rotation ne deviennent pas de nouveaux engines applicatifs.

## Inventaire des responsabilités

| Concept | Emplacement actuel | Packs | Responsabilité | Propriétaire logique | Classe |
|---|---|---|---|---|---|
| catalogue CT actif | `ig_targets`, `targets-service.ts`, routes targets | tous | créer/lister/archiver/restaurer les CT | backend/catalogue | E + A |
| onboarding 15 CT | onboarding client + policy | tous | readiness initiale | onboarding | A |
| stock éligible | `account-target-eligibility.ts` | tous | compter les CT actifs, trouvés et éligibles | backend/catalogue | A/G |
| signal low-stock `<=5` | `needs-more-target-accounts.ts` | tous | ouvrir/fermer un besoin de CT | policy + infrastructure | D/E |
| email besoin de CT | lifecycle email/outbox | Growth/Pro, futur Premium selon policy | intent, séquence et livraison | notification/email | E |
| vérification de profil | `instagram-targets.ts`, jobs, revalidation périodique | tous | profil trouvé, public, eligible | backend/provider | A/E |
| restauration manuelle | `instagram-target-lifecycle.ts` | tous | restaurer ou réenquêter un CT archivé | service catalogue | A/G |
| déduplication catalogue | `targets-service.ts` | tous | empêcher doublon actif account/username | backend/catalogue | A |
| blocage de réajout low-FBR | low-FBR policy + catalogue | tous | empêcher réajout d'une cible archivée pour cause certifiée | backend policy | D/E |
| observations terrain | Worker `runner.py`, `supabase_client.py` | tous | sélection, follow vérifié, budget, frontière de liste | Worker | C |
| rotation intra-run | Worker `runner.py` | tous | passer au prochain CT dans une session bornée | Worker | C |
| follows attribués | Worker + RPC suivies | tous | incrément idempotent lié au `source_target_id` | performance/infrastructure | C/E |
| followbacks attribués | `ig_interacted_users`, sync RPC, Worker | tous | rattacher followback au CT source | performance/infrastructure | C/E |
| fiabilité FBR | `target-fbr-metrics.ts`, low-FBR policy | tous | ne publier/agir que sur métrique certifiée | performance | A/G |
| auto-archive low-FBR | low-FBR policy + scheduler | tous sous flags | action commerciale/opérationnelle sur performance | policy/orchestrateur | D/E |
| utilisation/épuisement | `lib/target-lifecycle/` | tous | assessment universel du cycle de vie | domaine lifecycle | A |
| plan policy lifecycle | `lib/target-lifecycle/policy.ts` | tous | action différente selon pack | commercial policy | D |
| recherche IA client | `target-ai-search-service*.ts` | Pro/Premium | découvrir puis vérifier des usernames | discovery service | B/D |
| provider de recherche Premium | `ct-premium/candidate-search-provider.ts` | Premium | fournir des candidats au pipeline shadow | CT Premium | B |
| normalisation candidat | client Target AI + `ct-premium/normalization.ts` | Pro/Premium | username syntaxique canonique | service partagé futur possible | A/B |
| eligibility candidat | Target AI + déduplication Premium | Pro/Premium | filtres provider, profil, blacklist et doublons | services par étape | A/B/G |
| scoring candidat | `ct-premium/scoring.ts` | Premium | pertinence prédictive d'une proposition | CT Premium | B |
| snapshot de critères | `ct-premium/snapshot.ts` | Premium | figer les données de génération/revue | CT Premium | B |
| batch de propositions | domaine `ct-premium` | Premium | agréger les propositions et décisions | CT Premium | B |
| revue et J+5 | domaine `ct-premium` | Premium | décision client, timeout, revalidation | CT Premium | B |
| activation de remplacement | ports mémoire CT Premium | Premium | replacement-first futur | CT Premium/backend | B/E |
| projections client/admin | pages, drawers, API projections | tous | afficher catalogue, qualité, FBR et actions | frontend | F |
| projection BotApp | Targets/Settings/Activity | tous | afficher et relayer sans recalcul canonique | BotApp | F |

## Ambiguïtés observées

| Responsabilité ambiguë | Pourquoi | Risque | Frontière recommandée | Extraction avant DB |
|---|---|---|---|---|
| `instagram-target-lifecycle.ts` | le nom suggère l'épuisement mais le fichier gère actif/archivé/restauration/vérification | collision avec `lib/target-lifecycle` | le considérer comme `TargetCatalogLifecycleService`; renommer seulement lors d'une phase dédiée | Non |
| `account-target-eligibility.ts` | fonctions pures et chargement Supabase sont réunis | domaine dépendant d'infrastructure | garder le prédicat catalogue pur et isoler l'adapter lors de la conception DB | Non |
| low-FBR policy | fiabilité, classification performance, flags et archive sont réunis | fait observé confondu avec action | Performance produit le fait; une policy décide l'archive | Contrat seulement |
| Target AI vs Premium discovery | deux flows trouvent/vérifient des candidats, avec gates distincts | duplication future de providers | interface provider/service partagée possible après inventaire DB/provider | Non |
| “quality” | signifie eligibility provider, score prédictif ou rendement réel | score trompeur et modèles DB fusionnés | noms explicites `CandidateScore`, `CatalogEligibility`, `PerformanceAssessment` | Documentation maintenant |
| “exhausted” Worker | frontière de liste observée pendant un run, pas consommation historique | faux épuisement durable | conserver comme observation Worker avec preuve et fenêtre | Non |

## Test de légitimité des moteurs candidats

| Candidat | Verdict | Justification | Action avant DB |
|---|---|---|---|
| Target Discovery Engine | `KEEP_AS_SERVICE` | entrées/provider/observabilité existent, mais pas de lifecycle ni persistance métier autonome; Pro et Premium utilisent des flux différents | documenter les providers, ne pas extraire |
| Target Quality Engine | `DO_NOT_CREATE` | “qualité” fusionnerait prédiction candidat et rendement observé | conserver Candidate Scoring et Performance Assessment séparés |
| Target Performance Engine | `FORMALIZE_CONTRACT_ONLY` | responsabilité universelle stable, observations et historique propres; frontière DB réelle | contrat canonique ci-dessous, pas de code runtime |
| Target Lifecycle Engine | `EXTRACT_BEFORE_DB — DONE` | domaine universel, pur, testable, états et événements propres | frontière confirmée; aucun élargissement |
| Target Replacement Engine | `PREMIUM_ONLY` | le besoin est universel, mais discovery/revue/J+5/activation replacement-first sont Premium | rester orchestrateur CT Premium |
| Target Recommendation Engine | `DO_NOT_CREATE` | recommandation = résultat de discovery + scoring + policy | aucun module dédié |
| Target Rotation Engine | `WORKER_ONLY` | navigation terrain, budgets et safe boundaries appartiennent à une session Worker | ne pas remonter dans le backend |
| Target Eligibility Engine | `KEEP_AS_SERVICE` | règles partagées mais appliquées à plusieurs frontières et moments | formaliser les niveaux; pas d'Engine unique |

Le critère décisif n'est pas le nombre d'appels mais la propriété de données et d'événements. Seuls Performance et Lifecycle ont une histoire métier universelle. Lifecycle existe déjà. Performance doit guider la DB mais peut rester un contrat documentaire jusqu'à la baseline.

## Architecture minimale recommandée

```text
Worker observations
        |
        v
Target Performance (contrat universel)
        |
        +------> Performance Assessment / low-FBR fact
        |                         |
        +-------------------------+
                                  v
                        Target Lifecycle Engine
                                  |
                                  v
                             Plan Policy
                       /          |          \
                  Growth         Pro       Premium
                     |             |          |
              Ask client CT  Ask client CT    v
                                      CT Premium Replacement Flow
                                      discovery -> candidate scoring
                                      -> review -> J+5 -> activation

Target Catalog Service <---- eligibility/revalidation adapters
        |
        +---- projections client/admin/BotApp
```

### Dépendances autorisées

- Worker émet des observations; il ne décide pas la policy commerciale.
- Performance consomme des observations et publie agrégats/reliability.
- Lifecycle consomme des métriques Performance, jamais des projections UI.
- Plan Policy consomme un assessment Lifecycle.
- CT Premium consomme Lifecycle, Plan Policy, catalog eligibility et discovery providers.
- infrastructure DB, notifications et emails implémente des ports derrière les domaines.
- UI/BotApp consomme des projections backend.

### Dépendances interdites

- `target-lifecycle -> ct-premium`, React, Supabase, UI ou provider email;
- Performance -> plan, Premium, UI ou action d'archive;
- Worker -> entitlement ou décision Growth/Pro/Premium;
- Candidate Scoring -> métriques terrain inexistantes d'un candidat;
- UI/BotApp -> recalcul de la vérité eligibility/performance/lifecycle;
- Notification/email -> mutation directe du catalogue;
- Discovery -> activation directe dans `ig_targets`.

## Quatre identités distinctes

| Type | Identité | Propriétaire | Données autorisées |
|---|---|---|---|
| Active Target | `tenantId + accountId + targetId`; username normalisé versionné | Target Catalog | statut catalogue, verification/eligibility, performances et lifecycle référencés |
| Candidate Target | `candidateId` ou clé de session + username normalisé | Discovery/Premium batch | données provider, critères et score prédictif; aucun historique terrain inventé |
| Replacement Candidate | `replacementId + replacedTargetId + proposalId` | CT Premium | lien causal, état shadow/revue/activation et idempotence |
| Archived Target | même `targetId` durable que l'actif | Target Catalog | historique, raison/date d'archive; jamais chargé comme source Worker |

Un candidat ne devient un active target qu'après activation transactionnelle future. L'archive conserve l'identité du CT; elle ne transforme pas le CT en proposition. Un replacement candidate est une relation/orchestration, pas un sous-type universel de target.

## Candidate scoring et performance observée

| Dimension | Candidate scoring | Active target performance |
|---|---|---|
| nature | prédictive | observée |
| signaux | audience match, langue, géographie, niche, activité, engagement estimé | follows vérifiés, followbacks attribués, skips, exhaustion terrain, fenêtres |
| fiabilité | qualité du provider et complétude profil | couverture historique, attribution, version Worker, business window |
| sortie | score/band/reasons de proposition | aggregate/reliability/performance reasons |
| usage | classer une proposition | informer low-FBR et lifecycle |

Peuvent être partagés : normalisation du username, scope account, métadonnées de provenance et structure de reason code. Ne doivent pas être partagés : score numérique, seuils, lifecycle, historique ou sémantique de confiance. Un `Target Quality Engine` multi-mode masquerait cette différence; deux services explicites sont plus sûrs.

## Contrat canonique Target Performance

`Target Performance` mérite un bounded context DB futur, mais pas une extraction de code avant baseline.

- `TargetPerformanceObservation` : observation immuable `observationId`, tenant/account/target, username canonique, type (`follow_verified`, `followback_attributed`, `profile_evaluated`, `skip`, `target_boundary_observed`), outcome, `occurredAt`, `businessDate`, run/request/action, version Worker et provenance.
- `TargetPerformanceWindow` : fenêtre explicite (`lifetime`, `business_day`, `rolling`, `run`) avec timezone; la business day quotidienne utilise `Africa/Johannesburg` lorsqu'une agrégation quotidienne est demandée.
- `TargetPerformanceAggregate` : follows, followbacks, profils uniques évalués, breakdowns, FBR et période; chaque métrique conserve sa méthode/version.
- `TargetPerformanceReliability` : couverture, attribution source, complétude historique, version Worker et preuve de zéro; un zéro non certifié n'est pas fiable.
- `TargetPerformanceReason` : `no_follows`, `insufficient_follow_volume`, `attribution_incomplete`, `zero_coverage_unproven`, `worker_version_partial`, `reliable`, sans action commerciale.

Sources canoniques proposées : follow = succès vérifié/idempotent avec `source_target_id`; followback = interaction attribuée au target source, puis agrégation certifiée; username fallback uniquement pour legacy et signalé; `ig_targets.follows_sent_count`/`followbacks_count` deviennent des projections agrégées, pas le journal source. `followbacks_metrics_reliable_at` reste une preuve de certification, pas une mesure. Les thresholds low-FBR restent une policy séparée.

## Eligibility et déduplication par niveau

1. **Syntaxe universelle** : trim, suppression de `@`, lowercase, format Instagram.
2. **Catalogue universel** : ownership account, non archivé/supprimé, verification `found`, quality `eligible`, aucun doublon actif `(accountId, normalizedUsername)`, readd block.
3. **Candidate universel avant activation** : blacklist/protection list, doublon actif, doublon proposition/batch, profil disponible.
4. **Fit du produit** : géographie, langue, niche, follower range et score; ce n'est pas l'eligibility catalogue.
5. **Worker interaction eligibility** : déjà traité, privé/indisponible au moment terrain, sécurité et skip memory; reste Worker.

Le partage doit se faire par contrats/reason codes et adapters, pas par import du Worker dans le Backend. Premium doit revalider les niveaux 1–3 juste avant activation. Aucun compte ne partage implicitement blacklist, doublons ou historique avec un autre compte du même tenant.

## Domain fact et commercial action

| Fait | Action possible |
|---|---|
| `exhausted` | Growth/Pro `request_client_targets`; Premium `prepare_automatic_replacement` |
| low-stock | ouvrir un signal/idempotent notification intent selon policy |
| low FBR fiable | policy d'archive séparée, sous flags/certification |
| candidate score élevé | proposer en Premium, jamais activer directement |
| replacement activé | autoriser ensuite archive de l'ancien CT |

Lifecycle n'envoie rien, ne modifie pas `ig_targets` et ne connaît aucun provider de livraison. J+5, review et activation restent dans CT Premium.

## Bounded contexts DB futurs

| Contexte | Données propriétaires | Événements | Transaction critique |
|---|---|---|---|
| Target Catalog / Active Targets | target durable, account, username, catalogue status, verification | added, verified, archived, restored | unicité active et mutation lifecycle catalogue |
| Target Evaluation Events | profils uniques évalués et outcomes | evaluation observed/corrected | idempotence account/target/username/version |
| Target Performance | observations, windows, aggregates, reliability | aggregate computed, reliability changed | attribution follow/followback et projection cohérente |
| Target Lifecycle | assessments, confidence, reasons, version | assessed, status changed | publication idempotente d'un assessment |
| Candidate Discovery | session/provider trace et candidats temporaires si rétention utile | discovered, provider failed | aucune activation; rétention à décider |
| Premium Proposal Batches | snapshot, batch, proposal, score | batch ready/frozen/completed | création idempotente batch + proposals |
| Premium Review Decisions | décision, acteur, J+5, revalidation | accepted/rejected/auto-accepted/invalidated | compare-and-set version/status |
| Target Replacement | lien old target/proposal/new target, état | prepared, activated, archived-old | activation nouvelle cible puis archive ancienne |
| Notifications / Email Delivery | intent, episode, delivery attempt | queued/sent/failed/canceled | outbox idempotente, séparée du catalogue |

Identifiants obligatoires sur les contextes métier : `tenantId`, `accountId`, puis identifiant propre. Les transactions ne traversent les contextes que pour les invariants critiques d'activation/replacement; les projections UI restent éventuellement cohérentes.

## ENGINES WE SHOULD NOT CREATE

- **Recommendation Engine** : sortie redondante de Discovery + Candidate Scoring + Plan Policy.
- **Generic Quality Engine** : mélangerait prédiction et observations réelles.
- **Application Rotation Engine** : la rotation est navigation/session Worker, pas lifecycle durable.
- **Universal Replacement Engine** : le besoin est un fait lifecycle; l'orchestration automatique est Premium.
- **Universal Discovery Engine** : provider/service suffit tant qu'il ne possède ni lifecycle ni données durables propres.
- **Monolithic Eligibility Engine** : les règles catalogue, candidate et terrain s'appliquent à des moments et autorités différents.

## Recommandation finale et roadmap

Choix retenu : **A + D**.

- Aucune extraction de domaine supplémentaire n'est nécessaire avant DB.
- Le contrat `Target Performance` est formalisé dans cette revue; son implémentation attend la baseline.
- Les ambiguïtés de nommage sont documentées mais ne justifient aucun déplacement risqué.
- La récupération de baseline DB peut commencer immédiatement après cette documentation.

Roadmap :

1. récupérer et certifier la baseline/historique DB, sans conception opportuniste pendant la récupération;
2. confronter les bounded contexts ci-dessus au schéma réel;
3. produire le design Target Evaluation Events + Target Performance avant les tables lifecycle/Premium;
4. conserver les compteurs `ig_targets` comme projections compatibles pendant la transition;
5. introduire les adapters derrière les ports, flags fermés;
6. exécuter Live Shadow Performance/Lifecycle, puis Policy Shadow;
7. seulement ensuite activer progressivement archive Growth/Pro et replacement-first Premium.

## Gel Phase 4.3

Le seul code ajouté est un test de scan d'imports. Aucun fichier runtime, route, migration, SQL, Worker, BotApp, Stripe, email, notification, compte, run, device, target ou déploiement n'est modifié.

## Certification DB post-cutover

La frontière auditée est conservée : Worker produit les observations; Target Performance et Lifecycle sont universels; Plan Policy distingue Growth/Pro de Premium; Premium orchestre seulement propositions, revue J+5, activation et replacement-first. Aucun Recommendation Engine, Quality Engine ou moteur de rotation applicatif n'a été introduit.
