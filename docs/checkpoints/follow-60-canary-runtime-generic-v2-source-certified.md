# Follow 60 generic runtime binder V2 — source checkpoint

- Parent Backend: `eabf52a2fb2efb3840b855008ab85c1f85908f0c`.
- Worker generic parent: `1f9c6d396357654557208ba3e3067cf532a05a8b`.
- Migration: `20260801123500_follow_60s_canary_runtime_generic_v2.sql`.
- Rollback: `20260801123500_follow_60s_canary_runtime_generic_v2.down.sql`.
- Procedure: `docs/follow-60-canary-account-switch.md`.
- Scope: source and disposable PostgreSQL only.
- Production DB apply: forbidden in this checkpoint.
- Runtime switch/restart/run/tick/ADB: forbidden in this checkpoint.

The forward RPC is account-neutral and the canonical control row is the sole
business selector. The predecessor signature is absent after forward migration.
The rollback contains the exact historical predecessor solely so rollback is
operable; it is not part of the forward runtime contract.

Activation remains blocked until a separate explicit runtime GO applies and
certifies the migration, re-captures an account-scoped baseline, proves gate
zero, switches the immutable Worker exactly once, and hands manual-to-scheduled
exclusively to Liam.

