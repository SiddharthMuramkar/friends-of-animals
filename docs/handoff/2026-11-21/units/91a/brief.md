# Brief 91a: shortlist-only scope (scope guard, coordinator-created entries, dual-condition promotion)

Unit 91a of #91 · M2 · L · risk K, PD · key X11 (`src/server/modules/school-round/**`, order 89b → 91a → 90) ·
branch `ticket/91-scope` · worktree `/root/foa-wt/91a` · base `foa/M0` 442dd99 · blocked by 89b, 92 (H22 merge order: 92
before 91a) and transitively 89a, 87, 85b, #70, #75, #69/#81, #59, 61a. **Head start on the branch: `156f783`.**
Sources: #91 body + owner decisions (2026-11-19), `issues-M2.md` §0.3 / §2.1 / §2.2 / §3 #91 / F2 / F6 / F13 / F15,
spec §1.9-§1.11, briefs 89a / 89b / 92 / 87.

## Scope
**In (91a):** the scope guard on uploads (school route + shortlist-only ⇒ no upload before the school round; individuals
unaffected); coordinator-created entries in the school round (`startShortlistedEntry` → upload → `completeShortlistedEntry`):
entry born `school_shortlisted` with an Entry ID, its `school_round_pick` row (position), its declarations; re-upload after
a failed file; the dual-condition promotion `school_shortlisted → submitted_to_foa` (file live **and** round finished); the
shortlist-only branch of 89b's finalise (registration-level "not shortlisted" message, no `not_shortlisted` rows); entry
transition row (none) → `school_shortlisted`; page `/institution/competitions/[ref]/school-round/entries/new` and the
created-entries list on 89a's round page; namespace `shortlistEntries`; preview seed; authz matrix.
**Out:** **91b** owns the milestone Seam 2 journey (both scopes), the preview phase control and the journey seed scenario.
89a/89b own picks, panel, attestation and finalise itself. #90 owns overdue / close on behalf / reopen (it calls our
promotion after close on behalf). 92 verifies promoted entries. 85b owns file rules, scan, media, Entry ID generation.

