# Audit de surexploitation et d'épuisement des comptes cibles

## Statut et périmètre

Phase 4.1 locale, synthétique et non-DB. L'audit porte sur le Backend au `0473b482e597cedb68e963d2126d03ca3ad962b5`, le Worker local canonique audité au `6976e188e3a6bb5c7ae788edfeda30e740a40839` et BotApp local audité au `fac5ac0c01637d6fb343438f4238633744f1da6e`.

Conclusion : **aucune règle existante ne mesure un taux durable d'exploitation de l'audience d'un CT et ne remplace un CT performant parce que son audience utile est presque épuisée**. Deux mécanismes voisins existent, mais répondent à d'autres questions : fin de liste observée pendant un run et auto-archive pour faible FBR.

Aucune production Supabase n'a été lue. Les migrations mentionnées ci-dessous ont seulement été lues comme fichiers suivis ; leur présence locale ne certifie ni leur application ni l'état réel de production.

## État existant

| Mécanisme | Emplacement | Données | Seuil | Action | Couvre l'épuisement ? |
|---|---|---|---|---|---:|
| Rotation multi-CT | Worker `account_session_orchestrator.py` | outcome, reason, exit code, frontière de liste | preuves terminales bornées | change de CT dans le run | Partiel : fin de liste observée, pas ratio historique |
| Métrique `target_exhausted` | Worker `supabase_client.py` + colonnes P1c | `last_exhausted_at`, `exhaustion_reason` | outcome terminal | observabilité uniquement, aucun statut modifié | Non |
| Budget par CT/run | Worker et settings Backend/BotApp | follows du run | défaut/package, borné à 1–50 | rotation temporaire | Non |
| Nombre maximum de CT/run | Worker et settings Backend/BotApp | CT parcourus dans le run | borné à 1–10 | arrête la rotation du run | Non |
| Follows par CT | RPC P1c + Worker | `follows_sent_count` | incrément à chaque follow vérifié | métrique FBR | Seulement une partie du numérateur |
| Followbacks par CT | migration `sync_ig_target_followbacks_count` | attribution `ig_interacted_users` | certification positive ou couverture zéro explicite | calcule FBR | Non |
| Auto-archive faible FBR | Backend + migration dédiée | follows, followbacks, fiabilité | `>=100` follows et FBR strictement `<8%` | soft archive + blocage permanent de réajout si flags live | Non : performance, pas consommation d'audience |
| Revalidation CT hebdomadaire | scheduler Backend | profil public, `followers_count`, `provider_checked_at` | cadence cible 7 jours | rafraîchit qualité et profil | Fournit un dénominateur potentiel, pas le ratio |
| Hygiène de cible | `target-verification-hygiene.ts` | not found/inéligibilité vérifiée | décision provider | archive soft | Non |
| Gate Premium low-stock | `lib/ct-premium/low-stock-gate.ts` | `eligibleTargetCount` fourni | `<=5`, après onboarding 15 | prépare un batch shadow | Ne sait pas encore exclure un CT épuisé |
| Projection BotApp | drawer Targets/Settings | compteurs Backend, date/reason exhaustion | aucun | affichage | Non |

Le mot `exhausted` est donc surchargé : dans le Worker, il décrit surtout une frontière ou absence de candidat exploitable prouvée dans une exploration bornée. Il ne signifie pas « 90 % des followers uniques de ce CT ont été durablement consommés ».

## Inventaire des compteurs

Portée des clés : `account_id` est la frontière durable principale ; `target_id` existe sur `ig_targets` et sur les événements modernes ; le username normalisé permet un fallback mais peut subir renommage ou réattribution ; `tenant_id` n'est pas porté par les lignes d'interaction auditées et doit être résolu via l'ownership du compte. Toute future agrégation doit donc vérifier `tenant_id → account_id → target_id` avant de compter, puis dédupliquer par username canonique dans ce scope.

