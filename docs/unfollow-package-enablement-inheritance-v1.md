# Unfollow package enablement inheritance V1

`ig_account_unfollow_settings.unfollow_enabled` is the Worker-readable effective
materialization. It is not an independent capability flag.

The canonical inputs are:

1. the active package capability from `account_package_summary.package_caps`;
2. an optional explicit human decision in
   `ig_account_unfollow_enablement_overrides`.

No override row means package inheritance. If the active package supports both
an Unfollow daily cap and session cap greater than zero, the effective value is
enabled. An explicit false disables Unfollow. An explicit true cannot grant a
capability absent from the active package.

Runtime blocks, candidate availability, daily-plan eligibility and phase
executability remain separate gates. They must never be encoded as an
enablement override.

The Instagram dashboard writes an explicit override only when the operator
changes `unfollow_enabled`. Package assignment, provisioning, upgrade,
downgrade, cancellation and reactivation call the generic package reconciler.
Provisioning must not force Unfollow off after package resolution.

The legacy `ig_account_settings.unfollow_enabled` field is a synchronized
compatibility mirror only. It is not authoritative and cannot override the
domain materialization.

This contract does not modify caps, `unfollow_after_days`, candidate backlog,
receipts, schedules, SAST windows or Auto Restart behavior.
