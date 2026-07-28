# CT Premium — contrat futur d'intégration DB

## Statut

Spécification uniquement. Ce document n'autorise aucune migration, requête de production ou persistance. L'intégration reste bloquée jusqu'à un GO DB explicite et une baseline de migrations certifiée. Aucun SQL n'est fourni.

La Phase 4.2 ajoute uniquement des ports futurs au contrat : journal des évaluations uniques, repository d'assessments lifecycle, runner de policy, archive, remplacement, notification, email et métriques. Le moteur universel demeure indépendant de leur implémentation. La synthèse et la répartition des propriétaires figurent dans `docs/ct-system-canonical-architecture.md`.

## Données à persister

Le futur stockage doit représenter séparément :

- événements uniques de profils évalués, scopés par tenant/account/target/username canonique, avec outcome diagnostique et version Worker ;
- assessments lifecycle versionnés, métriques, confiance, reasons et décision de policy séparée ;

- snapshots immuables, avec `tenant_id`, `account_id`, payload canonique, fingerprint et version de scoring ;
- batches, scope account, entitlement capturé, statut, fenêtre de revue, idempotency key et version optimiste ;
- propositions, username normalisé, score/breakdown, statut, décision, reason code et version ;
- événements append-only, acteur/source/date et métadonnées bornées ;
- intents de notification et d'email, séparés de leur livraison ;
- tentatives d'activation et résultat vers le futur target actif.

Chaque ligne doit porter `tenant_id` et `account_id`. Aucune jointure ou politique ne doit déduire le compte à partir du seul tenant.

## Contraintes et index attendus

- unicité du fingerprint snapshot dans le scope account si la réutilisation est retenue ;
- unicité de l'idempotency key batch dans le scope account ;
- unicité du username normalisé parmi les propositions actives d'un account ;
- version optimiste pour batch et proposition ;
- contraintes de statut cohérentes avec les unions TypeScript ;
- index par `(tenant_id, account_id, status)` et par expiration des batches reviewables ;
- événement immuable ordonné par date et identifiant.

Les doublons entre deux `account_id` distincts restent permis en V1.

## Transactions/RPC futures

Les opérations mutantes devront être transactionnelles et idempotentes :

1. créer un batch, ses propositions et son événement ready ;
2. accepter/rejeter une ou plusieurs propositions avec contrôle de version et scope ;
3. réclamer atomiquement un batch expiré pour auto-validation ;
4. enregistrer décisions de revalidation et intents associés ;
5. activer une proposition dans `ig_targets` après dernier contrôle entitlement/runtime/blacklist/doublon ;
6. enregistrer target, statut de proposition, événement et éventuel intent dans une même frontière transactionnelle ;
7. appliquer downgrade/pause/cancel sans rouvrir d'ancien batch.

Les signatures devront exiger `tenant_id`, `account_id`, identifiant d'entité, version attendue et clé d'idempotence. Tout mismatch doit échouer explicitement avec un code stable.

## Sécurité et ownership

- RLS doit être activée sur toute table exposée, avec une authorization account-aware, pas uniquement `TO authenticated`.
- Les prédicats doivent vérifier ownership actif du tenant et du compte, ainsi que l'accès agence explicite.
- Les policies UPDATE devront comporter `USING` et `WITH CHECK`.
- Les vues exposées devront respecter le contexte d'invoker.
- Une fonction privilégiée ne devra être utilisée que si la transaction l'exige réellement ; elle devra vivre hors schéma exposé, vérifier l'identité/scope, fixer un search path sûr et ne pas conserver les droits `PUBLIC` par défaut.
- Les mutations backend internes devront utiliser un rôle serveur jamais exposé au navigateur.
- Les grants effectifs devront être vérifiés après application, indépendamment du SQL déclaré.

## Idempotence et concurrence

- Création batch : fingerprint + account + version scoring.
- Décision : proposition + version attendue + acteur/source.
- Timeout : claim atomique d'un batch expiré, reprise des seules pending, événements uniques.
- Activation : batch + proposition + idempotency key ; un retry retourne le résultat existant.
- Toute version périmée produit `idempotency_conflict`/concurrency conflict, sans décision partielle silencieuse.

Un worker interrompu doit pouvoir reprendre à partir des statuts persistés sans retraiter `rejected`, `invalidated` ou `activated`.

## Revalidation et activation `ig_targets`

La transaction d'activation doit relire au dernier instant : entitlement Premium, pause/cancel/blocker, ownership, lifecycle, blacklist, présence dans `ig_targets`, proposition active concurrente et qualité du profil. Un échec produit `invalidated` ou `activation_failed` avec reason code ; il ne crée jamais de target.

L'insertion dans `ig_targets` doit réutiliser ses contrats canoniques d'ownership, lifecycle, audit et qualité. La proposition ne devient `activated` qu'après succès confirmé dans la même transaction.

## Audit, notifications et emails

Les événements CT constituent l'audit du domaine et devront ensuite être projetés vers l'Activity Log sans confondre intent et livraison. Un batch ready peut produire un intent notification et un intent email idempotents. La livraison réelle doit rester un consommateur séparé, avec statut, tentative, erreur sûre et corrélation.

Aucun email ne doit affirmer qu'une pending sera ajoutée sans revalidation. Downgrade, pause et cancel doivent invalider ou bloquer les intents obsolètes avant envoi.

## Scheduler futur

Le scheduler ne doit que réclamer les batches dont `expires_at <= now`, appeler l'orchestrateur de domaine et persister transactionnellement son résultat. Il ne doit pas recalculer les règles métier. Le timezone n'affecte pas la durée : `expires_at` est un instant UTC déterminé à partir de `review_started_at + 5 jours`.

## Plan d'intégration

1. Certifier/récupérer l'historique canonique des migrations.
2. Valider modèle, noms et stratégie de rollback avec revue humaine.
3. Créer un environnement temporaire et une migration unique via le workflow Supabase autorisé.
4. Tester contraintes, RLS, grants effectifs, concurrence, rollback et non-replay.
5. Implémenter les adaptateurs Supabase derrière les ports existants, sans modifier le domaine.
6. Ajouter les handlers API avec auth/ownership account-aware et flags fermés.
7. Brancher outbox notification/email puis scheduler, toujours flags fermés.
8. Effectuer une revue de sécurité et des tests de charge/idempotence.
9. Activer progressivement sur fixtures/environnement contrôlé, jamais sur un compte client mutable sans autorisation.

## Points bloqués ou à décider

- certification de la baseline migrations et stratégie de non-replay ;
- schéma/noms définitifs et politique de rétention ;
- taille produit par défaut d'un batch ;
- durée/source du cooldown de rejet ;
- fournisseur de recherche/vérification et contrat de revalidation ;
- modèle exact des notifications/emails et calendrier de relance ;
- rôle du scheduler, fréquence et stratégie de lease ;
- traitement opérateur d'un `activation_failed` ;
- correspondance exacte vers les champs et événements actuels d'`ig_targets` et Activity Log.

Tant que ces points et le GO DB ne sont pas clos, les ports mémoire restent la seule implémentation autorisée.
