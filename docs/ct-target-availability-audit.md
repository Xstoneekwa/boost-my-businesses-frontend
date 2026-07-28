# CT Target Availability — audit universel Growth / Pro / Premium

## Statut et verdict

Audit daté du 28 juillet 2026, réalisé avant Phase 8C. Il couvre le Backend, le Worker actif `95a8930`, le BotApp canonique, le schéma Supabase de production et les tests, sans appel Instagram, ADB, run, écriture DB ni activation.

Verdict : l'Availability est une dimension universelle du `Target Lifecycle Engine`, pas un Engine autonome. Le modèle pur et les politiques sont prêts, mais les observations terrain et l'identité stable ne le sont pas. Le Live Shadow Availability utile reste bloqué par une extension DB additive puis une phase Worker dédiée.

## État existant

| Mécanisme actuel | Emplacement | Signal | Action actuelle | Permanent/temporaire | Suffisant |
|---|---|---|---|---|---:|
| Validation publique initiale | `instagram-public-profile-lookup.ts`, `instagram-target-quality.ts` | found/not_found/unavailable/rate-limit, badge, privé, compteur, ID fournisseur | classe eligible/review/rejected | mélange | Non |
| Hygiene de revalidation | `target-verification-hygiene.ts` | not_found, verified, username_changed | peut renommer ou archiver | terminal | Non : badge seul et identité initiale absente |
| Revalidation périodique | `target-periodic-revalidation-*` | échéance hebdomadaire, jobs bornés | enqueue/process si cron activé | périodique | Partiel ; OFF par défaut et non planifié dans `vercel.json` |
| Chargement Worker | `supabase_client.py::load_eligible_follow_targets` | status, quality, verification, archive/delete | exclut les lignes non éligibles | durable DB | Partiel |
| Recherche CT | `instagram_navigation.py`, `runner.py` | search surface, query exacte, ligne exacte | retry/recovery borné | temporaire | Non : absence et panne UI confondues |
| Vérification profil | `verify_profile` | signal léger de profil | succès ou échec après fenêtre courte | observation | Non : aucun état Availability |
| Entrée Followers | `open_followers_list_from_profile` | foreground, métrique Followers, transition de surface | stratégies + fallback/recovery | observation | Partiel |
| Exploration/pagination | `followers_exploration.py`, `runner.py` | profils visibles, progrès, boutons, fin | bornes de scroll/passes | observation | Non pour verified-restricted |
| Rotation CT | `account_session_orchestrator.py` | exhaustion vs erreur runtime | rotation sur exhaustion/safe partial ; stop sur autre erreur | session | Non : un CT indisponible peut arrêter la phase |
| Métriques CT | `supabase_client.py` | selected/success/exhausted/budget/runtime_error | écrit métriques et événements génériques | durable | Partiel |
| Low-FBR | `target-auto-archive-low-fbr-*` | performance FBR | politique d'archive séparée | durable | Hors Availability |
| BotApp Targets | `TargetsDrawer.tsx`, `profile-details.ts` | status/quality/verification | projection et actions opérateur | projection | Non : aucun statut Availability |
| Phase 8B | tables `ct_*` | évaluation, performance, lifecycle, propositions | aucune donnée, runtime OFF | futur | Non pour identité/evidence/quarantaine |

## Chemin Worker exact et risques

| Étape | Échec possible | Retry/budget actuel | Sortie sûre | Risque |
|---|---|---:|---:|---|
| 1. Charger CT | ligne non éligible, username absent | aucun retry local | skip | faible |
| 2. Ouvrir Search | mauvais launcher/surface | recovery, jusqu'à force-stop/restart Instagram | code d'erreur | latence élevée, scope trop large |
| 3. Saisir/résoudre | champ non vidé, zéro résultat, résultat ambigu | fenêtres rapides 0,4–0,8 s ; rescan exact unique après Enter | codes 9/73/5 | faux not-found ou mauvais recovery |
| 4. Ouvrir profil | tap ligne ou transition échoue | vérification profil 1,5 s, poll 0,08 s | codes 7/8 | cause Availability non classée |
| 5. Entrer Followers | foreground, métrique absente, mauvaise surface | moteur V2, fast path, fallback coordonné, rescan | échec structuré | retries coûteux ; restriction non reconnue |
| 6. Charger profils | zéro bouton, UI lente, sparse | passes/scrolls bornés | partial/exhausted | petit compte, panne UI et restriction confondus |
| 7. Fin de liste | pas de progrès/répétition | 5 no-progress, 15 no-actionable, 12 passes, 200 scrolls absolus selon chemin | exhaustion/partial | coût important avant classification |
| 8. Retour CT | retour liste/profil/search échoue | 2 retries de retour ; fallback search | partial sûr sur cas certifiés | téléphone bloqué ou reset |
| 9. CT suivant | erreur non-exhaustion | max 3 CT par défaut, upper 10 ; 2 safe partial failures | rotation seulement pour exhaustion/safe partial | un CT indisponible arrête le run |
| 10. Erreur | exception/UI mismatch | capture/log puis code sortie | terminalisation supérieure | signal durable trop générique |

