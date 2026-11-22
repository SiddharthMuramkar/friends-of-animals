# Data inventory

FOA keeps a list of every database column that holds personal data, with what
it is kept for and for how long. The list lives in code, in
[`src/server/modules/privacy/inventory.ts`](../../src/server/modules/privacy/inventory.ts),
so a test can check it against the schema:
[`inventory.test.ts`](../../src/server/modules/privacy/inventory.test.ts)
fails when an encrypted column (one whose name ends in `_ciphertext`) isn't
listed.

## Adding a column

A ticket that adds a column holding personal data adds one entry to
`DATA_INVENTORY` in the same pull request:

- `table` and `column`: the names as Postgres has them.
- `purpose`: what FOA uses it for, in one sentence.
- `retention.period` and `retention.basis`: how long it is kept, and why.
- `retention.toConfirm: true`: every period is a default until counsel
  confirms it (residue HR-31).

Encrypt a column with `encryptedText()` (`src/server/db/types/encrypted-text.ts`)
when it identifies a person directly: a phone number, a personal email address,
a date of birth. An institution's own address and office contact details are
stored plain, but still listed.

## What is listed so far

| Table                      | Columns                                                                                                                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user`                     | `name`, `email`, `phone_ciphertext`                                                                                                                                                                                                                                                            |
| `institution`              | `contact_email`, `contact_phone`, `principal_name`, `principal_email_ciphertext`, `principal_phone_ciphertext`, `created_by`, `verified_by`                                                                                                                                                    |
| `institution_invitation`   | `identifier_ciphertext`, `identifier_hash`, `token_ciphertext`, `invited_by_user_id`, `accepted_by_user_id`, `revoked_by_user_id`                                                                                                                                                              |
| `institution_registration` | `registered_by`                                                                                                                                                                                                                                                                                |
| `participant_profile`      | `full_name`, `dob_ciphertext`, `grade`, `student_ref`, `phone_ciphertext`, `email_ciphertext`, `guardian_name_ciphertext`, `guardian_relationship`, `guardian_phone_ciphertext`, `guardian_email_ciphertext`, `address_ciphertext`, `pin_code`, `city`, `state`, `identity_hash`, `created_by` |

Sessions, the audit log's IP addresses and the other early tables are listed
by the data inventory and retention ticket (#114), which also enforces
retention with scheduled jobs.
