# Brief 85b: Entries module and individual image submission

Issue #85 · M2 · branch `ticket/85-entries` · worktree `/root/foa-wt/85b` · base `foa/M0` 442dd99 · L · risk A K C
Blocked by 85a, 65, 81b (and through them 63a/b, 61a, 59a, 69, 70a, 71, 73, 78). **85a** owns derivatives, the media job,
derivative delivery and worker-media. This unit owns everything about Entries.
Head start on the branch: `src/server/modules/entries/domain/{status,submission,upload-rules}.ts` + tests (pure, green).

## Scope
**In:** the Entries module (H22, H23 and H26 owner).
- Tables `entry`, `entry_file` and `entry_transition`. Enums `entry_status` (all 9 values, F2), `entry_file_status` and
  `entry_file_kind` (`image | video | document | text`).
- Use cases: `startEntryUpload`, `completeEntryUpload`, the consumer `applyEntryFileOutcome`, `listMyEntries`, `getEntry`
  and the staff query `listCompetitionEntries`.
- Entry ID `{comp}-E-{6}` through #73's codes module.
- Messages `entry_received` (at `submitted`), `entry_file_rejected` and `entry_processing_failed`, guardian-routed per #81.
- Pages: list, new and detail (replace and retry), with the browser check. The `entries` namespace, the preview seed, the
  e2e spec and an ADR on enum values up front. GLOSSARY terms through `domain-modeling`.
- The `entry_image` file purpose, registered with 85a's media registry (`["thumb_320", "display_1600"]`).

**Out:** video and essay (86a/86b); coordinator submission (87); the shortlist and the school round (89+);
`submitted_to_foa` and FOA verification (92); the reminder (84b). Their transitions stay forbidden here.

## Acceptance checks
1. **Submit.** A confirmed adult participant runs `startEntryUpload`, a PUT to the storage fake, then
   `completeEntryUpload({ title, description, statement? })`. The entry is `processing` with a code matching
   `^[A-Z]{3,6}\d{2}-E-[0-9A-HJKMNP-TV-Z]{6}$`, and `listMyEntries` shows that code and status. *Seam 1.*
2. **Confirmed.** After `drain()` (scanner clean, media ok) the entry is `submitted`, with one `entry_received` message to the
   participant (or the guardian for a minor) and `submitted_at` set. *Seam 1.*
3. **Type and size, twice.** A wrong type or an over-limit size is refused at `startEntryUpload` (`wrong_type` /
   `too_large`). `completeEntryUpload` refuses again when storage's HEAD disagrees. The form uses the same `checkUpload` and
   `acceptAttribute`. *Seam 1 + unit (`upload-rules.test.ts`).*
4. **HEIC.** A HEIC declared with an empty type and a `.heic` name is accepted end to end. Its derivatives come from 85a.
   *Seam 1 (fake) + 85a's contract.*
5. **Hidden until clean.** While the entry is `processing`, `rejected` or `failed`, `listCompetitionEntries` (competition
   manager) leaves it out. An infected first file makes it `rejected`, and the participant gets `entry_file_rejected`
   naming the problem. *Seam 1.*
6. **Retry.** `rejected` or `failed`, then a new upload before the deadline, gives `processing` and then `submitted`. *Seam 1.*
7. **Pending replacement.** The entry stays `submitted`, and `getEntry` serves the old file's derivative until the new
   file is `live`. Then the old one is `superseded`. An infected or failed replacement keeps the old file live and tells the
   participant. A newer upload drops one still being checked. *Seam 1.*
8. **Deadline.** At `clock.set(submissionClosesAt)`, create, replace and retry are refused with `deadline_passed`. An upload
   completed before the deadline but processed after it still becomes `submitted`. *Seam 1.*
9. **One entry per registration.** A second upload for the same registration replaces the file. There is never a second
   row: unique `entry.registration_id`. *Seam 1.*
