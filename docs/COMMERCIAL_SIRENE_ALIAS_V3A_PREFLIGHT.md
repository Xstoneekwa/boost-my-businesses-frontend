# Sirene aliases V3A — preflight

2026-09-28. Scope: four existing MEDIUM establishments in run `7243d1fe-1554-4cf5-ba07-2c6ad07d731d`, in the authorized order. The eleven LOW are not processed. Google, SearchAPI, websites, Instagram, AI, scoring, leads, messages, approvals and delivery are absent from the execution path.

## Schema gate

Mapping source: [official INSEE Sirene 3.11 OpenAPI](https://api-apimanager.insee.fr/portal/environments/DEFAULT/apis/2ba0e549-5587-3ef1-9082-99cd865de66f/pages/6548510e-c3e1-3099-be96-6edf02870699/content), read before mapping. Endpoint `/siret/{siret}`, envelope `header` + `etablissement`, current period exactly one `dateFin=null`, `uniteLegale` nested on establishment. Mappings remain PROVISIONAL until live call 1 passes.

User clarification authorizes mapping locally from this schema, then a first-call schema check AFTER all implementation and deployment gates. That call consumes one of four, not an extra verification request. The parser checks HTTP/endpoint at the server transport boundary, exact SIRET, nesting, current-period selection, required eligibility fields and mapped nullable name fields. Missing optional names/null are explicitly supported; unexpected types or ambiguous periods throw a path-only error. No raw response is logged, stored or returned. Schema and eligibility precede alias extraction/persistence for every candidate, not only the first.

The exact endpoint is implemented by the server-only `SireneExactProvider`, extending the existing provider without modifying Discovery. No redirect, retry, pagination or search. Credentials are header-only, read server-side. A single owner UI control invokes the fixed diagnostic; it disappears once the ledger exists (including failure), and disables locally after submission. It never exposes arbitrary SIRET entry.

## Data and authorization

Canonical owner guard is unchanged: authenticated + superadmin + active `commercial_crm_access`. The route accepts only a fixed authorization key, no browser-selected SIRET. The invoker RPC also requires service_role and the existing authorized-actor predicate. Anonymous/authenticated DB roles have no EXECUTE grant. Existing private ledger RLS remains unchanged.

The RPC atomically reserves a single-use execution and each sequential call. Call 2 cannot be reserved before call 1's schema PASS. A schema/transport error is terminal. Reservations are not reclaimed or retried. Inputs must match the existing cohort and frozen item/business hashes. A separate TypeScript boundary checks the exact four item/business/SIRET tuples.

Only `commercial_structured_run_state.summary.alias_v3a` receives versioned observations. No discovery item, business, lead, source snapshot or V1/V2 resolver result is updated. Each recorded observation can be written once. Eligible aliases preserve original values and each field occurrence; normalized grouping is comparison-only and retains every provenance. Sign lines are never concatenated or interpreted as separate brands automatically. The shared UI renders a collapsed alias section only for items with successful observations; no resolver/scoring input is replaced.

## Pre-live verification

- 131 focused tests PASS: aliases, schema, exact transport, first-failure STOP, access matrix, SA query/scoring/outreach regression and actual server-rendered UI.
- PostgreSQL isolated test suite PASS, including RPC grants, ordinary-admin denial, one-shot execution, sequential reservations, schema-failure freeze, restricted aliases rejected, raw payload denied, no overwrite, cap=4, item/confidence hashes preserved. Logs: `/private/tmp/bmb-structured-poc-db.LZaYT5`.
- Local Next.js webpack build/TypeScript PASS. Scoped ESLint PASS. Diff check PASS.
- React review: optional serializable props only; no new effect, external UI call, authorization decision or stylesheet change. SA rendering without observations is identical.
- Production inspected before deployment: `dpl_FncaZhSMB6RRz2fyrKoBpPrmqnLb`, READY. No V3A execution existed at preflight.
- Build uses the pre-existing `package.json` webpack edit already present in the deployed baseline; that unrelated edit is preserved, not added to the scoped commit.
- Supabase security advisors contain pre-existing findings outside this change (including definer views, mutable search_path and disabled leaked-password protection). This migration introduces no view/table or security-definer function and explicitly fixes its search_path. No broad security remediation is included. [Advisor remediation guide](https://supabase.com/docs/guides/database/database-linter), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Baseline full-row hashes

| Scope | Rows | MD5 |
| --- | ---: | --- |
| Cohort items | 15 | 4bcc5f1e4e886ca584dc94409b2f0dbb |
| Cohort businesses | 15 | 474d4856e86ff938c4b09cb4245b27da |
| ZA businesses | 81 | e99f832004489408273a145e6b7a5836 |
| ZA leads | 81 | 626133db92e4527bf45083d920032d04 |
| ZA outreach | 73 | b4500c5e220f6c0edfe949f70e44e365 |

## Deployment/execution order

Scoped commit → apply tested additive function → verify grants → production-target artifact with skip-domain → READY and access-denial check → promote same artifact → owner route smoke test → exactly one owner POST → read-only results/hash checks → STOP. No POST retry if response is lost; inspect ledger instead.

This document does not certify LIVE_SCHEMA_VERIFICATION or DEPLOYMENT in advance. The final result report must supply actual outcomes.
