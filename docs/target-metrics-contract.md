# Targets metrics contract — BotApp, Admin and Client

Status: **canonical display/projection contract** as of 2026-07-23.

This contract describes shared meaning. Audience-specific labels may differ, but
the three surfaces must not reinterpret missing values as real zeroes.

## Source of truth and read paths

`ig_targets` is the source of truth for the fields in this document.

- BotApp: `TargetsDrawer` → IPC `botapp:profiles:details` → relay
  `/api/instagram-dashboard/profiles/:account_id/details` → Profile Details
  projection → `ig_targets`.
- Admin: `GET /api/instagram-dashboard/targets?account_id=...` → shared Targets
  service → `ig_targets`.
- Client: `GET /api/instagram-client/accounts/:accountId/targets` → tenant
  session + ownership check → shared Targets service → `ig_targets`.

No renderer receives provider credentials, raw discovery payloads or privileged
Supabase configuration.

## Field semantics

| Meaning | Canonical field | Contract |
|---|---|---|
| Added | `ig_targets.created_at` | Immutable creation date. `updated_at` must never be used as Added. Profile Details exposes both `created_at` and client-safe `added_at`, with `added_at = created_at`. Missing value stays unknown. |
| Sent | `ig_targets.follows_sent_count` | Real follows attributed to the target. `null` means unknown and renders `—`; reliable `0` renders `0`. |
| Performance | projected `performance_status` | Derived from eligibility, Sent volume and reliable FBR. Display layers localize the status but do not recalculate it. |
| FBR coverage | `followbacks_metrics_reliable_at` | Non-null certifies that `followbacks_count`, including a true zero, is measurable. Null means not measured; a stored raw zero is not enough. |
| Last used | `ig_targets.last_used_at` | Operational use date, independent from Added. |

## Performance status

The current product threshold is `PERF_MIN_SAMPLE = 100` follows sent from the
target. It is unchanged by the UI parity patch.

| Source state | `performance_status` | Meaning |
|---|---|---|
| Target not eligible | `not_applicable` | Performance does not apply. |
| No follows sent, or Sent unknown | `pending` | Waiting for measurement. |
| 1 to 99 follows sent | `insufficient_data` | Sample is too small; this is not poor performance. |
| 100+ follows, FBR coverage not reliable | `pending` | Sufficient volume, measurement still unavailable. |
| 100+ follows, reliable FBR <= 8% | `bad` | Low performance badge. |
| 100+ follows, reliable FBR > 8% and < 15% | `avg` | Average performance badge. |
| 100+ follows, reliable FBR >= 15% | `good` | Good performance badge. |

Client labels are localized as follows:

| Status | French | English |
|---|---|---|
| `pending` | En attente de mesure | Pending measurement |
| `insufficient_data` | Données insuffisantes | Insufficient data |
| `not_applicable` | Non applicable | Not applicable |
| `bad` | Faible | Low |
| `avg` | Moyenne | Average |
| `good` | Bonne | Good |

Client help text may state that performance becomes measurable after 100
follows sent from the target. It must not expose internal metadata.

## FBR reliability

- `followbacks_metrics_reliable_at = null` plus raw `0` → **Not measured** /
  **Non mesuré** / **Données en cours**, never `0%`.
- Reliable coverage plus zero followbacks → `0%`.
- Reliable coverage plus a positive value → the real percentage.
- A reliable FBR may be displayed before 100 follows. The 100-follow threshold
  gates the performance verdict, not visibility of certified FBR.

The thresholds intentionally differ at the boundary:

- performance badge `bad`: FBR **<= 8%**;
- automatic archive: FBR **< 8%** (strict), with the other policy gates.

Do not merge these rules without a separate product decision.

## Cross-surface parity matrix

| Source state | BotApp | Admin | Client |
|---|---|---|---|
| Perf pending | Pending | Pending | En attente de mesure / Pending measurement |
| Perf insufficient | Insufficient | Insufficient data | Données insuffisantes / Insufficient data |
| FBR unreliable | Not measured | Non mesuré | Données en cours / Not measured |
| FBR reliable zero | 0% | 0% | 0% |
| Sent null | — | — | — |
| Sent zero | 0 | 0 | 0 |
| Added | `created_at` | `created_at` | `created_at` |

## Null and zero invariant

`null` is an absence of certified information. It must remain visible as `—`,
`Not measured`, `Non mesuré` or equivalent audience-safe copy. A numeric zero
is displayed only when the source field is actually numeric and, for FBR, the
coverage timestamp certifies the metric.

## Non-regression boundary

This contract does not change Worker behavior, target attribution, counters,
Perf/FBR formulas, eligibility, auto-archive, tables, RPCs or account settings.
No migration is required.