Les principaux coûts viennent des resets Instagram, des stratégies multiples d'entrée Followers, des longues explorations avant de conclure à l'absence de progrès et du fait qu'une erreur `runtime_error_non_exhaustion` interrompt la rotation. Aucun chemin observé ne crée volontairement une boucle infinie, mais les bornes cumulées peuvent immobiliser longtemps le Golden Flow.

## Identité et changement de pseudo

Production contient 145 `ig_targets`, mais zéro `metadata_safe.instagram_user_id` et zéro `metadata_safe.external_profile_id`. `ig_targets` ne possède aucune colonne stable-ID dédiée.

Le Backend sait lire un ID direct ou dans `metadata_safe` et conserver le même `target_id` lors d'un rename. Il conserve seulement `previous_username` et `username_renamed_at` dans un JSON, donc pas un historique multi-renames normalisé. Surtout, si l'ancien CT n'a aucun ID stable, un ID fourni lors du nouveau lookup suffit actuellement à confirmer le rename : cette preuve ne démontre pas qu'il s'agit du même compte.

Contrat futur obligatoire :

`ancien username + stable ID déjà certifié + nouveau username observé avec le même stable ID + absence de collision active -> même target_id + événement target_username_changed`.

Un nom ressemblant ne suffit jamais. Si l'ancien username est réattribué à un autre stable ID : `target_previous_username_reassigned`, `identity_conflict`, blocage opérateur, aucune mise à jour automatique. Le même `target_id` permet de conserver performance, follows/followbacks et lifecycle ; un journal d'identité additif doit conserver tous les noms.

## Supprimé, suspendu, banni : limites de preuve

| Cas | Signal fiable disponible | Signal ambigu | Confirmation | Action future |
|---|---|---|---:|---|
| supprimé/not-found | 3 observations not-found, réseau/session sains, au moins 2 runs, UI correcte | un seul zéro résultat | répétée ou preuve fournisseur forte | remplacement |
| désactivé/suspendu/banni | page indisponible persistante | Instagram présente souvent la même UI | regrouper `suspended_or_disabled` | quarantaine puis remplacement si confirmé |
| région/VPN/réseau | échec corrélé au réseau/device | not-found ponctuel | réseau sain ou second contexte | recheck |
| session client restreinte | incidents/session/foreground | CT introuvable | dissocier du CT | ne jamais archiver le CT |
| UI Instagram modifiée | plusieurs CT échouent avec même signature/version | métrique absente | circuit breaker global/version | incident Worker, pas Availability terminale |
| bug Worker | exception reproductible multi-CT | échec isolé | logs/version/tests | phase Worker |

Il est impossible d'affirmer « supprimé », « banni » ou « suspendu » si Instagram rend la même surface. Le modèle conserve des catégories prouvables et des raisons ambiguës.

## Compte certifié devenu inexploitable

Le Backend enregistre `is_verified` lors de la validation et rejette aujourd'hui tout profil vérifié. La hygiene peut produire `verified_became_ineligible` puis archiver. Le Worker ne détecte pas explicitement le badge du CT source, ne mesure pas durablement le nombre accessible sur la surface Followers et ne corrèle pas fin terminale, répétition et badge.

Décisions :

1. Le badge seul ne suffit pas.
2. Il faut badge + restriction de surface.
3. Deux contrôles distincts sont requis, sauf preuve terminale forte sur réseau/session sains.
4. Une preuve Worker terminale peut suffire si la signature UI est forte, versionnée et non corrélée à une panne globale.
5. Politique hybride : lookup périodique hors run, classification opportuniste après échec, observation Worker bornée ; jamais de lookup lourd avant chaque run.
6. Le coût Golden Flow doit être proche de zéro : réutiliser les signaux déjà produits et journaliser de façon asynchrone.

`verified badge detected + followers surface restriction confirmed + repeated observation OR strong terminal proof -> verified_restricted`.

