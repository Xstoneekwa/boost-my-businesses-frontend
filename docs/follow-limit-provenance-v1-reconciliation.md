# Follow Limit Provenance V1 — production reconciliation dry-run

Mode: read-only SELECT. Snapshot date: 2026-07-22. No migration, RPC, INSERT,
UPDATE, DELETE, backfill or runtime action was executed.

| Account | Package | Package caps | Legacy values | Admin audit match | Classification | Proposed action |
|---|---|---:|---:|---|---|---|
| `j_automatise_pour_toi` | Growth | 80/day · 80/session | 120/day · 20/session · 10/run | No | `package_seeded_legacy` | No override; use package defaults after rollout. |
| `i_m_your_traker` | Pro | 120/day · 120/session | 120/day · 20/session · 1/run | Yes — exact 120/20 event on 2026-07-18 | `explicit_override_confirmed` | Eligible for a future controlled 120/20 backfill. |
| `mythyl_fitness` | Pro | 120/day · 120/session | 120/day · 40/session · 10/run | Yes — exact 120/40 event on 2026-07-20 | `explicit_override_confirmed` | Eligible for a future controlled 120/40 backfill. |

The current production value for `i_m_your_traker.max_follow_per_run` is `1`,
not the older audited snapshot value `10`. This per-run legacy field is not an
input to the V1 business resolver and is not proposed for backfill.

Three additional active, explicitly test-named recovery accounts have neither
an effective package nor an `ig_account_settings` row:
`p3_2_admin_recovery_test`, `p3_2_botapp_recovery_test`, and
`p3_internal_recovery_test`. They are `ambiguous_manual_review` for this
contract, with no automatic backfill. No `override_above_package` account was
identified in the read-only snapshot.
