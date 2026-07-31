# Target Lifecycle V1 — contrat Global Shadow

Statut du document : candidat Backend/DB certifié localement, non déployé au moment de sa création.

## Frontière métier

Target Lifecycle V1 produit une évaluation universelle pour Growth, Pro et Premium. Il ne connaît pas la politique commerciale d'un pack et n'exécute aucune action métier.

Entrées canoniques :

- scope strict `(tenant_id, account_id, target_id, normalized_username)` ;
- Target Availability Current et Identity Current ;
- Target Performance à partir des compteurs FBR certifiés et des outcomes CT (`skips`, erreurs) ;
- Target Utilization avec `uniqueProfilesEvaluated` comme numérateur canonique ;
- fraîcheur, version et provenance de chaque source.

Sorties : `healthy`, `watch`, `replacement_recommended`, `replacement_pending`, `exhausted`, `archived`, `stale_data` ou `insufficient_data`.

Les sorties `replacement_*` et `exhausted` sont seulement des recommandations Shadow. Les contraintes DB imposent toujours :

- `enforcement_allowed = false` ;
- `business_action_allowed = false` ;
- `mutation_executed = false` ;
- zéro notification, archive, remplacement ou mutation CT.

## Priorité déterministe

1. CT déjà archivé dans la vérité source ;
2. identité ambiguë : échec fermé et revue opérateur ;
3. Availability `unavailable_confirmed` ou `verified_restricted_confirmed` : remplacement recommandé ;
4. remplacement déjà pending ;
5. utilisation épuisée ;
6. utilisation replacement pending/recommended ;
7. FBR fiable inférieur à `8 %` avec au moins `100` follows significatifs ;
8. preuve obsolète ;
9. preuve insuffisante ;
10. signal watch ;
11. healthy.

La matrice de replay couvre 40 scénarios, dont les valeurs Availability V3, l'identité, la fraîcheur, le seuil exact `8 %`, la borne exacte `100`, l'ordre des événements et les régressions de version.

## Architecture runtime

```text
Vercel Cron authentifié (1 minute)
        |
        v
Target Lifecycle bounded pipeline
        |
        +-- état dormant/actif et caps DB
        +-- lease globale (concurrence 1)
        +-- scan all_active_accounts par 25 CT
        +-- moteur pur et versionné
        +-- RPC atomique idempotent
        +-- métriques / auto-kill
        |
        v
Assessment append-only + Current CAS
```

Le pipeline est indépendant des runs Instagram, de Follow, Unfollow, Resume et Auto Restart. Une erreur Lifecycle ne bloque pas leur Golden Flow. Aucun changement Worker n'est requis.

Caps initiales :

| Cap | Valeur |
|---|---:|
| batch | 25 CT |
| retries | 1 |
| budget par item | 3 000 ms |
| assessments globaux/jour | 1 000 |
| assessments/compte/jour | 250 |
| concurrence globale | 1 |

Avec 106 CT actifs lors de l'audit, un scan complet demande cinq ticks au maximum sans atteindre le cap journalier.

## Persistance et ordre

`assessment_key` et `source_fingerprint` rendent les replays idempotents. Le projecteur Current utilise `source_max_observed_at` puis `engine_revision` :

- même clé : `deduplicated` ;
- source plus ancienne : `out_of_order_skipped` ;
- révision moteur plus ancienne : `version_regression_skipped` ;
- scope incohérent : `cross_tenant_rejected` et auto-kill.

Les assessments restent append-only. Le Current est la seule projection mutable. Les checkpoints, métriques, caps et leases sont bornés et isolés du catalogue CT.

## Sécurité

Toutes les tables Lifecycle ont RLS et FORCE RLS. `public`, `anon` et `authenticated` n'ont aucun privilège. `service_role` reçoit seulement les privilèges directs minimaux ; les écritures runtime passent par des RPC `SECURITY DEFINER` dont `EXECUTE` est révoqué aux rôles navigateur.

Les clés étrangères composites imposent le couple tenant/compte et le couple compte/CT. Les RPC revalident en plus le compte actif, ready, connected et le CT actif.

## Auto-kill

Le runtime se remet automatiquement en état dormant et exige une réactivation humaine si l'un des signaux suivants apparaît :

- tentative cross-tenant ;
- action métier inattendue ;
- divergence de version ;
- volume supérieur au batch borné ;
- au moins trois lignes partielles/invalides dans un batch ;
- au moins trois erreurs dans un batch ;
- latence maximale supérieure à trois fois le budget configuré.

L'auto-kill coupe producer/projector/shadow, remet le scope à `off`, incrémente la version de configuration et journalise une alerte critique. Il n'effectue aucun restart.

## Validation locale certifiée

- build Next.js 16.2.1 et TypeScript : vert ;
- replay Lifecycle : 40 cas, déterministes et sérialisables ;
- suites Lifecycle/Availability/CT consolidées : 202/202 ;
- contrat statique migration/runtime : 6/6 ;
- reconstruction PostgreSQL 17 depuis la baseline CT : verte ;
- activation, scan, caps, lease, persist, replay, ordre, version, cross-tenant, métriques et auto-kill en DB locale : verts ;
- rollback local : runtime supprimé, 7 assessments historiques conservés, RLS/FORCE RLS conservés.

Migration candidate : `20260731161623_target_lifecycle_v1_global_shadow_runtime_v1.sql`, SHA-256 `d65044026f4ed93ee06f0adeef269b2d97966f94e6e75638b0f2911c76bc1254`.

Cette certification locale n'est pas une certification production.
