---
Status: accepted
---

# The audit log is append-only in the database, for everyone

`audit_log` refuses every UPDATE, DELETE and TRUNCATE with a trigger, so not
even the migrator or a bug in the app can rewrite who changed what; the same
migration also revokes those rights from every role but the table's owner. Use cases
write entries themselves (`recordAudit`) in the same transaction as the
change, rather than through generic row triggers: those would need per-session
actor settings, which PgBouncer's transaction mode doesn't keep, and would copy
whole rows, personal data included, into a table nobody can edit. Entries hold
ids and changed fields only.

## Consequences

- `actor_user_id` has no foreign key: `ON DELETE SET NULL` would update the
  log, which the trigger refuses, and so block deleting a user.
- Correcting or erasing an entry (a DPDP erasure request, a retention limit)
  needs the database owner to drop the triggers on purpose; FOA's retention
  rule is open (HR-30).
