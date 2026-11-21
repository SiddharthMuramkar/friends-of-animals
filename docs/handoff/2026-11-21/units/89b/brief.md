# Brief 89b: attest the judging and finalise the school round

Unit 89b of #89 · M2 · M · risk K, PD · key X11 · branch `ticket/89-finalise` · worktree `/root/foa-wt/89b` · blocked by
89a (and #87 conduct certification, 85b entry machine H22, #69/#81 notifications, #59 audit, 61a outbox).
Sources: #89 body + owner decisions (2026-11-19), `issues-M2.md` §2.1 / §2.2 / §3 #89 / F13 / F15, spec §1.9.

## Scope
**In (89b):** `finaliseSchoolRound` (records the judging attestation and finalises in one transaction), the `open →
finalised` round row, the entry rows it introduces (H22), the `school_round.shortlist_finalised` event (its only
producer), family messages by a consumer of that event, `listSchoolRoundOutcomes` (owner: #100 needs it), the finalise
section and finalised state of the coordinator page, `schoolRound` copy for them, a finalised round in the preview seed.
**Pure core already built on this branch** (see "Head start"). **Out:** 89a owns the module, schema (all #89 columns,
so no migration here), opening, panel, picks and positions. #90: overdue, close on behalf (reuses the message fan-out),
reopen, `overdue → finalised`. 91a: shortlist-only variant.

## Acceptance checks
1. Finalise is refused with `finalise_blocked` listing every blocker: no panel member (`panel_missing`), no conduct
   certification (`conduct_not_certified`, #87), no attestation in the input (`judging_not_attested`); nothing changes. *Seam 1*
2. All-participants finalise: each picked entry ends `submitted_to_foa`, its history `submitted → school_shortlisted →
   submitted_to_foa`; every other entry of the institution, including `processing`/`rejected`/`failed`, ends
   `not_shortlisted`; round `finalised` with `finalised_by/at` and `judging_attested_by/at/statement_version`; one
   transaction. A zero-entry round finalises. *Seam 1*
3. Exactly one `school_round.shortlist_finalised` outbox row, payload ids only (round, competition, institution
   registration, per-entry outcome + position). Finalising again → `SchoolRoundTransitionError` (`finalised → finalised`).
   Running every other school-round use case first emits none. A Vitest scan of `src/server` finds the event name in one
   producer file only. *Seam 1 + Vitest*
4. After `h.drain()`: shortlisted families get `entry_school_shortlisted`, the others `entry_not_shortlisted`; for a
   minor the guardian is told and the minor gets nothing; an adult student is told directly; a contact-only guardian gets
   email (F13). *Seam 1 (FakeEmail, inbox)*
5. One audit row `school_round.finalised` (actor, round id). *Seam 1*
6. Transition tables: round `open → finalised` allowed, everything else from `finalised` still forbidden; entry rows
   `submitted → school_shortlisted`, `school_shortlisted → submitted_to_foa`, `processing|rejected|failed|submitted →
   not_shortlisted` allowed; forbidden kept: `processing → school_shortlisted`, `not_shortlisted → submitted_to_foa`,
   individual-route entry → `school_shortlisted`/`not_shortlisted`. *Vitest tables*
7. After finalise, `recordPanel` and `saveShortlist` → `round_not_editable`. *Seam 1*
8. `listSchoolRoundOutcomes({ registrationId } | { institutionRegistrationId })`: finalised → `shortlisted` + position or
   `not_shortlisted`; open → `pending` with no picks exposed. *Seam 1*
9. Authz: `finaliseSchoolRound`: coordinator of the institution passes; other institution's coordinator, participant and
   competition manager get `forbidden`. `listSchoolRoundOutcomes`: system, competition manager and that coordinator pass;
   another coordinator and a participant fail. *Seam 1*
10. Page: readiness checklist (from the core's blockers), attestation checkbox + text, confirmation summary of who is
    shortlisted; finalised state read-only; both states accessible, light + dark. *Seam 2 (written, Not run)*
11. `h.seed.preview()` adds a second institution's finalised round; idempotent. *Seam 1*

## Files and hotspots
- Head start (committed): `src/server/modules/school-round/domain/finalise.ts` + `.test.ts`.
- New: `src/server/modules/school-round/{finalise-school-round,list-school-round-outcomes,message-families}.ts` + tests;
  `src/server/modules/school-round/only-finalise-emits.test.ts`; email/in-app/SMS templates for the two messages (#69
  registry, H9); `tests/e2e/89-school-round.spec.ts` gains the finalised state.
- Edits: 89a's `domain/status.ts` + test (one row each), its module index, page, `schoolRound.json`, seed; 85b's
  `src/server/modules/entries/status.ts` + test (H22, serialize per Q2); `can()` table (H8); consumer registry (H9).
- Once 89a is on M2, switch `finalise.ts`'s local `{ entryId, position }` shape to 89a's `Pick` type (structurally equal).

## Design (risk-flagged: three designs compared)
- **A. Inline finalise + separate `certifyJudging`** (spec proposal). Two use cases, two authz matrices, and an attestation
  that can go stale when picks change after it (or after #90 reopens).
- **B. One `finaliseSchoolRound({ roundId, attestation: { statementVersion } })` over the pure planner (chosen).** The
  attestation is recorded in the finalise transaction, so it always covers the exact shortlist made official. Steps: lock
  the round `FOR UPDATE` (F15); gather facts; `planFinalisation(facts)`; `assertSchoolRoundTransition(status,
  "finalised")`; apply each outcome's `statuses` through Entries' `transitionEntry`; update the round; `emit` the event;
  audit; all in one transaction. The page calls the same planner for its checklist (one rule set, two callers). Family
  messages: a consumer of the event calls `messageFamilies(outcomes)`, which #90 reuses for close on behalf.
- **C. Choreography**: Entries consumes `shortlist_finalised` and moves its own rows. Breaks atomicity (round finalised,
  entries not yet moved) and AC 2. Rejected.

## Interface needs (expected names; adopt the real ones on `M2` at claim)
```ts
isConductCertified(db: AppDb, institutionRegistrationId: string): Promise<boolean>; // #87
transitionEntry(tx: AppDb, input: { entryId: string; to: EntryStatus; actor: Actor; reason?: string }): Promise<void>; // 85b, checks H22, writes entry_transition
recordAudit(tx: AppDb, input: { action: "school_round.finalised"; actor: Actor; subject: { type: "school_round"; id: string } }): Promise<void>; // #59
notify(tx: AppDb, input: { template: "entry_school_shortlisted" | "entry_not_shortlisted"; to: { registrationId: string }; data: { entryCode: string; competitionCode: string; position: number | null } }): Promise<void>; // #69/#81: guardian for minors, contact-only = email
emit(tx: AppDb, event: { type: "school_round.shortlist_finalised"; roundId: string; competitionId: string; institutionRegistrationId: string; outcomes: { entryId: string; registrationId: string; outcome: "shortlisted" | "not_shortlisted"; position: number | null }[] }): Promise<void>; // 61a
// from 89a
assertSchoolRoundTransition(from: SchoolRoundStatus | null, to: SchoolRoundStatus): void;
listInstitutionEntries(db: AppDb, input: { institutionRegistrationId: string }): Promise<{ entryId: string; registrationId: string; code: string; categoryKey: string; status: EntryStatus }[]>;
```

## Head start (pure core, Vitest only): `a07a089` on `ticket/89-finalise`, 7 tests, `pnpm check` green
`domain/finalise.ts`: `planFinalisation({ panelSize, conductCertified, judgingAttested, entries: [{ entryId, submitted }],
picks: [{ entryId, position }] })` → `{ ok: true, outcomes }` (one per entry: `shortlisted` + position + `statuses:
["school_shortlisted", "submitted_to_foa"]`, or `not_shortlisted` + `position: null` + `statuses: ["not_shortlisted"]`) or `{ ok: false,
blockers }` with every `FinaliseBlocker` (`panel_missing`, `conduct_not_certified`, `judging_not_attested`,
`pick_not_in_round`, `pick_not_submitted`). All-participants scope only; 91a adds the shortlist-only variant.

## Residue
- HR-36: judging attestation wording (stored as `statement_version`), shortlisted / not-shortlisted message copy.
- HR-14: DLT templates for the two SMS; SMS stays behind `sms.enabled`.
- HR-37: attestation is per finalise (re-given after a #90 reopen); outcomes query hides draft picks before finalise.

## Test plan
Vitest for the planner (done) and the event-producer scan. Seam 1: seed a SCHOOL_JUDGING competition, an open round with
entries in every pre-finalise status, picks and positions, a minor with a guardian, an adult student and a contact-only
guardian; call `as(coordinator).finaliseSchoolRound(...)`; assert rows, entry history, outbox, audit; `h.drain()`; assert
`h.email` and inboxes. Authz matrix. Seam 2 spec extended, Not run.

## Slices
1. Finalise: attestation + planner + entry/round transitions + event + audit + family messages + outcomes query + page
   finalise section + seed (AC 1–11) · `finalise-school-round.test.ts` (+ `only-finalise-emits.test.ts`, table tests).