| Compteur | Source locale observée | Persisté | Par CT | Dédupliqué | Fiabilité | Risque |
|---|---|---:|---:|---:|---|---|
| `followers_count` du CT | `ig_targets` | Oui | Oui | n/a | Moyenne à bonne si `provider_checked_at` récent | variation du profil, absence de valeur historique initiale |
| Date du follower count | `provider_checked_at` | Oui | Oui | n/a | Bonne pour la dernière vérification | ne distingue pas explicitement la date propre du seul compteur |
| Follows vérifiés | `follows_sent_count` | Oui | Oui | Non garanti comme unique historique | Bonne pour actions modernes attribuées | anciens runs et retries historiques |
| Profils suivis uniques | `ig_interacted_users` / événements | Calculable partiellement | Attribution moderne | état unique par compte dans la table state | Moyenne | attribution source réécrite par l'interaction la plus récente |
| Followbacks | `followbacks_count` | Oui | Oui | count state attribué | Bonne seulement si `followbacks_metrics_reliable_at` | zéro non certifié par défaut |
| Profils skipped | skip memory et certains événements Worker | Partiel | Souvent par username CT | Non exhaustif | Faible | toutes les raisons ne sont pas persistées ; événements répétables |
| Profils inéligibles | logs, summaries, quelques skip rows | Partiel | Pas uniformément | Non | Faible | absence de contrat exhaustif commun |
| Profils privés | raison de filtre/skip selon chemin | Partiel | Pas uniformément | Non | Faible | versions Worker et chemins UI différents |
| Profils indisponibles | outcomes/logs | Partiel | Pas uniformément | Non | Faible | indisponible peut être temporaire |
| Profils déjà traités | social memory `ig_interacted_users` | Oui au niveau compte | Attribution CT fragile historiquement | Unique `(account_id, username)` | Moyenne pour anti-refollow, faible pour historique CT | changement de CT source écrase l'attribution courante |
| Doublons | runtime/synthétique | Généralement non comme compteur CT durable | Non | Oui dans le run | Faible historiquement | impossible de reconstruire tous les runs |
| Blacklistés | protection lists + exclusions | Liste persistée, consommation non | Compte, pas CT | Oui dans la liste | Bonne pour exclusion actuelle | ne prouve pas une inspection via ce CT |
| Profils chargés non évalués | compteurs de run/logs | Non durable par username | Non | Non | Faible | disparition après run/log retention |
| Profils uniques ouverts/évalués | summaries/logs | Pas de registre CT exhaustif | Partiel | Non | Faible | compteur requis manquant |
| Audience restante estimée | Aucun contrat existant | Non | Non | n/a | Absente | ne peut pas être certifiée aujourd'hui |
| Fin de liste observée | `last_exhausted_at`, `exhaustion_reason`, événements | Oui | Oui | événement répétable | Bonne pour le run observé | exploration bornée et état Instagram variable |

Les colonnes et événements modernes permettent une approximation, mais pas une reconstruction historique complète. Les anciens runs, les changements de Worker et l'attribution state « dernier CT » interdisent de présenter un nombre actuel comme exact.

## Définition de « profil exploité »

| Modèle | Précision | Données actuelles | Double comptage | Historique | Risque principal |
|---|---|---|---|---|---|
| A. followed + skipped | Moyenne-faible | follows bons, skips incomplets | Élevé sans distinct username | Incomplet | conservation excessive si skips absents |
| B. uniques ouverts/évalués | Élevée conceptuellement | compteur durable absent | Faible avec clé unique | Non disponible | nécessite nouvelle télémétrie fiable |
| C. large multi-reasons | Bonne si événements exhaustifs | très partielle | Très élevé sans identité canonique | Incomplet | faux épuisement par événements répétés |
| D. uniques consommés / audience exploitable estimée | Meilleure représentation produit | numérateur et estimation à construire | Maîtrisable | À démarrer après baseline DB | mauvaise estimation du dénominateur |

Recommandation : viser le modèle D, avec le modèle B comme numérateur canonique. Un profil est consommé lorsqu'un username canonique unique a été effectivement ouvert ou évalué pour `(tenant_id, account_id, target_id)`, quel que soit son outcome final. Les catégories followed/skipped/ineligible/unavailable restent un breakdown diagnostique et ne doivent pas être additionnées si elles se chevauchent.

Pendant la période transitoire, ne jamais appeler « exact » un calcul fondé uniquement sur `follows_sent_count` ou les skips partiels.

## Choix du dénominateur