10. **Transition table.** Every pair over `(none) + 9` entry statuses and `(none) + 6` file statuses. *Unit (done).*
11. **Authz, per use case.** The participant on their own registration passes. A guardian for their ward passes. Another
    participant, a guardian of another child, a coordinator, a competition manager (on submit) and a visitor fail. An
    unconfirmed registration gives `registration_not_confirmed`. An institution-route registration is refused. *Seam 1.*
12. **Audit and history.** Each entry state change writes one `entry_transition` row and one audit row. *Seam 1.*
13. **Seed and pages.** The preview seed has an adult participant with `submitted`, `processing` and `rejected` entries.
    `tests/e2e/85-entries.spec.ts` runs `expectRendersAccessibly` (light and `.dark`) on the list, new and detail pages.
    *Seam 1 (seed test) + Seam 2.*

## Files
- New: `src/server/db/schema/entries.ts`; `src/server/modules/entries/{index.ts,rules.ts,events.ts,seed.ts,use-cases/*.ts}`
  (+ tests); `messages/en-IN/entries.json`; participant-dashboard pages `entries/`, `entries/new`, `entries/[code]` with
  `_components/` (file-input island) and `_lib/`; `tests/e2e/85-entries.spec.ts`;
  `docs/adr/NNNN-entry-status-values-up-front.md`; GLOSSARY entries.
- Touch (append-only): schema barrel (H1); `drizzle/` (H2): `85_pre_entry_image_purpose` only if #63's purpose is a pg
  enum (an add-value migration that nothing else in the PR references), then the generated `85_entries`. `src/server/app.ts`
  (one `composeUseCases` line); `src/server/seed/index.ts` (one seeder, H6); `can()` rules (H8, H31); the event-to-template
  map (H9); `src/i18n/messages.ts` (H3); `src/lib/app-routes.ts` + dashboard nav (H19); #78's registration row link (H26);
  #65's CSP registry: `connect-src` for the R2 origin, `img-src blob:` (H32, X4); 85a's media purpose registry (H21).
- Routes: use the participant dashboard path #78 landed (spec says `/participant`; the M2 file says `/dashboard`): check
  `src/lib/app-routes.ts` at claim. Guardians use the same pages, scoped to themselves and their wards.

## Design (risk-flagged: compared 2 ways, plus 2 smaller choices)
- **State model.** (A) **Chosen:** `entry` + `entry_file` (each with its own status) + an `entry_transition` history,
  with partial unique `entry_file (entry_id) WHERE status = 'live'`. A replacement checks out while the entry stays
  `submitted`. #91 (shortlisted entry with an upload in flight) and #92 (resubmission, history kept) slot in without schema
  change (F6). (B) One `entry` row with `current_file_asset_id` + `pending_file_asset_id`. Simpler today, but #91 and #92
  would force a migration on a shared enum and table (R2 hazard).
- **Rules live in pure functions.** `decideUpload` (create, retry, replace; window `[opensAt, closesAt)`; supersede in-flight
  uploads) and `decideFileOutcome` (idempotent: a late or duplicate outcome for a superseded or settled file is a no-op).
  Use cases load the snapshot, call these, and write the result in one transaction with `SELECT … FOR UPDATE` on the entry.
- **Upload flow.** `startEntryUpload` checks the rule and the window, then calls Files' presign with purpose `entry_image`.
  `completeEntryUpload` calls Files' complete (HEAD check) and creates or updates the entry. The text fields come at
  completion (no draft, per the owner).
- **File rules.** A code registry `rules.ts` keyed by #70's discipline, defaulting to `DEFAULT_IMAGE_RULE` (**chosen**), vs
  a `competition_entry_rule` table. That table would add schema with no screen to edit it. FOA's values go in via HR-37.

