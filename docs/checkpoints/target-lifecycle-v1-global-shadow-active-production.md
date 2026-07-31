# Target Lifecycle V1 — Global Shadow actif en production

Date de certification : 2026-07-31 20:50 SAST

Verdict : `GO — TARGET LIFECYCLE V1 ACTIVE GLOBALLY IN PRODUCTION SHADOW`

`NEXT_STEP_AUTHORIZED=false`

## Périmètre livré

Target Lifecycle V1 produit désormais globalement, pour tous les comptes actifs :

- les assessments Lifecycle ;
- la projection Lifecycle Current ;
- les observations de performance utilisées comme source de décision Shadow ;
- les métriques d'exécution, de sécurité et de couverture.

La livraison reste strictement non autoritaire. Les gates suivants sont OFF :

- enforcement ;
- actions métier Lifecycle ;
- archivage ;
- notifications ;
- remplacement ;
- remplacement Premium automatique.

Aucun run Instagram, tick manuel, ADB, geste téléphone, changement de compte, release Worker ou restart Worker n'a été exécuté par ce chantier.

## Baselines et réconciliation

- Backend de départ : `6f3537c483abb4d0f3a6748ec8540d31fc87bf3d`
- Backend final déployé : `afdbc88f99103d980cd819858896bc7deab47330`
- Worker conservé : `703c6aa8817a1154843727b5acee536e28a8764d`
- Release Worker : `/Users/admin/phonefarm-worker-releases/703c6aa-jautomatise-follow60-rpc-perf-v2`
- CT Resume V4 en production : `20260731151702_target_followers_resume_commit_provenance_v4`
- Follow 60 en production : `20260731152156_follow_60s_midcanary_stage_barrier_v1` et `20260731154709_follow_60s_canary_pilot_switch_loriele_v1`
- Migration Lifecycle appliquée après ces versions, sans modifier leurs objets ni leurs RPC.
- Aucun cherry-pick des anciennes branches CT Resume ou Follow 60 n'a été effectué.

## Base de données

Migrations sources figées :

1. `20260731161623_target_lifecycle_v1_global_shadow_runtime_v1.sql`
   - version réelle du registre Supabase : `20260731175601`
   - SHA-256 : `d65044026f4ed93ee06f0adeef269b2d97966f94e6e75638b0f2911c76bc1254`
2. `20260731180200_target_lifecycle_runtime_service_role_least_privilege_v1.sql`
   - version réelle du registre Supabase : `20260731175852`
   - SHA-256 : `2605a4672dad2f8e53301e9b8dfcd9d44d70f2bb0b48807f441f06a99c101624`

Rollbacks figés :

- migration principale : `e0e5626b19f845445659032d5877036a508d61187a74e1ee628c59f468681d93`
- least privilege : `f31089ca8c1d9ccbc81df1ff4416d87d23e750ae8182902d4f085978931d24e5`

Contrôles post-apply :

- backfill métier : `0`
- RLS activée sur les 10 tables du domaine : `10/10`
- FORCE RLS activée : `10/10`
- grants directs `anon`/`authenticated` : `0`
- exécution RPC par `anon`/`authenticated` : `0`
- RPC requis sans droit `service_role` : `0`
- tables de contrôle et métriques : lecture directe uniquement pour `service_role`
- écritures runtime bornées aux tables producer/projector prévues.

Le premier audit post-apply a détecté des grants `service_role` trop larges sur six tables de contrôle/métriques. L'activation a été stoppée avant certification, puis le forward-fix least-privilege additif a été appliqué et revérifié. Aucun rollback DB n'a été nécessaire.

## Architecture de données

Priorité des sources :

1. Target Availability Current lorsque disponible ;
2. signaux de performance canoniques ;
3. utilisation calculée avec dénominateur explicite ;
4. classification fail-closed `stale_data` ou `insufficient_data` lorsque les preuves sont insuffisantes.

Les 106 cibles du scope ont une source performance reconnue. Le dénominateur d'utilisation est disponible pour 104 cibles. Quatre cibles disposent d'un lien Availability Current au moment de la certification.

## Correction du curseur de scan

Deux défauts de certification ont été observés et corrigés avant le verdict final :

1. Un batch limité par la durée avançait le curseur jusqu'à la dernière ligne chargée au lieu de la dernière ligne réellement traitée. Cela pouvait sauter silencieusement des cibles.
2. Le premier correctif conservait la bonne position, mais supprimait le marqueur `wrapped` lorsqu'un nouveau cycle était lui-même partiel. La couverture atteignait 106/106, mais `scan_count` restait à 1.

Le runtime final :

- avance uniquement jusqu'à la dernière cible terminalement traitée ;
- s'arrête sur erreur ou résultat invalide sans dépasser cette frontière ;
- conserve le marqueur de cycle complet lors d'un wrap partiel ;
- maintient l'idempotence et la déduplication.