| Option | Stabilité | Fraîcheur | Ratio >100 % | Disponibilité | Verdict |
|---|---|---|---|---|---|
| Followers actuels | Variable | Bonne si vérifié récemment | Possible | Oui | fallback seulement |
| Followers à l'ajout | Stable | Devient ancien | Possible si audience baisse | Pas de snapshot dédié certifié | utile comme référence, insuffisant seul |
| Dernier followers rafraîchi | Variable | Meilleure | Possible | `followers_count` + `provider_checked_at` | fallback principal actuel |
| Maximum historique | Très stable | Retarde l'épuisement | Faible | historique CT dédié absent | conservateur mais surévalue |
| Moyenne glissante | Moyenne | Bonne | Possible | snapshots CT dédiés absents | complexe sans bénéfice initial |
| Audience exploitable estimée | Dépend du modèle | Versionnable | Maîtrisable | Absente | cible recommandée |
| Audience observée par pagination/runs | Liée au terrain | Ponctuelle | Possible | boundary et compteurs agrégés seulement | signal de confiance, pas dénominateur unique |

Recommandation : un dénominateur principal `estimated_exploitable_audience`, accompagné de sa version et d'une confiance. À défaut, utiliser le dernier `followers_count` frais comme estimation haute, jamais comme vérité exacte. Conserver un intervalle `consumed / upper_bound` et `consumed / estimated_exploitable` pendant le Live Shadow.

Le follower count est frais dans la simulation pendant 14 jours, cohérent avec une revalidation visée à 7 jours et une marge d'un cycle. Cette durée est candidate, non verrouillée.

## Interaction avec le FBR

Le FBR et l'utilisation sont orthogonaux. Un bon FBR ne reconstitue pas une audience consommée.

| FBR | Utilisation | Décision possible |
|---|---:|---|
| Bon | Faible | Conserver |
| Bon | Élevée | Préparer un remplacement pour épuisement |
| Faible | Faible | Observer ou appliquer séparément la politique low-FBR |
| Faible | Élevée | Remplacement prioritaire ; raison d'épuisement distincte |

`target_audience_exhausted` ne doit jamais être remplacé par `auto_low_followback_ratio`. Si deux règles s'appliquent, l'audit conserve les deux évaluations et la décision de lifecycle choisit une cause primaire déterministe.

## Seuils candidats

| Seuil | Bénéfice | Risque | Usage conseillé |
|---:|---|---|---|
| 80 % | remplacement précoce | faux positif si dénominateur sous-estimé | recommandation, jamais archive initiale |
| 85 % | équilibre réactivité/réserve | sensible aux trous historiques | candidat Live Shadow principal |
| 90 % | conservateur | peut prolonger un CT presque vide | candidat d'archive avec forte confiance |
| 95 % | très prudent | remplacement tardif et campagnes à vide | confirmation terminale, pas seuil unique |

Stratégie progressive proposée : 75 % `watch`, 80 % `replacement_recommended`, 85–90 % `archive_candidate` observatoire, 90–95 % `exhausted` seulement avec minimum absolu, fraîcheur et confiance.

Minimums absolus synthétiques à tester, sans décision produit finale : 250 profils sous 500 followers, 500 entre 500 et 1 999, 1 000 entre 2 000 et 9 999, 2 500 à partir de 10 000. Pour les petits CT, une revalidation plus fréquente ou une preuve de frontière doit compléter le ratio.

## Simulation pure Phase 4.1

`CtTargetUtilizationAssessment` est un modèle en mémoire. Il ne lit rien, ne persiste rien et ne modifie ni le gate ni un lifecycle. Le numérateur `uniqueProfilesProcessed` est canonique ; le breakdown sert à vérifier la cohérence. Le ratio est borné à 100 % pour la décision, tandis que `rawUtilizationRatio` conserve les incohérences supérieures à 100 %.

| Scénario | Résultat par défaut |
|---|---|
| 2 700 / 3 000, FBR bon | 90 %, `exhausted`, remplacement/archive recommandé en shadow |
| 1 700 / 2 000 | 85 %, `replacement_recommended`; devient `exhausted` si seuil candidat 85 % |
| 400 / 500 | 80 %, `watch`, minimum absolu non atteint |
| 900 / 10 000 | 9 %, `healthy` |
| FBR bon + 90 % | épuisement confirmé indépendamment du FBR |
| FBR faible + 40 % | utilisation `healthy`; low-FBR reste une règle séparée |
| follower count obsolète | `stale_data`, aucune archive recommandée |
| ratio brut >100 % | ratio décisionnel borné, confiance abaissée, aucune archive automatique |
| données partielles | `insufficient_data` ou confiance insuffisante |
| audience exploitable estimée | préférée au follower count brut lorsqu'elle est fournie |

À 90 % d'utilisation, les seuils 80/85/90 classent `exhausted`, 95 reste `replacement_recommended`. À 85 %, 80/85 classent `exhausted`, 90/95 recommandent seulement le remplacement.

