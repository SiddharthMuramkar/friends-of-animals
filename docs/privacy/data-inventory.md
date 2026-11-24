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

A directory listing (#127) can be an individual rescuer's or foster caregiver's own,
so its name, slug, description, place and contacts are personal data. Its address,
phone and email are encrypted; city, state and pin code stay plain because the
public page shows them. The policy `directoryListings` keeps it while it is in the
directory (no daily job yet, HR-31). Its documents are files of purpose
`directory_document`, which only staff open.

An adoption listing (#129) is about an animal, so its details are not personal data,
but its state, city and pin code say where an individual foster caregiver lives; those
and the representative who wrote it are listed under `directoryListings`, because an
adoption listing lives and goes with its directory listing. Its photos are files of
purpose `adoption_photo`; only their resized copies are ever public.

Announcement inbox titles and bodies are encrypted. Their retention period is
365 days after the recipient reads the message (HR-31, pending confirmation).

## Breach log

A breach's title, impact, authority reference and timeline notes are
encrypted, because they can name the people affected. The catalogue also
lists who leads the response, who wrote each timeline entry, who was told,
and the accounts and child profiles a notice couldn't reach. All of it is
kept while the breach is open and for 5 years after it closes, then deleted
with the breach (HR-31, pending confirmation).

## Volunteer applications

A volunteer application holds the applicant's date of birth (encrypted,
copied from their participant profile when they have one), the areas they
offered and when they are free, the guardian who approved a 14- to
17-year-old's application, the consent events behind the two declarations,
and the community manager who decided, with a decline reason (encrypted).
An application declined or withdrawn is deleted 365 days after it closes
(`volunteerApplications`); an approved one stays while the person volunteers
(HR-31, HR-55, pending confirmation).

## Scheduled retention

The worker runs the retention sweep
([`sweep.ts`](../../src/server/modules/privacy/sweep.ts)) at 02:15 IST over
the policy registry in
[`policies/`](../../src/server/modules/privacy/policies/index.ts). Every
entry's `retention.policy` names either a swept policy or a lifecycle policy
that the data follows instead. The sweep starts in dry-run mode and records
counts per policy in the audit log, never personal data. A super admin can
change the timed periods and turn on enforcement (`retention.enforce`) in
`/admin/settings` after counsel confirms them. Statutory floors and legal
holds still apply.

A super admin places a legal hold on an account, a participant profile or an
institution from `/admin/privacy`, with a fresh second factor. While a hold
is in force the sweep keeps every record about that subject and counts it as
held. Closed contact messages default to 24 calendar months, and quarantined
uploads and their objects default to 30 days after quarantine. A payment's
proof is never purged: `offline_payment.proof_file_asset_id` stays required,
so a quarantined proof is kept with its payment record. Payment records are
anonymised, not deleted, after the 8-year financial floor.

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
