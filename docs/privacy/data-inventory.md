# Data inventory

FOA keeps a list of every database column that holds personal data, with
what it is kept for and for how long. Staff admins and super admins can
read the catalogue at `/admin/privacy` after passing their second factor.

The list lives in
[`inventory.ts`](../../src/server/modules/privacy/inventory.ts), which
includes the [contact inbox entries](../../src/server/modules/contact/inventory.ts).
The [coverage test](../../src/server/modules/privacy/inventory.test.ts)
checks the full schema. Each column needs either a catalogue entry or an
explicit entry in [`non-personal.ts`](../../src/server/modules/privacy/non-personal.ts).
The test also checks that each column built with `encryptedText()` is
listed and named with the `_ciphertext` suffix.

## Adding a column

A ticket that adds a column holding personal data adds one entry to
the catalogue and a purpose message keyed by table and column in
[`adminPrivacy.json`](../../messages/en-IN/adminPrivacy.json) in the same pull request.
The catalogue and staff page both read the purpose from that message.

- `table` and `column` give the names as Postgres has them.
- `category` and `purpose` describe what the field holds and what FOA uses it for.
- `subject.kind` and `subject.via` describe whose data it is and how the field links to them.
  Add a staff-facing label in `subjectKinds` for a new kind. In a compound path,
  `entity_type` selects the record that `entity_id` identifies, and the invitation `kind`
  distinguishes an invited teen from a requested guardian found by `contact_hash`.
  A guardian contact recorded during school enrolment is identified by the
  contact fields on the participant's profile.
- `retention.policy`, `retention.period` and `retention.basis` identify the policy key,
  the default period and why FOA keeps the field that long.
- `retention.toConfirm` is `true` while the period awaits counsel confirmation (HR-31).
- `onExpiry` describes the intended treatment at expiry.

Staff-written reasons for institution decisions and payment reviews, as well as refund
decision notes, belong in the catalogue. An assigned participant age group and
the safeguarding reporter's child indicator are demographic data.

Ledger descriptions and line memos may name counterparties. Finance authorship
stays with the append-only journal. Ledger category names and public labels may
also name people.

Encrypt a column with `encryptedText()` when it identifies a person directly,
such as a phone number, personal email address or date of birth. An institution's
own office contact details are stored plain and listed in the catalogue.

## Competition entry data

The proposed entry retention periods are three years after the competition
ends for entry text, participant references and upload history, and 90 days
after it ends for the private originals and their metadata-stripped copies.
This gives FOA time to process and review the work, handle appeals, and answer
later questions about the entry. Counsel confirms these defaults under HR-31.

Notices reference an upload attempt by its ID. The submitted attempt stores
the adult participant's original title so receipt retries still describe
the work that was submitted. Failure notices use the Entry ID and upload
reference.

Pending replacement text is cleared when the image passes, fails or is
superseded. Upload grants and unused staged objects are cleared by the worker
after the 10-minute upload URL expires. A separate worker delivery checks the
same staging key again an hour after expiry to clear bytes from in-flight PUTs.