Un compte certifié peut donc devenir inexploitable, mais certification et restriction de surface restent deux faits distincts.

## Modèle universel

Le module pur `lib/target-lifecycle/availability.ts` produit :

- `TargetAvailabilityAssessment`
- `TargetAvailabilityStatus`
- `TargetAvailabilityEvidence`
- `TargetAvailabilityConfidence`
- `TargetAvailabilityReason`
- `TargetIdentityResolution`
- `TargetUsernameChangeAssessment`
- `TargetAvailabilityTransition`

Scope : tenant, compte, target, username normalisé et stable platform user ID éventuel. L'assessment sépare fait observé, confiance, recheck/quarantaine, remplacement et preuve terminale. Il ne persiste rien et ne commande aucune action.

### Evidence et confiance

Les evidences prévues couvrent ID stable, usernames cherché/observé, profil found/not-found, badge, état Followers, profils accessibles, fin terminale, répétition, run/device, réseau/session, qualité UI, versions Instagram/Worker et date.

La confiance reste qualitative. High requiert une preuve terminale/identitaire, ou plusieurs observations cross-run saines et de bonne qualité. Les poids artificiels sont évités. Une réussite ultérieure réinitialise la suspicion ; une panne réseau ne devient jamais une absence terminale.

### Transitions prudentes

`available -> warning/recheck -> temporarily_unavailable -> confirmed unavailable -> replacement_required -> archived`

`available -> verified_detected -> follower_surface_check_required -> verified_restricted -> replacement_required`

Les états « warning », « check required » et « confirmed » sont portés par status + raisons + flags, sans gonfler la machine avec des diagnostics Instagram non prouvables. Les seuils synthétiques proposés (3 absences, 2 runs ; 2 restrictions, ou une preuve terminale) doivent être calibrés en shadow avant activation.

## Matrice universelle et packs

| Availability | Utilisation | Performance | Lifecycle | Growth/Pro | Premium |
|---|---|---|---|---|---|
| available | faible | bonne | conserver | rien | rien |
| username_changed confirmé | N/A | bonne | même identité | update contrôlé futur | idem |
| temporaire | N/A | N/A | quarantaine/recheck | aucun email terminal | idem |
| permanently unavailable | N/A | N/A | remplacement | demande client | préparation automatique |
| verified_restricted | N/A | bonne | remplacement | demande client | replacement-first |
| lookup_failed faible confiance | N/A | N/A | recheck | rien | rien |
| identity_conflict | N/A | N/A | blocage opérateur | blocage | blocage |
| exhausted | élevée | bonne | remplacement | demande client | remplacement |
| available | faible | mauvaise | low-FBR séparé | politique FBR | politique FBR |

Growth et Pro ne génèrent jamais automatiquement de CT. Premium prépare automatiquement, passe par revue/J+5/activation, puis archive l'ancien CT. Rien de cela n'est actif dans cet audit.

## Gate <= 5

- `available` compte.
- `username_changed` compte seulement après résolution sûre.
- temporaire/recheck compte provisoirement, mais doit être visible comme risque ; une TTL empêche de le maintenir indéfiniment.
- `verified_restricted`, permanent/not-found et `identity_conflict` ne comptent pas dans le stock automatiquement activable.
- Premium prépare avant archive si possible.
- Growth/Pro recalculent puis demandent des CT au client.

Le modèle pur exclut les états terminaux et les conflits du stock. Il conserve temporairement les rechecks afin d'éviter un faux déclenchement après une panne brève.

## Anti-latence et anti-crash futurs

Budget court par CT, un seul recovery de recherche, aucun force-stop lourd avant classification, skip vers le CT suivant sur échec local, circuit breaker CT, quarantaine TTL, vérification asynchrone, et retour garanti au flux principal. Les erreurs multi-CT sur une même version/device ouvrent un incident UI global et ne condamnent aucun CT.

Le Worker doit écrire un événement redacted et idempotent ; le Lifecycle décide plus tard. Un seul CT ne doit jamais terminer la session complète.

## Audit schéma Phase 8B

