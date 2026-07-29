# Target Availability writers — V2-1 dormant

Two writers are deliberately separate.

The Worker writer owns only `ct_target_availability_observations`. A bounded in-memory queue and daemon flush keep PostgREST off the action path. Inserts use the existing `(tenant_id, account_id, idempotency_key)` uniqueness contract, `resolution=ignore-duplicates`, a 1.5 s default timeout, at most one retry and a circuit breaker. Queue saturation, timeout or exception increments metrics and fails open.

Alternatives reviewed: direct synchronous writes would block the Golden Flow; a sidecar adds release/process coordination; a durable local outbox adds disk lifecycle and replay risk. The bounded buffer is the smallest dormant option. It starts only when capture and writer are both ON.

The Backend writer owns only `ct_target_identity_history`, `ct_target_identity_current`, `ct_target_availability_assessments` and `ct_target_availability_current`. History inserts are idempotent. Current projections use optimistic compare-and-swap and reject stale assessments. The Supabase adapter is implemented but has no route, cron or production caller.

Both paths require service-role credentials. Existing forced RLS and grants remain the database authority. No new migration is required.
