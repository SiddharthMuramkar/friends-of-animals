# 125c: Event check-in, attendance on the timeline, M6 Seam 2 journey (#125, M6, size M, risk: minors/safeguarding, personal data)

Branch `ticket/125-check-in` · worktree `/root/foa-wt/125c` (create at build time from `foa/M6`) · blocked by 125b and 119.
**No head start.** The rules left to 125c are thin: the check-in window, the end-of-event plan and the timeline source key. They also need 125b's registration types, so they're written test-first at build time in `src/server/modules/events/domain/check-in.ts`.

## Scope
- **In (125c):**
  - Use cases:
    - `checkInAttendee(registrationId)` (organiser): registered → checked_in, with `checked_in_at` and `checked_in_by` set;
    - `getCheckInSheet(eventId, {query?})` (organiser): registered and checked-in attendees with counts, searchable by name;
    - the system handler `settleEndedEvent`: at `ends_at`, remaining `registered` → `no_show`, and the event → `completed` through 125a's table.
  - The attendance timeline entry `event_attended` through #119's writer, plus its kind registration (H20) and label.
  - Pages: `/admin/events/[eventId]/check-in`.
  - The **M6 Seam 2 milestone journey**.
  - Seed: a past event with attendance, for the preview timeline.
- **Out (done in 125a/125b):** the five registration statuses and their moves (125b's table already has `registered → checked_in` and `registered → no_show`), publishing, registering and notices.
- **Out, later:** volunteers as check-in helpers (#123/#124 could add a role rule), QR self check-in, undoing a check-in.

## Acceptance criteria (each with its seam)
1. **Check-in counts.** An organiser checks in a registered attendee inside the window. The status is `checked_in`, with `checked_in_at` from the clock and `checked_in_by` set. One audit row is written. #119's `getTimeline(subject)` shows one `event_attended` entry, at `checked_in_at`, referencing the event. *S1*
2. **Idempotent.** Checking in again returns `already_checked_in`: no second audit row, no second timeline entry (unique `source_key`). *S1*
3. **Refusals.**
   - A waitlisted, cancelled or no-show registration → `not_registered`.
   - Before `starts_at − 2 h` or after `ends_at` → `check_in_closed`.
   - A cancelled or completed event → `check_in_closed`.

   A refusal writes nothing. *S1*
4. **Authorization, per use case.**
   - Allowed: content_manager and community_manager.
   - Refused, on both use cases: a member checking in someone else, a member checking themselves in, and a visitor.
   - `settleEndedEvent` runs only as `system`. *S1*
5. **End of event.**
   - Advance past `ends_at` and drain: every remaining `registered` → `no_show`, the event → `completed`, and `checked_in` rows are untouched.
   - One counts-only audit row (no names or ids list).
   - If `ends_at` moved later, the old job does nothing and the new one settles.
   - A cancelled event's job does nothing.
   - *S1*
6. **Minors.** A child registered by a guardian gets the timeline entry on the child's subject, and the guardian sees it through #119's guardian read. *S1*
7. **Transitions.** S1 check that `no_show → checked_in` through `checkInAttendee` is refused (the table is unit-tested in 125b).
8. **M6 journey** (`tests/e2e/125-events.spec.ts`, written, not run):
   1. A seeded member registers for the seeded full event and sees "Waitlisted".
   2. Staff cancel a seeded registration; the member sees "Registered".
   3. Staff check the member in on `/admin/events/[id]/check-in`.
   4. The member's `/dashboard/timeline` shows the attendance.

   `expectRendersAccessibly` runs on every page visited, light and dark.
9. **Seed.** A completed past event with one checked-in seed member and one no-show, so the preview timeline shows attendance. Idempotent. *S1*
10. **axe** is clean on the check-in page; there's no horizontal scroll at 320 px (a long name list uses `TableScroller`). *S2*

## Files
- **New:**
  - `src/server/modules/events/domain/check-in.ts` + test: `checkInWindow(event, now)`, the end-of-event plan, `attendanceSourceKey(registrationId)`
  - `src/server/modules/events/{check-in,end-of-event}.ts` + `check-in.test.ts` and `end-of-event.test.ts`
  - `src/app/(staff)/admin/events/[eventId]/check-in/{page.tsx,actions.ts,_components/*}`
  - `tests/e2e/125-events.spec.ts`
- **Hotspots, one line each:**
  - H20: #119's timeline kind registry and the `event_attended` label in `events.json` or `community.json`, whichever #119 reads;
  - H9: the consumers of `event.published` and `event.changed` that schedule the end job;
  - H6: the seed;
  - H8: the policy;
  - H19: the admin event sub-nav (a "Check-in" tab).
- **No schema change:** the check-in columns and enum values come from 125b. No migration, unless the end job needs a column (it doesn't; see Design).

## Design
- **End-of-event trigger.**
  - **(a) Chosen: emit with `availableAt`, from consumers.** On `event.published`, and on `event.changed` with "time" in `changes`, a consumer emits `event.end_due {eventId, endsAt}` with `availableAt = endsAt` (61a's pattern for a one-off future action, which works on previews and under the fake clock). The handler checks at run time, like 84b's `checkReminderAtRunTime`: the event is still published, its current `ends_at` equals the payload's, and `now ≥ ends_at`. Otherwise it does nothing. This needs no edit to 125a's code.
  - **(b) A pg-boss cron sweeper every 15 min.** Rejected as the default: up to 15 min late, worker-only, so previews and the fake clock can't drive it. It stays the fallback if 61a's `availableAt` isn't honoured.
  - **(c) Lazy no-show at read time.** Rejected: statuses would lie in the database, and reports (#135b) would recompute them.
- **Check-in window.** From `starts_at − 2 h` to `ends_at` (default, HR-57). It's a pure function taking `now` from the clock.
- **Timeline write.** In the check-in transaction, call `recordTimelineEntry`:
  - subject: the attendee (user or profile; under #119's profile-always design, resolve user → profile);
  - kind `event_attended`, occurred at `checked_in_at`;
  - ref `{type:"event", id}`, label params `{eventTitle}` (no personal data);
  - source key `event_registration:<id>:attended`.

  Replay-safe through #119's unique `source_key`.
- **Organisers.** Content and community managers only, the same rule as 125a. Volunteers are left for #123/#124.

## Interface needs (code against these; rename to what landed)
```ts
// 119
recordTimelineEntry(tx: AppDb, ctx: UseCaseContext, e: { subject: TimelineSubject; kind: "event_attended";
  occurredAt: Date; ref: { type: "event"; id: string }; labelParams: { eventTitle: string }; sourceKey: string }
): Promise<{ created: boolean }>;
type TimelineSubject = { userId: string } | { participantProfileId: string };   // or profile-only + subjectForUser(db, userId)
registerTimelineKind({ kind: "event_attended", labelKey: "events.timeline.attended" }): void;   // H20
getTimeline(subject): Promise<TimelineEntry[]>   // assertions; guardian read for AC6
// 125b
event_registration columns (status, attendee_user_id | attendee_profile_id, checked_in_at, checked_in_by_user_id);
moveRegistration(from, to); PLACE_HOLDING_STATUSES; seeded full event id (SEED_EVENTS.fullEvent)
// 125a
moveEvent("published", "completed"); event.changed payload { changes; endsAt }; event row
// 61a
emit(tx, clock, { type: "event.end_due"; aggregate: { type: "event"; id }; payload: { eventId: string; endsAt: string } }, { availableAt: Date });
// consumer registry: on("event.published" | "event.changed", handler); h.drain()
// 59a: authorize(ctx, "event.check_in" | "event.check_in_sheet"), system("worker") rule, recordAudit(...)
```

## Residue
- **HR-57 (append, M6 defaults):** check-in opens 2 h before the start; organisers only; no undo of a check-in; no-shows are set at the end.
- **HR-31:** retention of `checked_in_by_user_id`, and of attendance as a timeline entry (with #119's).
- **HR-28:** real devices for the check-in page (organisers use phones at the venue).
- **Not run:** the Seam 2 journey and axe (no Postgres server; previews fail at `pnpm db:migrate`; HR-01/HR-02 gate the preview run).

## Test plan
- **Seam 1 world:**
  - 125b's seeded full event plus a one-hour event;
  - a member, and a guardian with a child;
  - a content manager, a community manager, a competition manager.
- **Seam 1 tooling:** `h.clock.set` to before the window, inside it and after the end; `h.drain()` for the end job. Assert on registration rows, the event status, audit rows and #119's timeline read.
- **Unit:** `check-in.test.ts`: window edges (inclusive start, exclusive end), cancelled or completed events, the source key.
- **Seam 2:** the M6 journey (above), written, not run.

## Slices (size M → 1)
1. `src/server/modules/events/check-in.test.ts` (AC 1–4, 6, 7). Build order:
   1. the domain `check-in.ts`;
   2. `checkInAttendee` with the timeline write;
   3. `getCheckInSheet`;
   4. the end-of-event consumer and handler (`end-of-event.test.ts`, AC 5);
   5. the seed (AC 9);
   6. the check-in page;
   7. the M6 journey spec (AC 8, 10).
