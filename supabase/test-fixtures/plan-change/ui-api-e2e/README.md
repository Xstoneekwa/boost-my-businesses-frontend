# Plan Change — UI/API E2E (isolated runner)

Runner **UI/API** pour valider les routes Next.js Plan Change contre la DB de test isolée `nxntngkhkoynljcagmkq`. Préparation locale uniquement jusqu’à un **GO explicite**.

- Ref **autorisée** : `nxntngkhkoynljcagmkq`
- Ref **interdite** : `zgafnshkjywfltxgbtzg`
- Variables **obligatoires** : `PLAN_CHANGE_TEST_*` (jamais `.env.local` partagé)
- Service role **serveur uniquement** — jamais dans `NEXT_PUBLIC_*`

## Prérequis

1. Fast Track validé (`5/5`) sur `nxntngkhkoynljcagmkq` via `--verify-only`.
2. Migration de suivi appliquée sur la DB isolée (obligatoire pour quote→activate sans `quote_stale`) :

```bash
# Après GO explicite — appliquer via psql ou supabase db query --linked
psql "$PLAN_CHANGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260622120000_commercial_plan_change_source_revision.sql
```

3. Next.js local pointant vers la DB isolée :

```bash
export NEXT_PUBLIC_SUPABASE_URL='https://nxntngkhkoynljcagmkq.supabase.co'
export NEXT_PUBLIC_SUPABASE_ANON_KEY='…anon…'
export SUPABASE_SERVICE_ROLE_KEY='…service-role…'   # server-only, not NEXT_PUBLIC_*
export SIMULATED_CHECKOUT_ENABLED=true
# exact match required (updated per run by apply script)
export SIMULATED_CHECKOUT_EMAIL_ALLOWLIST='plan_change_ui_test_<run-id>@example.invalid'
```

3. Harness env (terminal du runner, **pas** `.env.local`) :

```bash
export PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only
export PLAN_CHANGE_TEST_SUPABASE_URL='https://nxntngkhkoynljcagmkq.supabase.co'
export PLAN_CHANGE_TEST_DATABASE_URL='postgresql://…@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres'
export PLAN_CHANGE_TEST_SERVICE_ROLE_KEY='…'
export PLAN_CHANGE_TEST_ANON_KEY='…'
export PLAN_CHANGE_UI_API_BASE_URL='http://127.0.0.1:3000'   # optional default
```

## Preflight (read-only)

Vérifie les guards, l’alignement `PLAN_CHANGE_TEST_*`, l’absence de service role dans `NEXT_PUBLIC_*`, puis exécute Fast Track `--verify-only`. **Aucune** création d’utilisateur, quote ou entitlement.

```bash
cd supabase/test-fixtures/plan-change/ui-api-e2e && \
  PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only \
  PLAN_CHANGE_TEST_SUPABASE_URL='https://nxntngkhkoynljcagmkq.supabase.co' \
  PLAN_CHANGE_TEST_DATABASE_URL='postgresql://…@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres' \
  PLAN_CHANGE_TEST_SERVICE_ROLE_KEY='…' \
  PLAN_CHANGE_TEST_ANON_KEY='…' \
  ./preflight-ui-api-e2e.sh
```

## Apply (écriture DB isolée — `--apply` obligatoire)

Crée un utilisateur Auth fictif `plan_change_ui_test_<run-id>@example.invalid`, seed client/entitlement préfixés `plan_change_ui_test_`, puis lance les scénarios API contre Next.js. Tableau compact PASS/FAIL en sortie.

```bash
cd supabase/test-fixtures/plan-change/ui-api-e2e && \
  PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only \
  PLAN_CHANGE_TEST_SUPABASE_URL='https://nxntngkhkoynljcagmkq.supabase.co' \
  PLAN_CHANGE_TEST_DATABASE_URL='postgresql://…@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres' \
  PLAN_CHANGE_TEST_SERVICE_ROLE_KEY='…' \
  PLAN_CHANGE_TEST_ANON_KEY='…' \
  SIMULATED_CHECKOUT_ENABLED=true \
  SIMULATED_CHECKOUT_EMAIL_ALLOWLIST='plan_change_ui_test_<run-id>@example.invalid' \
  ./apply-ui-api-e2e.sh --apply
```

Le script affiche l’e-mail fictif exact à ajouter à `SIMULATED_CHECKOUT_EMAIL_ALLOWLIST` sur le serveur Next.js **avant** `--apply`.

Sans `--apply` : dry-run uniquement (aucune écriture).

## Scénarios API (adaptés au produit actuel)

| # | Scénario | Comportement testé |
|---|----------|-------------------|
| 1 | Dashboard plan actuel | `GET /api/instagram-client/workspace` — label commercial |
| 2 | Change Plan quote au chargement | `POST …/plan-change/quote` (comme `PlanChangeCheckoutForm` useEffect) |
| 3 | Quote idempotente au reload | même `idempotency_key` → même `quote_id` |
| 4 | Montant dû > 0 | activation bloquée (`402` / `payment_required`) |
| 5 | Activation simulée | autorisée seulement si e-mail allowlisté `@example.invalid` |
| 6 | Downgrade | crédit sans remboursement cash (premium → growth) |
| 7 | Dashboard plan final | projection workspace après flux |
| 8 | Double clic / retry | deuxième activate → `idempotent_replay`, pas de doublon |

## Écritures DB (apply uniquement)

| Cible | Action |
|-------|--------|
| `auth.users` | 1 utilisateur fictif `plan_change_ui_test_<run-id>@example.invalid` (Admin API) |
| `public.tenant_users` | table créée si absente (`bootstrap-ui-api-minimal.sql`) |
| `public.clients` | 1 client `plan_change_ui_test_client_<run-id>` |
| `public.tenant_users` | lien user ↔ client |
| `public.commercial_checkout_sessions` | session seed `plan_change_ui_test_seed_session_<run-id>` |
| `public.client_account_entitlements` | entitlement growth seed |

**Non écrit par ce runner** : quotes/activations produit (créées par les appels API pendant le test), bootstrap Fast Track, migration, `supabase db push`, accès DB source partagée.

## Futur rerun isolé (après GO + migration de suivi)

```bash
# 1. Migration source_revision canonique (une fois par DB isolée)
psql "$PLAN_CHANGE_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260622120000_commercial_plan_change_source_revision.sql

# 2. Preflight read-only
cd supabase/test-fixtures/plan-change/ui-api-e2e && ./preflight-ui-api-e2e.sh

# 3. Apply + E2E API (Next.js sur nxntng + allowlist @example.invalid)
cd supabase/test-fixtures/plan-change/ui-api-e2e && ./apply-ui-api-e2e.sh --apply
```

Cible : **8/8 PASS** sans alignement manuel de `source_revision` ni patch SQL ad hoc.

## Tests statiques (sans DB)

```bash
node --test supabase/test-fixtures/plan-change/ui-api-e2e/ui-api-e2e.test.mjs
```

Ou via le validateur harness :

```bash
node supabase/test-fixtures/plan-change/validate-harness-local.mjs
```