## Impact futur sur le gate low-stock ≤5

Variante A, retrait immédiat : réactive mais peut réduire brutalement le stock, créer un trou de campagne et déclencher plusieurs remplacements simultanés.

Variante B, remplacement avant retrait : le CT reste actif mais devient `replacement_pending`; il cesse progressivement d'être choisi pour de nouvelles explorations lorsque le remplacement est prêt. Le stock opérationnel et le stock futur sont suivis séparément.

Recommandation : variante B. Transition proposée :

`healthy → watch → replacement_recommended → replacement_pending → exhausted → archived`

Le gate doit être pré-armé dès `replacement_recommended`, mais le CT ne sort du stock éligible qu'après présence d'un remplacement validé ou preuve terminale forte. Cela évite le trou de campagne tout en empêchant la conservation indéfinie.

## Reason codes proposés

| Reason code | Portée | Persistance future | Déclenche archive |
|---|---|---:|---:|
| `target_utilization_threshold_reached` | observatoire/opérateur | Oui, évaluation | Non |
| `target_replacement_recommended` | opérateur, éventuellement client-friendly | Oui | Non |
| `target_audience_exhausted` | lifecycle/opérateur | Oui | Candidat avec remplacement prêt |
| `target_exploitable_audience_depleted` | preuve forte/terrain | Oui | Candidat |
| `target_utilization_data_insufficient` | observatoire | Oui | Non |
| `target_follower_count_stale` | observatoire/opérateur | Oui | Non |
| `target_utilization_confidence_low` | observatoire | Oui | Non |

Le message client doit parler de renouvellement de ciblage, sans exposer le détail interne des compteurs. Les reason codes persistants restent distincts des libellés UI.

## Composants futurs concernés

| Composant | Changement futur | Dépendance DB | Risque |
|---|---|---:|---|
| Worker | émettre un événement unique `profile_evaluated` attribué au CT | Oui | volume, retries, attribution |
| `ig_targets` | état utilization, confiance, version, dates | Oui | lifecycle concurrent |
| `ig_interacted_users` | ne pas utiliser seul pour l'historique CT | Oui | attribution écrasée |
| Journal d'événements | unicité account/target/username/version | Oui | croissance et déduplication |
| Statistiques CT | agrégats uniques et breakdown | Oui | dérive/backfill |
| Snapshots Premium | inclure état d'utilisation versionné | Plus tard | fingerprint matériel |
| Gate low-stock | distinguer stock actif/opérationnel/remplacement | Plus tard | génération en rafale |
| Scheduler | calcul périodique idempotent | Oui | concurrence |
| Notifications/email | uniquement après politique approuvée | Oui | bruit client |
| UI admin | confiance, freshness, détails | Lecture | mauvaise interprétation |
| UI client | libellé simple de renouvellement | Lecture | exposition excessive |
| BotApp | projection read-only et monitoring | Lecture | cache/fraîcheur |
| Monitoring | distributions et faux positifs | Oui | cardinalité |

## Roadmap recommandée

1. **Phase 4.1 actuelle** : audit, modèle pur, seuils candidats, aucun runtime.
2. **Après récupération de baseline DB** : schéma d'événements uniques et évaluations versionnées ; aucun archivage automatique.
3. **Live Shadow** : calcul réel 80/85/90/95, mesure de couverture et faux positifs, aucune suppression.
4. **Replacement Shadow** : préparer un CT Premium de remplacement en gardant l'ancien actif.
5. **Activation progressive** : archiver seulement après remplacement prêt, pilotes, rollback et monitoring.
6. **Généralisation** : seuils par taille/confiance et automatisation supervisée.

## Décisions encore ouvertes

- événement exact qui signifie « évalué » et clé d'unicité ;
- couverture historique minimale acceptée ;
- formule de l'audience exploitable estimée ;
- fraîcheur 7, 14 ou 21 jours ;
- seuil principal 85 ou 90 % ;
- minimum absolu par taille ;
- traitement d'une preuve de frontière contradictoire avec le ratio ;
- délai maximum de `replacement_pending` ;
- raison primaire lorsque low-FBR et exhaustion coexistent ;
- message client et niveau de transparence.

## Ce que cette phase ne prouve pas

Elle ne prouve ni les compteurs réels de production, ni la complétude historique, ni un seuil optimal, ni la qualité d'un dénominateur réel. Elle ne met en place aucune archive, aucun gate runtime, aucune persistance et aucun Live Shadow.