## Interface needs (adopt the real names at claim)
```ts
// 85a
type DerivativeKind = "thumb_320" | "display_1600";
function registerMediaPurpose(purpose: "entry_image", kinds: readonly DerivativeKind[]): void;
function getFileDerivativeUrl(ctx: UseCaseContext, i: { fileAssetId: string; kind: DerivativeKind }): Promise<{ url: string; expiresAt: Date }>;
type FileEvent = { type: "file.scanned"; aggregateId: string; payload: { result: "clean" | "infected" } }
  | { type: "file.processed"; aggregateId: string } | { type: "file.processing_failed"; aggregateId: string; payload: { code: string } };
// 63a
function presignUpload(ctx: UseCaseContext, i: { purpose: "entry_image"; contentType: string; sizeBytes: number; maxBytes: number })
  : Promise<{ fileAssetId: string; uploadUrl: string; headers: Record<string, string>; expiresAt: Date }>;
function completeUpload(ctx: UseCaseContext, i: { fileAssetId: string })
  : Promise<{ ok: true } | { ok: false; reason: "missing" | "size_mismatch" | "type_mismatch" }>;
// 61a: emit(tx, event) in the same transaction; registerConsumer("file.processed", handler); h.drain()
// 70a/71: competition { id; code: string; submissionOpensAt: Date; submissionClosesAt: Date; disciplines }
// 78/81b: registration { id; competitionId; participantProfileId; route: "individual" | "institution";
//   status: "pending_guardian" | "pending_payment" | "confirmed" | …; discipline; ageGroupId }
//   participant_profile { id; ownerKind: "self" | "guardian" | "institution"; ownerUserId: string | null; userId: string | null }
//   guardian_link { guardianId; participantProfileId; revokedAt: Date | null }
// 73: generateCode({ pattern: (r: string) => `${comp}-E-${r}`, length: 6, insert: (code) => Promise<T> }) // retries 23505
// 69: notify(tx, { template: "entry_received" | "entry_file_rejected" | "entry_processing_failed"; about: { participantProfileId }; data })
// 59a: can(actor, "entry.submit" | "entry.read" | "entry.list_competition", resource); audit.write(tx, …)
// 65: cspSources.add("connect-src", r2Origin); cspSources.add("img-src", "blob:")
```

## Residue
- **HR-37**: types and sizes (JPEG, PNG, WebP, HEIC, HEIF; 20 MB) are defaults. **HR-36**: entry message copy.
- **HR-14**: the SMS form of "entry received" stays off until DLT. **HR-31**: retention for the entry text fields,
  originals and derivatives. **HR-06, HR-08, HR-35**: a real upload reaches `submitted` on a preview only with the bucket,
  ClamAV and worker-media. **HR-28**: real-device check of the file picker (iOS HEIC).

## Test plan
- Unit (done): `domain/status.test.ts` (AC 10), `domain/submission.test.ts`, `domain/upload-rules.test.ts` (AC 3, browser half).
- Seam 1 (`createHarness`, storage, scanner, media and email fakes, `drain()`, fake clock), one file per slice below.
- Seam 2 (written, **not run**: no Postgres here and previews fail at `pnpm db:migrate`): `tests/e2e/85-entries.spec.ts`.
- **Not run:** Seam 2/axe, a real upload on a preview (HR-06/08/35), real iOS HEIC picking (HR-28).

## Slices
1. Schema, the create path (start + complete), Entry ID, `listMyEntries`, adult authz (`use-cases/submit-entry.test.ts`): ACs 1, 3, 9, 11a.
2. `applyEntryFileOutcome`: submitted, rejected and failed; staff visibility; messages; retry (`use-cases/entry-outcomes.test.ts`): ACs 2, 4, 5, 6, 12.
3. Pending replacement, deadline and idempotent outcomes (`use-cases/replace-entry-file.test.ts`): ACs 7, 8.
4. Guardian for a ward, unconfirmed and institution-route refusals, the other roles (`use-cases/entry-authz.test.ts`): AC 11.
5. Pages, browser check, CSP sources, seed, e2e spec, ADR, glossary (`seed.test.ts` + `tests/e2e/85-entries.spec.ts`): AC 13.
