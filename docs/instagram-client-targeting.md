# Instagram Client — Targeting metrics display

Status: active tenant-scoped read contract.

The Client Targeting drawer reads
`GET /api/instagram-client/accounts/:accountId/targets`. The route requires a
client Instagram session, verifies ownership of `accountId`, rejects technical
client fields and delegates projection to the shared Targets service.

The complete shared field and parity contract is documented in
[`target-metrics-contract.md`](./target-metrics-contract.md).

## Client-safe display rules

- Added is always `ig_targets.created_at` through the shared `created_at` /
  `added_at` projection.
- Sent preserves absence: `null` or missing → `—`; numeric `0` → `0`; a known
  positive number → that number.
- Perf uses server-projected `performance_status`. The drawer localizes it but
  never recalculates thresholds.
- `pending` and `insufficient_data` are distinct. Insufficient data means fewer
  than 100 attributed follows, not poor performance.
- FBR uses `followbacks_metrics_reliable_at` as the coverage certificate. An
  unreliable raw zero is shown as data pending/not measured, never `0%`.
- Last used remains sourced from `last_used_at`.

French Perf labels: `En attente de mesure`, `Données insuffisantes`,
`Non applicable`, `Faible`, `Moyenne`, `Bonne`.

English Perf labels: `Pending measurement`, `Insufficient data`,
`Not applicable`, `Low`, `Average`, `Good`.

The help copy may explain the 100-follow minimum sample. It must not reveal raw
provider payloads, account-internal metadata or cross-tenant data.

## Validation boundary

Client tests cover null versus zero Sent, every localized Perf status, tenant
session and account ownership, shared-service delegation, and absence of
account-specific fixtures in the live drawer.