Validation locale finale : `181/181` tests consolidés Lifecycle + Availability + CT, build Next.js vert et `git diff --check` vert.

Le wrap réel initial ayant eu lieu sous la première correction, le marqueur manqué a été réparé une seule fois via le RPC canonique d'avancement, avec le curseur courant inchangé et `wrapped=true`. Cette opération n'a lancé ni run ni tick et n'a modifié aucune cible métier. Un tick cron naturel ultérieur sur le code final a confirmé le comportement.

## Déploiement Backend

- Commit runtime : `afdbc88f99103d980cd819858896bc7deab47330`
- Deployment Vercel : `dpl_5mi59x6Cdt7jQLvvmdemnvg2u76T`
- URL immuable : `https://boost-my-businesses-ai-frontend-vercel-57aqgmgl7.vercel.app`
- Alias : `https://www.boostmybusinesses.com`
- Statut : `READY`
- HTTP alias : `200`

## Configuration production certifiée

ON :

- Lifecycle producer
- Lifecycle Current projector
- Lifecycle Shadow
- scope `all_active_accounts`

OFF :

- Lifecycle enforce
- business actions
- lifecycle actions
- replacement
- notifications
- archiving
- Premium replacement

Target Availability reste inchangé en Global Shadow : capture, writer, identity, assessment, current et shadow ON ; Policy Shadow, enforcement et actions métier OFF.

## Couverture et données réelles

- comptes actifs : `5`
- tenants : `3`
- cibles actives/scopées : `106/106`
- assessments Lifecycle : `106`
- Lifecycle Current : `106`
- observations de performance : `106`
- `scan_count` : `3`
- dernier scan complet : `2026-07-31T18:44:33.427695Z`

Répartition Current :

- `stale_data` : `53`
- `insufficient_data` : `53`
- `healthy` : `0`
- `watch` : `0`
- `replacement_recommended` : `0`
- `replacement_pending` : `0`
- `exhausted` : `0`
- `archived` : `0`
- statut inconnu ou invalide : `0`

Cette répartition est une sortie Shadow fondée sur les données disponibles. Elle n'autorise aucune décision métier.

## Métriques de certification

- batches : `34`
- tentatives : `791`
- traitements effectifs : `106`
- dédupliqués : `222`
- cap hits : `31`
- latence p50 moyenne des batches : `266.332 ms`
- latence p95 moyenne des batches : `366.421 ms`
- cycle max : `3625.453 ms`
- CPU moyen : `133.583 ms`
- CPU max : `336.708 ms`
- delta mémoire moyen : `3,144,041 octets`
- delta mémoire max : `22,478,848 octets`
- erreurs : `0`
- retries : `0`
- out-of-order : `0`
- version regressions : `0`
- cross-tenant : `0`
- auto-kill : `0`

Les dédupliqués correspondent aux passages idempotents attendus ; aucune ligne Current dupliquée n'a été créée. Les cap hits sont les coupures de durée bornées du scanner et n'indiquent plus de cible sautée.

## Preuve de zéro action métier

Baseline et état final identiques :

- CT totales : `145`
- CT archivées : `39`
- CT supprimées : `0`
- notifications existantes : `6`
- propositions CT : `0`
- liens de remplacement : `0`

Deltas causés par Lifecycle :

- mutation cible : `0`
- archivage : `0`
- notification : `0`
- remplacement : `0`
- action métier : `0`

Les alertes Lifecycle sont à `0`. Les requests, runs, device locks, tick locks, queue et backlog étaient à `0` au gate final.

## Golden Flow et Worker

Le code Worker n'a pas changé et aucun restart n'a été effectué. La release active est restée `703c6aa`. Les PID `36019` (wrapper) et `36048` (consumer) sont présents et les ticks naturels observés se terminent avec `enqueued_count=0`.

Le contrôleur canonique a brièvement affiché `starting/processCount=0` parce que son préflight Supabase échouait sur une résolution DNS. Le recoupement direct `ps`, le PID file et les logs continus ont prouvé qu'il s'agissait d'un faux négatif d'outillage, pas d'un arrêt Worker.

Aucune régression Lifecycle observée sur Follow, Unfollow, Resume ou Auto Restart. Ces flux n'ont aucune dépendance au succès du producteur Shadow.

## Frontière suivante

La prochaine étape recommandée est une période d'observation du Global Shadow puis une revue formelle de la Policy Lifecycle. Toute activation d'enforcement ou d'action métier exige un GO distinct, de nouveaux critères de sécurité et une fenêtre contrôlée.

Le chantier Follow 60 / Loriele peut reprendre depuis son successeur Worker coordonné ; il ne doit pas modifier les fichiers Lifecycle ni considérer cette certification comme une autorisation d'enforcement.

`NEXT_STEP_AUTHORIZED=false`
