---
Status: proposed
---

# Consent is an event log that points at immutable versions

Every give and every withdrawal of consent is one `consent_event` row: whose
consent, who gave it, the purpose, the exact document version, the method and
the time. The current state is the latest event for a subject and purpose.
Published `consent_document` versions never change (a trigger refuses UPDATE,
DELETE and TRUNCATE, for the migrator too), and giving consent is refused on
anything but the current version, so a consent always points at the text the
person saw. Guardian consent (#82) needs exactly this for each purpose: who
gave it, how, on which text, and the whole history.

## Considered options

- A record table with `withdrawn_at` and a partial unique index (one active
  consent per subject and purpose, enforced by the database). Withdrawing
  mutates the row, it needs extra columns for who withdrew and how, and
  consenting again loses history unless it adds rows, which is an event log
  in disguise.
- The event log plus a `consent_current` table updated in the same
  transaction. Cheap reads for gating, but two writes and a second invariant
  for every caller; add it once gallery-scale reads need it.

## Consequences

- Reading the state means "the latest event": a fold for one subject now, and
  `DISTINCT ON` in SQL when a module gates many records on consent.
- A form that asks for consent carries the version id it showed. If staff
  publish a new version meanwhile, nothing is recorded and the person sees the
  new text.
- `published_by_user_id` has no foreign key, as in the audit log: `ON DELETE
  SET NULL` would update a row the trigger protects.
- `consent_event` has no append-only trigger yet. Its `giver_user_id` is a
  foreign key with `ON DELETE SET NULL` (indexed, so deleting a user doesn't
  scan the log), so a trigger that refused every UPDATE would block deleting
  a user. Until then the audit log records every give and withdrawal. A
  trigger must allow exactly that change (`giver_user_id` to null, nothing
  else) and refuse DELETE and TRUNCATE, once FOA rules whether a person's
  consent history may ever be erased. #82 extends the log and adds it.
- Sign-up records its consent inside identity's account transaction, so
  `identity/create-account.ts` (an M0 foundation) imports this module's
  `recordSignUpConsent`, and `outbox/events.ts` imports its purpose and
  subject-type lists for the `consent.withdrawn` payload.
  Invert it (a sign-up hook, events registered by the module) if more
  modules need the same.
