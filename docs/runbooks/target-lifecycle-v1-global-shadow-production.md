# Target Lifecycle V1 — runbook Global Shadow production

Ce runbook décrit une activation Shadow sans action métier. Il n'autorise jamais Lifecycle Enforcement, Policy Shadow, Premium Replacement, notification, archivage ou suppression CT.

## Préflight bloquant

1. Obtenir la restitution explicite du chantier Follow 60 et son SHA Backend/Worker final.
2. Rebaser/reconstruire le candidat Lifecycle sur le SHA Backend production restitué ; ne pas écraser les changements concurrents.
3. Exiger un tree propre, remote exact et build/test final vert.
4. Re-lister le registre Supabase. La migration Lifecycle doit rester strictement postérieure à la tête production certifiée (`20260731154709` lors de cette livraison).
5. Stopper sur collision de timestamp, historique incertain ou migration antérieure encore réservée/non autorisée.
6. Recertifier Target Availability global Shadow inchangé et non autoritaire.
7. Recertifier zéro request/run/queue/device lock/tick lock avant la fenêtre DB et le déploiement.
8. Capturer DDL, contraintes, RLS/FORCE RLS, grants, fonctions, index et counts des six stores Lifecycle existants.

## Déploiement dormant

1. Appliquer uniquement `20260731161623_target_lifecycle_v1_global_shadow_runtime_v1.sql` avec le SHA-256 `d65044026f4ed93ee06f0adeef269b2d97966f94e6e75638b0f2911c76bc1254`.
2. Vérifier que le singleton est dormant : producer/projector/shadow OFF, scope `off`, auto-kill OFF et toutes actions métier OFF.
3. Vérifier les douze tables protégées, les dix RPC service-role-only, les index et les contraintes no-action.
4. Vérifier que les counts historiques Lifecycle sont inchangés.
5. Déployer le SHA Backend exact sur Vercel.
6. Vérifier provenance, `READY`, alias `www.boostmybusinesses.com` HTTP 200, route cron construite et route status privée.
7. Ne modifier ni Worker, ni symlink, ni dispatcher ; restart count attendu : zéro.

## Activation Global Shadow

1. Lire `config_version` du singleton dormant.
2. Appeler une seule fois `activate_target_lifecycle_global_shadow_v1(expected_version, actor)` avec `service_role`.
3. Re-lire le singleton : producer/projector/shadow ON, `all_active_accounts`, toutes actions OFF.
4. Attendre le cron naturel ou appeler seulement le cron Lifecycle authentifié ; ne jamais lancer un run/tick Instagram.
5. Surveiller jusqu'à la fin d'un scan complet : assessments/current, status distribution, latence, CPU, mémoire, erreurs, retries, duplications, out-of-order, cross-tenant et caps.
6. Vérifier Follow, Unfollow, Resume, Auto Restart, queue/locks et Golden Flow sans interaction téléphone/ADB.

## Stop et rollback runtime

Déclencher immédiatement `deactivate_target_lifecycle_global_shadow_v1(actor)` ou laisser l'auto-kill agir si : cross-tenant, erreurs critiques répétées, latence critique, projection incohérente ou régression Golden Flow.

La désactivation dynamique suffit ; aucun restart n'est requis. Les assessments valides sont conservés pour audit.

## Rollback schéma exceptionnel

Le rollback `20260731161623_target_lifecycle_v1_global_shadow_runtime_v1.down.sql` :

- désactive et retire le runtime, ses RPC/tables/index ;
- retire uniquement les colonnes V1 ajoutées ;
- conserve les six stores historiques et leurs lignes ;
- conserve la frontière de sécurité renforcée RLS/FORCE RLS et les grants minimaux.

Un rollback schéma requiert une nouvelle autorisation explicite et une sauvegarde préalable. Il ne doit pas être exécuté pour une simple désactivation Shadow.

## Checkpoint final

Après preuve production, écrire `docs/checkpoints/target-lifecycle-v1-global-shadow-active-production.md` avec les SHAs, migration, deployment, temps d'activation, counts, distribution, p50/p95, impacts, isolation, rollback et `NEXT_STEP_AUTHORIZED=false`.
