# 125b: Event registration, waitlist, auto-promotion, change notices and reminders (#125, M6, size L, risk: minors/safeguarding, personal data)

Branch `ticket/125-waitlist` · worktree `/root/foa-wt/125b` · cut from `foa/M0` 442dd99 · blocked by 125a and 84b (and, through them, 69, 81b, 84a, 62, 61a, 59a).
**Head start:** `7d7b93e M6 #125: Add event registration and waitlist domain core` (51 tests. Its message says 56, which is wrong: re-word it at rebase.) It is the pure registration and waitlist core under `src/server/modules/events/domain/`: `registration-status` (all 5 statuses and the move table) and `waitlist` (`placeForNewRegistration`, `orderWaitlist`, `planPromotions`, `waitlistPosition`). It adds new files only and doesn't import 125a's files, so rebasing onto `foa/M6` after 125a lands is clean.
Tournament flagged in issues-M6-M8 (uncertainty 3, minors, L). The default is named below.

## Scope
- **In (125b):**
  - Data: the `event_registration` table with the enum `event_registration_status` (all five values, check-in's included, so 125c adds no enum value), in migration `125_event_registrations`.
  - Use cases:
    - `registerForEvent({eventId, attendee?: {participantProfileId}})`: for yourself, or for a linked child;
    - `cancelEventRegistration(registrationId)`: by the attendee, their guardian or staff;
    - `listMyEventRegistrations()`: includes the children you registered;
    - `listEventRegistrations(eventId)` and `getEventPlaces(eventId)`: staff.
  - Promotion runs in the cancelling transaction, and in 125a's `updateEvent` when capacity rises (one hook call).
  - Outbox events: `event.registration_created {registrationId, status}`, `event.waitlist_promoted`, `event.registration_cancelled`.
  - Notification routes and templates: confirmation (registered or waitlisted), promotion, change notice (consumes `event.changed`), cancellation notice (consumes `event.cancelled`).
  - The reminder `event_starts`, on 84b's registry.
  - The audience resolver `event_registrants` (active registrants, with guardian routing).
  - Pages and data: the register/cancel island on `/events/[slug]`, "places left" there, `/dashboard/events`, `/admin/events/[eventId]/registrations`, the seed, inventory rows.
- **Out, 125c:** check-in, the `checked_in`/`no_show` moves in use, the end-of-event job, the timeline and the M6 journey.
- **Out, later or elsewhere:** SMS (off until DLT, HR-14) and campaign messages (#126).

## Acceptance criteria (each with its seam)
1. **Capacity, then waitlist.** With capacity 2, three members register. Two are `registered`; the third is `waitlisted` at position 1 (`listMyEventRegistrations` shows the position). *S1*
2. **Cancellation promotes.** When a registered attendee cancels, the person waiting longest becomes `registered` in the same transaction (`promoted_at` set). After `h.drain()` they hold a promotion message. *S1*
3. **In order.** With two waitlisted and two cancellations, they're promoted in waitlist order (`waitlisted_at`, then id). Someone registering while people wait joins the back, even if a place is momentarily free. *S1 + unit (done)*
4. **Capacity edits.** Raising capacity from 2 to 4 promotes the next two in order. Lowering it demotes nobody and promotes nobody until places free up. *S1 + unit (done)*
5. **Refusals.** Each is refused with its code:
   - `registration_not_open` (not open yet, closed, or the event is unpublished, cancelled or completed; uses 125a's `registrationWindow`);
   - `already_registered` (an active row for the same attendee);
   - `full` (full, with no waitlist);
   - `members_only` (audience `members` without the member role).

   A refusal writes no row and no outbox event. *S1*
6. **Reminders.** With offsets of 24 h and 2 h, set the clock to 24 h before the start minus 1 minute and drain: nothing is sent. Advance past it and drain: only `registered` attendees get it (not waitlisted or cancelled), one copy each. Draining twice changes nothing. *S1*
7. **Change notice.** A time edit sends a notice to every active registrant (registered and waitlisted). It names "time" and/or "place", and the reminders move: the old fire time sends nothing, the new one sends. A summary-only edit sends nothing. *S1*
8. **Cancellation notice.** Cancelling the event notifies every active registrant, and any scheduled reminder then does nothing. *S1*
9. **Minors.** A guardian registers a linked child (the attendee is the child's profile, `registered_by` is the guardian). Every notice and reminder goes to the guardian, never the child. A guardian registering an unlinked profile is refused with `forbidden`. A 13–17-year-old registering themselves is refused with `guardian_required` (the HR-55 default). The registration form shows the safeguarding notice (a placeholder). *S1*
10. **Transition table.** The unit tests cover every move (done). One S1 test: cancelling a cancelled registration returns `invalid_transition` and writes nothing.
11. **Authorization, per use case.** A member registers themselves; a visitor is refused. Cancelling your own registration is allowed; another member's is refused. Staff (content or community manager) may list and cancel on someone's behalf; a member and a competition manager are refused. *S1*
12. **Seed.** The preview seed adds a full event (capacity 2, two seed members registered, waitlist on) that 125c's journey uses. Running it twice changes nothing. *S1*
13. **Inventory, axe.** The new personal-data columns are inventoried, and the coverage test passes. axe is clean on `/dashboard/events`, `/admin/events/[eventId]/registrations` and the detail page with the island. *S1 + S2 (written, not run)*

## Files
- **Done:** `src/server/modules/events/domain/{registration-status,waitlist}.ts` + tests.
- **New:**
  - `src/server/db/schema/event-registrations.ts`
  - `drizzle/NNNN_125_event_registrations.sql`
  - `src/server/modules/events/{registrations,promotion,audiences,notices,reminder-event-starts}.ts` + tests
  - `src/server/modules/reminders/definitions/event-starts.ts` (84b's H10 pattern: one file plus one registry line)
  - `src/app/events/[slug]/_components/registration-panel.tsx` (a leaf client island under Suspense) + `actions.ts`
  - `src/app/dashboard/events/page.tsx`
  - `src/app/(staff)/admin/events/[eventId]/registrations/page.tsx`
  - `tests/e2e/125-events-registration.spec.ts`
- **Hotspots, one line each:**
  - H1, H2 (`--name 125_event_registrations`), H5, H6, H8;
  - H9: the outbox union, the consumer registry, the `message_route` and template seed;
  - H10: the reminder registry;
  - H7: the setting `reminders.event_starts.offsets`;
  - H19: the dashboard nav;
  - `events.json` (append keys);
  - 125a's `updateEvent` (one promotion call after a capacity change).
- **Note:** `/events/[slug]` must stay ○/◐. The panel reads the session only inside its Suspense boundary (trap 4), and the page shell stays cached.

## Design (codebase-design; tournament angles compared)
- **(a) Lock the event row, count the rows (chosen).** Every write that touches places runs `SELECT … FROM event WHERE id=$1 FOR UPDATE` in its transaction, counts the place-holding rows and the waitlist, applies the pure planner, writes, then emits. One source of truth with no drift. It works under PgBouncer transaction mode (the lock is inside a transaction). Promotion happens in the cancelling transaction, so a freed place is never visible to a newcomer.
- **(b) A `places_taken` counter with a conditional `UPDATE … WHERE places_taken < capacity`.** Faster under contention, but the counter can drift from the rows (needing a repair job), the waitlist still needs an ordered read and a lock, and a capacity edit needs both. Rejected.
- **(c) SERIALIZABLE transactions with retry.** PGlite can't show the conflict; a retry re-runs `emit`, which is safe only if idempotent; and it adds latency on Vercel. Rejected.
- **Backstops:**
  - Two partial unique indexes stop duplicates: `(event_id, attendee_user_id) WHERE attendee_user_id IS NOT NULL AND status <> 'cancelled'`, and the same on `attendee_profile_id`. The value `'cancelled'` comes from the same `CREATE TYPE`, so F2 doesn't bite.
  - A check enforces exactly one of `attendee_user_id` and `attendee_profile_id`.
  - PGlite is serial, so the race itself is untestable here: the lock is reviewed, not tested (stated in the PR).
- **Attendee subject:** dual keys (an adult user, or a participant profile for a child). That maps onto either of #119's subject designs: under profile-always, 125c resolves user → profile when writing the timeline.
- **Columns:** id, event_id FK, attendee_user_id null, attendee_profile_id null, registered_by_user_id, status, waitlisted_at null, promoted_at null, cancelled_at null, cancelled_by_user_id null, checked_in_at null, checked_in_by_user_id null, created_at, updated_at. Index `(event_id, status, waitlisted_at, id)`.
- **Notices:** producers only `emit`. #69 routes `event.*` events to templates through the `event_registrants` resolver (registered + waitlisted; reminders: registered only). Recipients are planned with 84a's routing (minor → guardians, one copy each). The dedupe key is `event:<outboxEventId>:<recipientKey hash>`.
- **Reminders:** the `ReminderDefinition` `event_starts`:
  - `deadlineOf` returns `starts_at` while published, else null (so jobs after a cancellation no-op);
  - `owes` returns the registered attendees;
  - the offsets setting defaults to `[24, 2]` hours (#125's proposed 1440 and 120 minutes, in 84b's unit);
  - `scheduleReminders` runs on `event.published` and on `event.changed` when `startMoved`.

## Interface needs (code against these; rename to what landed)
```ts
// 125a
event: { id; status: EventStatus; capacity: number | null; waitlistEnabled: boolean; audience: EventAudience;
  startsAt; endsAt; publishedAt; registrationOpensAt; registrationClosesAt; title; slug };
registrationWindow(event: RegistrationWindowEvent, now: Date): RegistrationWindow;   // 125a domain
// payload of event.changed: { eventId; changes: ("time"|"place")[]; startMoved: boolean; endsAt: string }
// 84b (H10)
interface ReminderDefinition { name: string; subjectType: "competition" | "event"; offsetsSetting: SettingKey;
  deadlineOf(tx: AppDb, subjectId: string): Promise<Date | null>;
  owes(ctx: UseCaseContext, a: { subjectId: string; deadlineAt: Date }): Promise<AudienceSnapshot>; templateKey: string }
scheduleReminders(ctx: UseCaseContext, a: { reminder: string; subjectId: string }): Promise<void>;
// 84a: Participant, Contact, AudienceSnapshot, planAnnouncementAudience(snapshot, at) → AudiencePlan (minor → guardians)
// 69
registerAudience(key: "event_registrants", resolve: (ctx, event: OutboxEvent) => Promise<Recipient[]>): void;
// message_route seed row: { eventType: "event.waitlist_promoted", audience: "event_registrant", templateKey: "event_promoted", channels: ["email","in_app"] }
// 81b
isActiveGuardianOf(db: AppDb, guardianUserId: string, participantProfileId: string): Promise<boolean>;
loadParticipant(db: AppDb, participantProfileId: string): Promise<Participant>;   // decrypted DOB + guardians
userIsUnder18(db: AppDb, userId: string, at: Date): Promise<boolean>;            // via the teen's participant profile
// 62: defineSetting({ key: "reminders.event_starts.offsets", schema: reminderOffsetsSchema, default: [24, 2], description })
// 59a: authorize(ctx, "event_registration.create" | ".cancel" | ".read_own" | ".read_all", { ownerId }), recordAudit(...)
// 61a: emit(tx, clock, event); h.drain()
```

## Residue
- **HR-55:** the FOA rule for in-person events with minors. The default: a guardian registers anyone under 18; the safeguarding notice is placeholder text on the form.
- **HR-56 (append):** event message copy for confirmation, waitlisted, promoted, change notice, cancellation and reminder.
- **HR-14:** DLT templates for event SMS. `sms.enabled` stays off; email and in-app cover.
- **HR-57 (append, M6 defaults):**
  - reminders at 24 h and 2 h;
  - newcomers queue behind the waitlist;
  - no demotion when capacity is cut;
  - waitlisted people get change notices but not reminders;
  - one place per registration.
- **HR-31:** retention for `attendee_*`, `registered_by_user_id` and `cancelled_by_user_id`.
- **HR-10:** reminders run in the worker; previews use the drain route.
- **Not run:** Seam 2 and axe; the real concurrency test (needs Postgres).

## Test plan
- **Unit:** done (status table, planner).
- **Seam 1 world:**
  - a published event (capacity 2, waitlist on, starts 2027-02-13 07:00 IST);
  - members A–D;
  - a guardian with a linked under-13 child and a linked teen with their own login;
  - a content manager.
- **Seam 1 tooling:** `h.clock.set/advance` and `h.drain()`. Assert on rows, `h.email.sent` recipients, inbox items, outbox types and `reminder_job` statuses.

## Slices (size L → 5, in order)
1. `registrations.test.ts`: schema, migration, `registerForEvent`, capacity and waitlist, refusals, authorization, my list (AC 1, 5, 10, 11).
2. `waitlist-promotion.test.ts`: cancel, promote in the same transaction, the capacity hook, confirmation and promotion notices (AC 2, 3, 4).
3. `registrations-minors.test.ts`: guardian registration, guardian routing, the teen refusal (AC 9).
4. `event-notices.test.ts`: the reminder definition and schedule, change and cancellation notices (AC 6, 7, 8).
5. `seed.test.ts` + pages + `tests/e2e/125-events-registration.spec.ts` (AC 12, 13).
