# Target Availability V1 — Canonical DB Column Contract

Status: **candidate only — not deployed**  
Canonical source: `supabase/migrations/20260730123708_ct_target_availability_identity_assessment_current_v1.sql`

Gate 0 current-baseline reconciliation: Backend predecessor `bb253f02c49b2c953011fd028842cd9c713dc248`; Worker runtime predecessor `2ab324043e0ffdef99d0311eb2812726fde85bc1`. These provenance references do not alter the SQL contract. Every future production preflight must derive legacy row counts, migration order, collisions and fingerprints from the live database rather than treating an earlier snapshot as a constant.

The migration SQL is authoritative. The static Node contract derives its inventory directly from every `ADD COLUMN` clause and requires exactly 41 unique table/column pairs, split 7 + 8 + 14 + 12. The PostgreSQL contract verifies that the same 41 pairs exist after forward migration. Checkpoints and runbooks must agree with this derived result.

`Security` is `SR/RLS` for every row: the owning table retains RLS plus FORCE RLS, `public`/`anon`/`authenticated` receive no grant, and only the documented `service_role` privileges are restored. `Legacy` is `no` for every row: the production collision audit found none of these columns before migration. `Required=yes` and `Redundant=no` are the result of the field-by-field domain audit.

| Table | Column | Type | Nullability | Default | Purpose | Source contract | Identity | Assessment | Current | Required | Redundant | Legacy | Security | Index impact |
|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| `ct_target_identity_history` | `transition_type_v3` | `text` | nullable | none | Versioned identity transition state | `IdentityTransition.status` | yes | yes | no | yes | no | no | SR/RLS | none |
| `ct_target_identity_history` | `evidence_count` | `integer` | not null | `1` | Evidence cardinality for the transition | `IdentityTransition.evidenceCount` | yes | yes | no | yes | no | no | SR/RLS | none |
| `ct_target_identity_history` | `first_observed_at` | `timestamptz` | nullable | none | Start of supporting evidence window | `IdentityTransition.firstObservedAt` | yes | yes | no | yes | no | no | SR/RLS | none |
| `ct_target_identity_history` | `last_observed_at` | `timestamptz` | nullable | none | End of supporting evidence window | `IdentityTransition.lastObservedAt` | yes | yes | no | yes | no | no | SR/RLS | tenant/account/target/time partial index |
| `ct_target_identity_history` | `source_observation_ids` | `uuid[]` | not null | empty array | Deterministic evidence lineage | `IdentityTransition.sourceObservationIds` | yes | yes | no | yes | no | no | SR/RLS | none |
| `ct_target_identity_history` | `rule_version` | `text` | nullable | none | Identity rule provenance | `IdentityTransition.ruleVersion` | yes | yes | no | yes | no | no | SR/RLS | none |
| `ct_target_identity_history` | `engine_version` | `text` | nullable | none | Identity engine provenance | `IdentityTransition.engineVersion` | yes | yes | no | yes | no | no | SR/RLS | none |
| `ct_target_identity_current` | `observed_username` | `text` | nullable | none | Latest normalized observed username | `IdentityCurrent.observedUsername` | yes | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_identity_current` | `domain_identity_status` | `text` | nullable | none | Versioned identity state beside legacy projection | `IdentityCurrent.status` | yes | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_identity_current` | `evidence_count` | `integer` | not null | `0` | Current identity evidence cardinality | `IdentityCurrent.evidenceCount` | yes | yes | no | yes | no | no | SR/RLS | none |
| `ct_target_identity_current` | `first_seen_at` | `timestamptz` | nullable | none | Earliest evidence retained in current identity | `IdentityCurrent.firstSeenAt` | yes | yes | no | yes | no | no | SR/RLS | none |
| `ct_target_identity_current` | `last_seen_at` | `timestamptz` | nullable | none | Latest evidence retained in current identity | `IdentityCurrent.lastSeenAt` | yes | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_identity_current` | `last_confirmed_at` | `timestamptz` | nullable | none | Latest positive identity confirmation | `IdentityCurrent.lastConfirmedAt` | yes | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_identity_current` | `stale_after` | `timestamptz` | nullable | none | Identity freshness boundary | `IdentityCurrent.staleAfter` | yes | yes | yes | yes | no | no | SR/RLS | partial stale-time index |
| `ct_target_identity_current` | `source_version` | `text` | nullable | none | Source engine/rule provenance | `IdentityCurrent.sourceVersion` | yes | yes | no | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `assessment_status_v3` | `text` | nullable | none | Pure versioned Availability result | `AvailabilityAssessment.status` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `identity_status_v3` | `text` | nullable | none | Identity state used by assessment | `AvailabilityAssessment.identityStatus` | yes | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `contributing_observation_ids` | `uuid[]` | not null | empty array | Accepted evidence lineage | `AvailabilityAssessment.contributingObservationIds` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `ignored_observation_ids` | `uuid[]` | not null | empty array | Rejected/ignored evidence lineage | `AvailabilityAssessment.ignoredObservationIds` | no | yes | no | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `repeat_count` | `integer` | not null | `0` | Repetition threshold evidence | `AvailabilityAssessment.repeatCount` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `rule_version` | `text` | nullable | none | Assessment rule provenance | `AvailabilityAssessment.ruleVersion` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `engine_version` | `text` | nullable | none | Assessment engine provenance | `AvailabilityAssessment.engineVersion` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `engine_revision` | `integer` | nullable | none | Monotonic engine compatibility revision | `AvailabilityAssessment.engineRevision` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `policy_revision` | `integer` | nullable | none | Monotonic policy compatibility revision | `AvailabilityAssessment.policyRevision` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `first_evidence_at` | `timestamptz` | nullable | none | Assessment evidence-window start | `AvailabilityAssessment.firstEvidenceAt` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `last_evidence_at` | `timestamptz` | nullable | none | Assessment evidence-window end | `AvailabilityAssessment.lastEvidenceAt` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `valid_until` | `timestamptz` | nullable | none | Assessment expiry | `AvailabilityAssessment.validUntil` | no | yes | yes | yes | no | no | SR/RLS | partial validity index |
| `ct_target_availability_assessments` | `explanation_safe` | `jsonb` | not null | empty object | Structured redacted explanation | `AvailabilityAssessment.explanationSafe` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_assessments` | `missing_evidence` | `text[]` | not null | empty array | Explicit confirmation gaps | `AvailabilityAssessment.missingEvidence` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `availability_status` | `text` | nullable | none | Latest pure Availability state | `AvailabilityCurrent.status` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `confidence` | `text` | nullable | none | Latest qualitative confidence | `AvailabilityCurrent.confidence` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `identity_status` | `text` | nullable | none | Identity state accompanying projection | `AvailabilityCurrent.identityStatus` | yes | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `latest_observation_at` | `timestamptz` | nullable | none | Ordering/freshness anchor | `AvailabilityCurrent.latestObservationAt` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `confirmed_at` | `timestamptz` | nullable | none | Latest high-confidence confirmation | `AvailabilityCurrent.confirmedAt` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `valid_until` | `timestamptz` | nullable | none | Projection validity boundary | `AvailabilityCurrent.validUntil` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `stale_after` | `timestamptz` | nullable | none | Projection staleness boundary | `AvailabilityCurrent.staleAfter` | no | yes | yes | yes | no | no | SR/RLS | partial stale-time index |
| `ct_target_availability_current` | `reason_codes` | `text[]` | not null | empty array | Deterministic explanatory codes | `AvailabilityCurrent.reasonCodes` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `engine_version` | `text` | nullable | none | Projection engine provenance | `AvailabilityCurrent.engineVersion` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `policy_version` | `text` | nullable | none | Projection policy provenance | `AvailabilityCurrent.policyVersion` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `engine_revision` | `integer` | nullable | none | Reject engine-version regression | `AvailabilityCurrent.engineRevision` | no | yes | yes | yes | no | no | SR/RLS | none |
| `ct_target_availability_current` | `policy_revision` | `integer` | nullable | none | Reject policy-version regression | `AvailabilityCurrent.policyRevision` | no | yes | yes | yes | no | no | SR/RLS | none |

## Why the previous contract said 37

All 41 columns entered together in commit `10c3b40294b6a9ff0e6d22ea4491278bdcf7ff00`. The earlier PostgreSQL contract's explicit list stopped at `ct_target_availability_current.reason_codes` and accidentally omitted these four already-present columns:

| Column | Introduction | Real use | Test | Decision |
|---|---|---|---|---|
| `engine_version` | `10c3b40` | `current-projection.ts` copies assessment engine provenance | static 41-column contract + current projection suite + SQL round-trip | required |
| `policy_version` | `10c3b40` | `current-projection.ts` records the canonical policy version | static 41-column contract + current projection suite + SQL round-trip | required |
| `engine_revision` | `10c3b40` | current projection rejects an older engine revision | version-regression unit test + SQL `engine_revision = 3` assertion | required |
| `policy_revision` | `10c3b40` | current projection rejects an older policy revision | version-regression unit test + SQL round-trip | required |

The discrepancy is documentary/test drift, not a later SQL expansion. No column is removed, the migration content and version remain unchanged, and 41 is the canonical count.

## Consistency rule

`SQL artifact = derived static test = PostgreSQL contract = checkpoint = deployment runbook = rollback assumptions`.

Any future SQL column change must update the PostgreSQL pair inventory and this audit in the same commit. The static test will fail automatically if the SQL count or rollback coverage diverges.