| Besoin | Classe | Motif |
|---|---|---|
| observation brute availability | `SUPPORTED_BY_GENERIC_EVENT_PAYLOAD` temporairement | `ct_target_evaluation_events.metadata_safe` peut porter une ombre limitée |
| evidence structurée/versionnée | `REQUIRES_NEW_TABLE` | cardinalité 1:N, rechecks et preuve cross-run |
| stable platform ID courant | `REQUIRES_ADDITIVE_COLUMN` | absent de `ig_targets` et des tables CT |
| historique old/new username | `REQUIRES_NEW_TABLE` | JSON unique ne conserve pas une chaîne certifiée |
| verified restricted | `REQUIRES_ADDITIVE_COLUMN` ou assessment enrichi | aucun champ dédié |
| unavailable reason/confidence | `REQUIRES_ADDITIVE_COLUMN` | lifecycle current ne les expose pas séparément |
| quarantine/next recheck | `REQUIRES_ADDITIVE_COLUMN` | absence de TTL/next check |
| current assessment | `ALREADY_SUPPORTED` | `ct_target_lifecycle_assessments/current` |
| event history métier | `ALREADY_SUPPORTED` | assessments + proposal events, mais pas evidence terrain |
| captures/signatures détaillées | `SHOULD_REMAIN_WORKER_LOG_ONLY` | volume/sensibilité ; persister seulement empreintes sûres |

Les 11 tables métier Phase 8B inspectées sont vides. Une extension additive est nécessaire avant de prétendre à un Live Shadow Availability canonique.

## Simulation synthétique

Le harness pur couvre 22 cas : available, rename stable-ID, ancien nom réattribué, absences simple/répétée, réseau, suppression, suspension ambiguë, badge initial/tardif, badge sans restriction, limitation simple/répétée/terminale, répétition, conflit, les trois packs et isolation agence.

Invariants : déterminisme, sérialisation, reasons universelles, confiance prudente, mêmes faits/policies différentes, gate <=5, aucune mutation, aucun archivage et aucune activation.

## Reason codes et propriétaires

- Worker observatoire futur : `target_navigation_retry_budget_exhausted`, `target_source_profile_resolution_failed`, `target_followers_entry_failed`, signatures réseau/UI.
- Lifecycle persistant : identité, availability, verified restriction, terminal proof, recheck/quarantaine.
- Opérateur : `target_identity_conflict`, ancien username réattribué, UI globale modifiée.
- Client-facing : seulement demande de CT ou remplacement en préparation ; jamais les détails Worker.
- Policy : reasons Growth/Pro/Premium déjà canoniques.

## Monitoring et UI futurs

Admin/BotApp : status, dernière observation, raison, confiance, ancien/nouveau nom, identité, badge, surface limitée, quarantaine, prochain check et action opérateur. Aucun bouton ne doit déclencher implicitement une vérification réelle.

Client Growth/Pro : « ce CT n'est plus disponible, ajoute de nouveaux comptes ». Premium : « remplacement en préparation/prêt ». Aucun détail réseau/device.

## Impact Phase 8C et roadmap

### Phase A — Audit Availability

Terminé : modèle, raisons, simulation et architecture, aucun runtime.

### Phase B — Contrat DB additif

Préparé localement en Phase 8B.1 : identité stable, journal evidence, assessment Availability courant, quarantaine/recheck, RLS/grants service-role, runtime OFF. La migration additive reste non appliquée ; voir `docs/ct-target-availability-foundations.md`.

### Phase C — Read-only Availability Shadow

Après B : lecteurs read-only, rapports internes et calibration sur données existantes ; aucune action.

### Phase D — Worker Availability Instrumentation

Obligatoire avant Live Shadow terrain utile : détection UI, budgets, skip, anti-crash, identité stable, badge + surface, journalisation.

### Phase E — Policy Shadow multi-pack

Simuler Growth/Pro notification et Premium remplacement, sans émission/action.

### Phase F — Activation progressive

Pilotes, quarantaine, rename contrôlé, replacement-first, archives/emails, rollback.

## GO / NO-GO

- Modèle et contrats read-only : GO.
- Phase 8C limitée à l'intégration de lecteurs de données déjà disponibles (utilization/performance) : GO, hors Availability terrain.
- Phase 8C annoncée comme « Live Shadow Availability universel utile » : NO-GO jusqu'à Phase B puis instrumentation Phase D.

Décisions ouvertes : seuils finaux, TTL quarantaine, seconde device requise, source d'identité stable autoritative et contrat exact de la table evidence. Elles doivent être calibrées, pas figées depuis les seules fixtures.

## Gel confirmé

Aucun comportement de production n'est modifié. Availability universelle, verified restriction, policies pack et gate sont uniquement des modèles purs et de la documentation. Aucun adaptateur, route, cron, Worker, BotApp, migration, écriture, email, notification, activation, archive ou déploiement n'est ajouté.
