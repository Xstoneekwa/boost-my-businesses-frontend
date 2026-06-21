# Plan change — validation DB/RPC sur environnement Supabase isolé

**Statut actuel : NO-GO** — aucune base isolée identifiée dans le dépôt. Ne pas appliquer la migration tant que ce runbook n’est pas complété sur un projet dédié.

---

## 1. Garde environnement (obligatoire)

### 1.1 Bases interdites

| Identifiant | Raison |
|-------------|--------|
| Projet ref `zgafnshkjywfltxgbtzg` | DB dev partagée (`.env.local`) — contient les workspaces Lucie et Liam |
| Projet ref `nxntngkhkoynljcagmkq` | **DB isolée autorisée** pour le chantier Plan Change |
| Client `c51267f5-6c0d-46db-8ba0-7f1746a7b4bc` | Lucie — checkout simulé existant |
| Client `c37c9143-ee14-4c9a-9a60-226759241733` | Liam — workspace protégé |
| Toute URL `.supabase.co` sans confirmation explicite isolée | Risque prod/dev partagé |

### 1.2 Critères d’acceptation d’une DB test

La base est **isolée** si **toutes** les conditions suivantes sont vraies :

1. Projet Supabase **créé pour ce test uniquement** (nom explicite, ex. `boost-plan-change-test`).
2. Project ref **différent** de `zgafnshkjywfltxgbtzg`.
3. Aucun client Lucie/Liam présent (`SELECT id FROM clients WHERE id IN (...)` → 0 lignes).
4. Credentials stockés **hors** `.env.local` partagé — variables dédiées uniquement :
   - `PLAN_CHANGE_TEST_SUPABASE_URL`
   - `PLAN_CHANGE_TEST_SERVICE_ROLE_KEY`
   - `PLAN_CHANGE_TEST_ANON_KEY` (tests RLS)
5. Garde script : `PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only`

### 1.3 Preuve d’isolation à consigner dans le rapport

```
Project name:     <dashboard name>
Project ref:      <20-char ref>
URL (masked):     https://****.supabase.co
Lucie present:    no
Liam present:     no
Shared ref match: no (≠ zgafnshkjywfltxgbtzg)
```

---

## 2. Provisionnement du projet test

### 2.1 Créer le projet

1. Supabase Dashboard → New project → région EU, mot de passe DB fort.
2. Noter `project ref`, URL, `service_role` et `anon` keys.
3. **Ne pas** copier ces clés dans `.env.local`.

### 2.2 Migrations de base (prérequis checkout simulation)

Appliquer **dans l’ordre** via SQL Editor ou `supabase db push` **sur le projet test uniquement** :

| Ordre | Fichier | Obligatoire pour plan change |
|-------|---------|------------------------------|
| 1 | `20260615143000_commercial_checkout_entitlements.sql` | Oui |
| 2 | `20260621120000_commercial_plan_change.sql` | Oui (feature) |

Vérifier après apply :

```sql
SELECT to_regclass('public.commercial_checkout_sessions');
SELECT to_regclass('public.client_account_entitlements');
SELECT to_regclass('public.commercial_plan_change_quotes');
SELECT to_regclass('public.client_credit_ledger');
SELECT proname FROM pg_proc WHERE proname = 'activate_commercial_plan_change';
```

### 2.3 Variables d’environnement (session shell dédiée)

```bash
export PLAN_CHANGE_DB_TEST_CONFIRM=isolated-test-only
export PLAN_CHANGE_TEST_SUPABASE_URL=https://<ISOLATED_REF>.supabase.co
export PLAN_CHANGE_TEST_SERVICE_ROLE_KEY=<service_role>
export PLAN_CHANGE_TEST_ANON_KEY=<anon>
export SIMULATED_PLAN_CHANGE_ACTIVATION_ENABLED=true
export SIMULATED_PLAN_CHANGE_EMAIL_ALLOWLIST=test-plan-change@example.com
```

---

## 3. Validation automatisée (phase schema)

Sans workspace test — immédiatement après migration :

```bash
node scripts/validate-plan-change-db-integration.mjs --phase=schema
```

Attendu :

- Tables, index, contraintes `flow_type` plan_change présents
- RLS activé sur quotes + ledger
- `anon` / `authenticated` : SELECT/INSERT/UPDATE refusés sur quotes et ledger
- RPC `activate_commercial_plan_change` : EXECUTE refusé pour anon/authenticated
- `SECURITY DEFINER` + `search_path = public` sur la fonction
- Refus si Lucie/Liam détectés

---

## 4. Validation RPC / sécurité (manuelle + script)

### 4.1 SECURITY DEFINER — checklist code (migration)

| Point | Attendu |
|-------|---------|
| `search_path` | `SET search_path = public` (ligne explicite) |
| Tables qualifiées | `public.commercial_plan_change_quotes`, etc. |
| Pas de `client_id` navigateur | RPC lit quote par `p_quote_id` + revalide ownership via quote row |
| Paiement | `amount_due_cents > 0` → `payment_required` sauf `p_simulated_activation=true` |
| Quote stale | `source_revision` mismatch → `quote_stale`, pas de mutation entitlement |
| Crédit | Balance ledger recalculée vs `existing_customer_credit_cents` |

