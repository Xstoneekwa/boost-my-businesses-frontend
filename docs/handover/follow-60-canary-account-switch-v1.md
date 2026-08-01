# Follow 60 account-switch handover

Use `docs/follow-60-canary-account-switch.md` as the canonical runbook.

Current handover boundary:

- generic SQL/Worker source may be committed and pushed;
- production migration and control mutation are not authorized;
- the active Worker/runtime must remain unchanged;
- J must not be armed by this source-only delivery;
- Liam alone performs the later manual-to-scheduled transition;
- the run must originate from the natural scheduler tick.

Required terminal marker for this handover:

`READY_FOR_EXPLICIT_J_RUNTIME_ACTIVATION_GO=YES`

