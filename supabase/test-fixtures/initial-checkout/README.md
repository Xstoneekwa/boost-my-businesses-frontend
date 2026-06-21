# Initial Checkout — isolated simulated E2E

Runner **local only** pour valider le premier checkout simulé sur `nxntngkhkoynljcagmkq`.

- Ref **autorisée** : `nxntngkhkoynljcagmkq`
- Ref **interdite** : `zgafnshkjywfltxgbtzg`
- Confirmation serveur obligatoire : `SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM=isolated-test-only`
- URL serveur obligatoire (guards simulation) : `SUPABASE_URL` — **jamais** `NEXT_PUBLIC_*` pour la décision sécurité
- E-mails fictifs uniquement : `*@example.invalid`
- Aucun client/workspace préexistant pour le parcours purchaser — la simulation crée le tenant

## Guards simulation (first_purchase)

La simulation n'est disponible que si **toutes** les conditions suivantes sont vraies côté serveur :

1. `SUPABASE_URL` → ref `nxntngkhkoynljcagmkq`
2. `SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM=isolated-test-only`
3. `SIMULATED_CHECKOUT_ENABLED=true`
4. e-mail `*@example.invalid`
5. e-mail dans `SIMULATED_CHECKOUT_EMAIL_ALLOWLIST`

Sinon : `403` avec `simulated_checkout_forbidden` ou `simulation_unavailable`. Jamais `payment_required`.

## Preflight (read-only)

```bash
cd supabase/test-fixtures/initial-checkout && \
  INITIAL_CHECKOUT_DB_TEST_CONFIRM=isolated-test-only \
  INITIAL_CHECKOUT_TEST_SUPABASE_URL='https://nxntngkhkoynljcagmkq.supabase.co' \
  INITIAL_CHECKOUT_TEST_DATABASE_URL='postgresql://…@db.nxntngkhkoynljcagmkq.supabase.co:5432/postgres' \
  INITIAL_CHECKOUT_TEST_SERVICE_ROLE_KEY='…' \
  ./preflight-initial-checkout.sh
```

## Prepare (écriture DB isolée — `--apply` obligatoire, après GO)

Crée :

- `initial_checkout_payment_<run-id>@example.invalid` — probe non allowlisté (Auth user seulement)
- `initial_checkout_test_<run-id>@example.invalid` — purchaser allowlisté (mot de passe local, **pas** d'Auth user pré-créé)

```bash
./prepare-initial-checkout.sh --apply
```

Mots de passe : `.run-state/initial-checkout-latest.json` uniquement (gitignored).

## Démarrer Next.js test-only

```bash
export SUPABASE_URL='https://nxntngkhkoynljcagmkq.supabase.co'
export NEXT_PUBLIC_SUPABASE_URL='https://nxntngkhkoynljcagmkq.supabase.co'
export NEXT_PUBLIC_SUPABASE_ANON_KEY='…'
export SUPABASE_SERVICE_ROLE_KEY='…'
export SIMULATED_CHECKOUT_ISOLATED_TEST_CONFIRM=isolated-test-only
export SIMULATED_CHECKOUT_ENABLED=true
export SIMULATED_CHECKOUT_EMAIL_ALLOWLIST='initial_checkout_test_<run-id>@example.invalid'
./start-initial-checkout-next.sh
```

## Parcours humain attendu

1. `/instagram-growth/checkout?plan=growth` (ou Pro/Premium)
2. Quote → bouton simulation visible seulement si permission serveur
3. Payment probe → activation refusée (`simulation_unavailable`)
4. Purchaser allowlisté → simulation → handoff `/instagram-login`
5. Login manuel → `/instagram-client` → Add Instagram account

## Validation locale (sans DB)

```bash
node supabase/test-fixtures/initial-checkout/validate-harness-local.mjs
```

## Scénarios API (après GO)

`run-initial-checkout-e2e.mjs` couvrira : refus ref/confirm/email/allowlist, succès provisioning, idempotence, handoff login, non-régression Plan Change.
