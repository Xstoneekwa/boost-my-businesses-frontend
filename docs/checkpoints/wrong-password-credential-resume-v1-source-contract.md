# Wrong-password credential resume V1 — source contract

This source-only checkpoint defines the generic recovery contract for a proved
Instagram credential rejection. It does not apply the database migration,
deploy Backend code, start Auto Login, enqueue a run, or operate a phone.

## Canonical state flow

1. The Worker classifies only an explicit Instagram wrong-password surface as
   `instagram_wrong_password`.
2. Persistence exposes the client-safe reason `instagram_credentials_rejected`
   and the blocking action `update_instagram_password`; no secret is persisted
   in incident, action, log, or notification payloads.
3. The existing opaque credential writer creates the next monotonic credential
   revision, supersedes the previous active revision, and keeps exactly one
   active Instagram credential for the account.
4. Credential rotation is not login success. The action remains blocking while
   the new revision is unaccepted or the assigned-account identity proof is
   absent, stale, mismatched, or invalidated.
5. After a fresh authorized login-provisioning attempt, the Worker selects the
   single active highest credential revision. Only exact own-profile Identity
   Guard success plus accepted credential metadata permits the reconciliation
   RPC to resolve the password action.
6. Growth/readiness remains independently recomputed by the canonical runtime;
   this reconciliation never changes commercial, package, targets, schedule,
   assignment, or runtime state and never creates a run.

## Surface classification boundary

Explicit `Incorrect password` / `The password you entered is incorrect`
surfaces are credential rejection. Security-lock recovery, disconnected login
information recovery, generic account confirmation, Email/SMS/WhatsApp/
Authenticator challenges, and phone-call confirmation without an explicit
wrong-password banner remain distinct challenge or recovery states. If an
explicit wrong-password banner and a secondary recovery choice coexist, the
root cause remains credential rejection and the secondary surface is metadata
only.

## Security and inheritance

- No username, tenant, account, clone, package, or phone is hardcoded.
- The secret stays on the existing opaque writer/Vault path and is never read
  back by this reconciliation.
- The SQL function is `SECURITY DEFINER`, uses an empty `search_path`, and is
  executable only by `service_role`.
- Existing entitlement, subscription, account UUID, assignment, app instance,
  CT, protection lists, settings, schedule, and history are preserved.
- Present and future accounts inherit the same action and reconciliation path.

Production activation requires a separate migration/deployment GO and a fresh
operator-authorized Auto Login attempt.