### 4.2 Tests paiement

| Cas | Action | Attendu |
|-----|--------|---------|
| Upsell (`amount_due_cents > 0`) | RPC sans `p_simulated_activation` | `{ ok: false, code: 'payment_required' }` |
| Upsell simulé | RPC avec `p_simulated_activation=true` + allowlist serveur | activation OK, `payment_status = simulated_confirmed` |
| Downsell (`amount_due_cents = 0`) | RPC direct | activation OK, `payment_status = not_required` |
| Falsification navigateur | PATCH quote `payment_status = confirmed` via anon | refusé (RLS) |

### 4.3 Concurrence

Prérequis : 2 quotes `quote_pending` valides, même `source_entitlement_id`, idempotency keys différentes.

```bash
node scripts/validate-plan-change-db-integration.mjs --phase=concurrency \
  --quote-a=<uuid> --quote-b=<uuid> --key-a=... --key-b=...
```

Attendu :

- 1 activation `ok: true`
- 1 activation `quote_stale` ou `idempotency_conflict` ou `quote_not_pending`
- 1 seul entitlement actif workspace
- 1 seule ligne audit `plan_change_activated`
- Ledger : pas de double débit, `balance_after_cents >= 0`

### 4.4 Retry idempotent

Même quote + même `p_idempotency_key` × 2 :

- 2e appel : `idempotent_replay: true`
- 1 seule transition `quote_pending → quote_activated`
- 1 audit, N ledger entries inchangé

```bash
node scripts/validate-plan-change-db-integration.mjs --phase=idempotency \
  --quote-id=<uuid> --idempotency-key=...
```

---

## 5. E2E — second workspace test (après schema OK)

**Uniquement** après sections 3–4 validées.

### 5.1 Créer le workspace

1. App Next.js pointée vers `PLAN_CHANGE_TEST_*` (pas `.env.local` partagé).
2. Checkout simulation premier compte → email allowlist test.
3. Noter `client_id`, `entitlement_id`, `checkout_session_id`, `period_end_at`.

### 5.2 Scénarios E2E

| # | Scénario | Preuve à capturer |
|---|----------|-------------------|
| 1 | Upsell Growth → Pro (montant dû > 0, simulé) | quote row + session `plan_change` + dashboard pack Pro |
| 2 | Downsell Pro → Growth (avoir) | ledger crédit + `amount_due_cents = 0` |
| 3 | Changement successif même période | 2e prorata sur `active_commercial_period_value_cents`, **pas** `total_period_cents` du 1er change |
| 4 | Crédit antérieur | balance ledger appliquée |
| 5 | Quote expiré | RPC → `quote_expired`, pas de mutation |
| 6 | Quote stale (modifier entitlement entre quote et activate) | `quote_stale` |
| 7 | Downsell capacité insuffisante | API quote → erreur capacity |
| 8 | Source entitlement ambiguë | API → `source_ambiguous_entitlement` |
| 9 | Dashboard client-safe | pack label commercial, échéance inchangée |

### 5.3 Changement successif — preuve comptable

Après upsell #1 avec cash collecté < valeur commerciale :

```sql
SELECT
  metadata->>'commercial_period_value_cents' AS commercial_value,
  total_period_cents AS cash_collected,
  flow_type
FROM commercial_checkout_sessions
WHERE client_id = '<test_client>'
ORDER BY activated_at;
```

Quote #2 doit utiliser `active_commercial_period_value_cents` = `pack_period_total_cents` / metadata commercial du session plan_change #1, **pas** `total_period_cents`.

---

## 6. Commandes interdites sur DB partagée

Ne **jamais** exécuter sur `zgafnshkjywfltxgbtzg` ou toute DB contenant Lucie/Liam :

- `supabase db push`
- SQL Editor apply migration plan change
- `node scripts/validate-plan-change-db-integration.mjs` avec URL partagée
- Activation plan change API/UI contre Lucie ou Liam

---

## 7. Rapport final (template)

```
## Identité DB test
- Project: ...
- Ref: ...
- Isolation: CONFIRMED / FAILED

## Migration
- 20260615143000: applied Y/N
- 20260621120000: applied Y/N

## RLS / grants
- anon quotes: DENIED Y/N
- authenticated ledger: DENIED Y/N
- RPC anon execute: DENIED Y/N
- service_role execute: ALLOWED Y/N

## SECURITY DEFINER
- search_path public: Y/N
- payment_required gate: Y/N
- stale revision gate: Y/N

## Concurrence / idempotency
- single winner: Y/N
- idempotent replay: Y/N
- ledger non-negative: Y/N

## E2E workspace test
- client_id: ...
- upsell/downsell/successive: PASS/FAIL
- dashboard pack: ...

## Lucie / Liam
- mutations: NONE (required)

## Verdict
GO / NO-GO manual plan change on test workspace
```

---

## 8. Déblocage

Pour passer **NO-GO → GO** :

1. Fournir project ref isolé + clés dans session shell dédiée.
2. Appliquer migrations prérequis + plan change sur ce projet seul.
3. Exécuter `validate-plan-change-db-integration.mjs --phase=schema`.
4. Créer workspace test via checkout sim.
5. Exécuter phases concurrency, idempotency, E2E.
6. Remplir le rapport final.
