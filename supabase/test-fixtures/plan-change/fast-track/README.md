# Plan Change — Fast Track (isolated functional validation)

Validation fonctionnelle **rapide** sur la DB de test isolée `nxntngkhkoynljcagmkq`. Ce chemin **ne remplace pas** le harness snapshot/audit pour une parité intégrale avec la DB source partagée.

## Prérequis (terminal local uniquement)

```bash
export PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only
export PLAN_CHANGE_TEST_DATABASE_URL='postgresql://…@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres'
```

- Ref **autorisée** : `nxntngkhkoynljcagmkq`
- Ref **interdite** : `zgafnshkjywfltxgbtzg`
- Ne pas utiliser `.env.local` ni `supabase db push`

## Dry-run (par défaut — aucune écriture)

```bash
cd supabase/test-fixtures/plan-change/fast-track && \
  PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only \
  PLAN_CHANGE_TEST_DATABASE_URL='postgresql://…@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres' \
  ./apply-fast-track-plan-change.sh
```

## Apply (écriture DB — `--apply` obligatoire)

```bash
cd supabase/test-fixtures/plan-change/fast-track && \
  PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only \
  PLAN_CHANGE_TEST_DATABASE_URL='postgresql://…@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres' \
  ./apply-fast-track-plan-change.sh --apply
```

## Verify-only (lecture seule — run existant)

Après un apply ou un smoke déjà exécuté, re-vérifier les résultats **sans** bootstrap, migration, seed ni smoke mutationnel :

```bash
cd supabase/test-fixtures/plan-change/fast-track && \
  PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only \
  PLAN_CHANGE_TEST_DATABASE_URL='postgresql://…@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres' \
  ./apply-fast-track-plan-change.sh --verify-only
```

- **Read-only** : exécute uniquement `verify-fast-track-results.sql`
- Compare `period_end_at` en `timestamptz` (pas de comparaison stricte `+00` vs `+00:00`)
- Aucune RPC, aucune écriture sur tables persistantes

## Séquence

1. `bootstrap-fast-track-baseline.sql` — socle minimal Plan Change
2. `supabase/migrations/20260621120000_commercial_plan_change.sql` — migration réelle
3. `NOTIFY pgrst, 'reload schema'`
4. `seed-fast-track.sql` — données fictives `plan_change_test_*`
5. `run-fast-track-smoke.sql` — scénarios A–E (tableau PASS/FAIL)

Option post-run : `--verify-only` → `verify-fast-track-results.sql` (lecture seule).

## Scénarios smoke

| Scénario | Vérifie |
|----------|---------|
| A | Upgrade montant dû > 0 → `payment_required`, pas d’activation |
| B | Upgrade simulé → entitlement cible, `period_end_at` conservé |
| C | Downgrade → crédit ledger, pas de cash |
| D | Crédit client réutilisé, reliquat correct |
| E | Idempotence → pas de doublon session/quote |

## Limites

- Fixture test-only : pas de reproduction complète du schéma source (RLS production, triggers hors scope, etc.).
- Valide la migration/RPC et les règles métier Plan Change sur données fictives isolées.