## Acceptance checks
1. Shortlist-only competition, school route: coordinator (87's branch) and any school-route self-submitter get
   `submission_not_open` from `startEntryUpload` before and during the window; no entry/file/audit row. An
   individual-route participant in the same competition uploads normally. All-participants behaviour unchanged (87's tests
   stay green). *Seam 1 + Vitest table (done: `digitalSubmissionPath`)*
2. SCHOOL_JUDGING, open round: coordinator `startShortlistedEntry({ roundId, registrationId, title, description, position,
   declarations, file })` returns a presigned upload; storage-fake PUT; `completeShortlistedEntry({ entryFileId })` → entry
   `school_shortlisted`, code `^[A-Z]{3,6}\d{2}-E-[0-9A-HJKMNP-TV-Z]{6}$`, pick row with the position, 4 `entry_declaration`
   rows with `SHORTLIST_ONLY_DECLARATIONS_VERSION`, file `processing`, history (none) → `school_shortlisted` by the
   coordinator. *Seam 1*
3. Refusals (nothing written): 6th entry in a category with shortlist size 5 → `shortlist_full` (at start, and re-checked at
   complete under the round lock); position out of range / taken; second entry for a registration → `entry_exists`;
   unconfirmed student → `registration_not_confirmed`; missing/unknown declaration → `declarations_invalid` with the keys;
   before the round → `submission_not_open`; finalised round → `round_not_editable`; all-participants competition →
   `not_shortlist_only`; individual-route registration → `forbidden`. *Seam 1*
4. While the round is open the entry stays `school_shortlisted` whether its file is processing, live or failed. Media fake
   failure → file `failed`, entry unchanged; coordinator uploads again → file live. *Seam 1*
5. Finalise (89b's `finaliseSchoolRound`, shortlist-only branch): entries with a live file → `submitted_to_foa` in the
   finalise transaction; an entry still processing stays `school_shortlisted` and moves when its file goes live (after
   `h.drain()`); zero `not_shortlisted` entry rows; panel / conduct / attestation blockers still apply. *Seam 1*
6. After `h.drain()`: each **confirmed** student without an entry gets `registration_not_shortlisted` exactly once (guardian
   for a minor, adult student directly, contact-only guardian by email, F13); shortlisted families get 89b's
   `entry_school_shortlisted`; unconfirmed students and minors themselves get nothing. One `school_round.shortlist_finalised`
   row whose payload adds `notShortlistedRegistrationIds`. *Seam 1 (FakeEmail, inbox)*
7. Idempotent promotion: redelivering the file-live event, or the event arriving after finalise already promoted, leaves one
   `school_shortlisted → submitted_to_foa` history row. *Seam 1*
8. Transition table (85b's `entries/status.test.ts`, H22): row (none) → `school_shortlisted` added; 89b's
   `school_shortlisted → submitted_to_foa` row annotated for the shortlist-only path; forbidden kept (`processing →
   school_shortlisted`, `not_shortlisted → submitted_to_foa`, …). *Vitest table*
9. Authz on `startShortlistedEntry`, `completeShortlistedEntry`: coordinator (and institution admin, 87's default) of the
   institution pass; another institution's coordinator, participant, guardian, competition manager → `forbidden`. *Seam 1*
10. New page + round-page list (status chip: waiting for upload / goes to FOA when you finalise / upload failed, upload
    again / submitted to FOA) render accessibly, light + dark, no scroll at 320 px. *Seam 2 `tests/e2e/91-shortlist-entries.spec.ts` (written, Not run)*
11. `h.seed.preview()` twice: one shortlist-only competition in SCHOOL_JUDGING, open round, one created entry live, one
    waiting. *Seam 1*

## Files and hotspots
- Head start (committed `156f783`): `src/server/modules/school-round/domain/shortlist-only.{ts,test.ts}` (35 cases).
- New: `src/server/modules/school-round/{start-shortlisted-entry,complete-shortlisted-entry,promote-shortlist-only-entry}.ts`
  + `shortlist-only-{create,promote,finalise}.test.ts`; `src/server/db/schema/entry-declaration.ts` (+ barrel line, H1);
  migration `--name 91_shortlist_only` (H2); `messages/en-IN/shortlistEntries.json` (+3 lines `messages.ts`, H3); template
  `registration_not_shortlisted` (email, in-app, SMS short form; H9); `src/app/institution/competitions/[ref]/school-round/
  entries/new/{page.tsx,actions.ts,_components/*}`; `tests/e2e/91-shortlist-entries.spec.ts`.
- Edits (serialize): 85b `startEntryUpload` guard → `digitalSubmissionPath` (H23); 87's `forbidden_by_scope` branch → same
  call, map to `submission_not_open`; 89b `planFinalisation` gains `scope`, delegating to `planShortlistOnlyOutcomes`, and
  `finaliseSchoolRound` its branch (X11); 89a `saveShortlist`: under shortlist-only every created entry must stay picked
  (`created_entry_must_stay_shortlisted`), positions editable; 89a round page (list + link); consumer registry (H9);
  seed (H6). Reuse `can()` action `schoolRound.manage` (no H8 edit). No `deps.ts`/harness edit.
- `domain/shortlist-only.ts` keeps local `DigitalScope` and `string` status: switch to 70a's `DigitalScope` and 85b's
  `EntryStatus` once they are on M2 (structurally equal).

## Design (risk-flagged: K + L; compared with codebase-design)
**Promotion (the contested interface):**
- **A. Event-driven, each trigger checks the other condition inline.** Simplest, but the dual rule lives in the finalise
  use case, the file-live consumer and #90's close on behalf: three copies that can drift.
- **B. One readiness function + one idempotent applier (chosen).** `shortlistOnlyReadiness({ scope, status, fileLive,
  roundFinished })` (done) is the only place the rule lives; `promoteShortlistOnlyEntry(tx, entryId)` locks the round row
  `FOR UPDATE` (F15) then the entry, re-reads facts, asks readiness, and on `promote` calls `transitionEntry(...)` with
  `from: "school_shortlisted"`. Callers: the `entry.file_live` consumer and #90's close on behalf. Finalise uses
  `planShortlistOnlyOutcomes` (done), which agrees with readiness by construction (`statuses` is `["submitted_to_foa"]` iff
  the file is live). Deletion test: removing it re-spreads the condition over three callers. Leverage: #90 gets
  promotion for free.
- **C. Derived status** (compute "submitted to FOA" on read). Rejected: 92's queue, history rows, events and #90's revert
  need a stored status.
**Creation:**
- **A. Option on 85b's `startEntryUpload`** (`shortlisted: { position, declarations }`): one upload interface, but 85b's
  interface absorbs school-round rules and H23 grows. Rejected.
- **B. Own use cases in the school-round module (chosen)** over 85b's lower-level `createEntry` / entry-file helpers:
  limits through 89a's `checkCategoryPicks` (candidates = the category's created entries + the new one, all
  `submitted: true`), declarations through `checkShortlistOnlyDeclarations`, pick + declarations + entry in one transaction
  at complete. Entry created at upload confirmation, matching 85b's "no draft state".
- **C. Entry first, file later.** An entry with no file that a coordinator may abandon. Rejected.

## Interface needs (adopt the real names on M2 at claim)
```ts
// #70 (via 89a): getCompetitionRoundSettings(db, competitionId): Promise<{ code: string; shortlistSize: number;
//   schoolPositions: number; submissionScope: "all_participants" | "shortlist_only"; submissionOpensAt: Date; submissionClosesAt: Date }>
// 85b entries
createEntry(tx: AppDb, i: { registrationId: string; institutionRegistrationId: string | null; categoryKey: string; disciplineKey: string;
  title: string; description: string | null; status: "processing" | "school_shortlisted"; actor: Actor; at: Date }): Promise<{ entryId: string; code: string }>;
startEntryFile(ctx: UseCaseContext, tx: AppDb, i: { entryId: string | null; fileName: string; contentType: string; sizeBytes: number })
  : Promise<{ entryFileId: string; upload: { url: string; headers: Record<string, string>; expiresAt: Date } }>; // 85b's file rules
confirmEntryFile(ctx: UseCaseContext, tx: AppDb, i: { entryFileId: string }): Promise<{ entryId: string | null; fileStatus: EntryFileStatus }>;
hasLiveFile(db: AppDb, entryId: string): Promise<boolean>;
transitionEntry(tx: AppDb, i: { entryId: string; from: EntryStatus; to: EntryStatus; actor: Actor; at: Date; cause: string }): Promise<void>;
isSubmissionWindowOpen(c: { submissionOpensAt: Date; submissionClosesAt: Date }, now: Date): boolean;
// events: "entry.file_live" { entryId, entryFileId }, "entry.file_failed" { entryId, entryFileId, code }
// 89a: checkCategoryPicks, isSchoolRoundEditable, schoolRound / schoolRoundPick tables, listInstitutionEntries
// 89b: planFinalisation(facts & { scope }), finaliseSchoolRound, messageFamilies(outcomes)
// #75: listEnrolledStudents(db, institutionRegistrationId): Promise<{ registrationId: string; confirmed: boolean; categoryKey: string }[]>
// #69/#81: notify(tx, { template: "registration_not_shortlisted"; to: { registrationId: string }; data: { competitionCode: string } })
// #59: can(actor, "schoolRound.manage", { institutionId }) // throws ForbiddenError
```
**Exports for #90:** `promoteShortlistOnlyEntry(tx, entryId)`; "round finished" = `finalised | closed_on_behalf`.

## Residue
- HR-36: declaration wording (stored as `SHORTLIST_ONLY_DECLARATIONS_VERSION = "2026-11-draft"`), `registration_not_shortlisted`
  copy, page copy (draft from `messages/en-IN/schools.json`).
- HR-37: declaration set (original work, faithful reproduction, participation covered by the school's declaration, physical
  work kept); public-use consents optional (gate public use later); unconfirmed students get no message; no withdrawal of a
  created entry in M2 (follow-up if FOA wants it); same file types/size as 85b, no minimum resolution; `overdue` editability
  follows #90 through `isSchoolRoundEditable`.
- HR-30: whether FOA may rely on the school's declaration (counsel). HR-14: DLT for the SMS short form. HR-31: retention of
  `entry_declaration` rows.

## Test plan
Vitest for the core (done, 35). Seam 1 through `createHarness()`: competitions per scope via seed builders, a confirmed
institution registration with a minor + guardian contact, an adult student, an unconfirmed student and an individual-route
participant; `h.storage`/media fakes for live and failed files; `h.drain()`; FakeEmail and inbox asserts; table-driven
authz. Transition table rows in 85b's test. Seam 2 spec written with `expectRendersAccessibly` (+ `.dark`), Not run.

## Slices (ordered)
1. Scope guard + creation: schema, migration, start/complete, limits, declarations, transition row, authz (AC 1, 2, 3, 8,
   9) · `shortlist-only-create.test.ts`.
2. Processing + promotion: file-live/failed consumer, re-upload, `promoteShortlistOnlyEntry` (AC 4, 7) ·
   `shortlist-only-promote.test.ts`.
3. Finalise branch + registration messages (AC 5, 6) · `shortlist-only-finalise.test.ts`.
4. Page, namespace, round-page list, seed, e2e spec (AC 10, 11) · `seed.test.ts` case + `tests/e2e/91-shortlist-entries.spec.ts`.
