# 84b: Reminder schedules and the submission reminder (#84, M2, risk K/PD, size L)

Branch `ticket/84-reminders`, worktree `/root/foa-wt/84b`, cut from `foa/M0` at 442dd99. The head start is `dd16139` (pure scheduling core, below). Blocker: 85b. Sibling **84a** owns announcements and the audience/guardian-routing core (`announcements/domain/audience.ts`). Re-base onto `foa/M2` when the build starts.

## Scope
- **In:**
  - the reminder registry (H10 owner) and the `reminder_job` table with its `reminder_job_status` enum (`scheduled`, `fired`, `cancelled`, `superseded`);
  - one settings key per reminder, `reminders.entry_submission_due.offsets` (default `[72, 24]` hours);
  - `scheduleReminders`, run by the worker on `competition.published` and `competition.key_dates_changed`;
  - the job handler `reminder.run` → `runReminder`, which checks the deadline and who owes it at run time;
  - the first reminder, `entry_submission_due`, with its template `reminder_entry_submission` (email, in_app, sms);
  - cancelling every scheduled reminder when a competition is cancelled (if #80's event exists);
  - the preview seed (inbox reminder items).
- **Out:**
  - `school_round_shortlist_due`: #90 registers it on this registry (F5). Say so in the PR, because the ticket mentions "school round".
  - the dispatch reminder (#93) and event reminders (#125), which reuse the registry;
  - pages: offsets are edited in #62's settings screen if its registry drives it (runtime check). There is no messages namespace.

## Acceptance criteria (each with the seam that proves it)
1. Publishing a competition with a submission deadline creates one `scheduled` `reminder_job` per future offset, each with an enqueued delayed job (`startAfter = fire_at`, `singletonKey = reminder_job.id`). Scheduling again with no change creates nothing. *Seam 1*
2. Set the clock to `deadline − 72h − 1m` and drain: nothing is sent. Advance past `deadline − 72h` and drain: registrants who owe the deadline are reminded and those who met it are not. *Seam 1*
3. An entry submitted between scheduling and run time suppresses that registrant's reminder, because "owes" is evaluated when the job runs. *Seam 1*
4. Moving the deadline 2 days later supersedes the old rows. Advancing to the old fire time and draining sends nothing (the job no-ops); the new fire time sends. *Seam 1 + unit (done)*
5. Changing the offsets setting, followed by a schedule run, keeps the matching rows, supersedes the rest and creates the new ones. *Seam 1 + unit (done)*
6. A minor's reminder goes to their guardian, never the minor. *Seam 1*
7. A coordinator gets one reminder per run covering all their students without an entry (all-participants scope). Under shortlist-only scope, school-route students owe nothing, so no coordinator reminder is sent for `entry_submission_due`. *Seam 1*
8. Draining twice, or retrying after `h.email.failNext(1)`, sends one copy per recipient per reminder row. The dedupe key is `reminder:<reminderJobId>:<blindIndex(recipient.key)>`. A fired row is marked `fired`. *Seam 1*
9. A deadline already passed, or a job run late, sends nothing. Offsets whose time has gone are skipped, not sent in a burst. *Unit (done) + Seam 1*
10. Authorisation: if `scheduleReminders` is reachable through `as()`, only `system` passes; a competition manager and a member fail. *Seam 1*
11. The preview seed is idempotent. *Seam 1 seed test*

## Files
- **Done:** `src/server/modules/reminders/domain/{offsets,schedule}.ts` and their tests.
- **New:**
  - `src/server/db/schema/reminders.ts`
  - `src/server/modules/reminders/{registry.ts,settings.ts,schedule-reminders.ts,run-reminder.ts,definitions/entry-submission-due.ts,seed.ts,index.ts}` and their tests
- **Hotspots, one line each:** schema barrel (H1); `drizzle/*` (H2, `--name 84_reminders`); the settings registry barrel (H7); the consumer/job-handler registry and event-to-template seed (H9); the `seeders` list (H6); `composeUseCases` if any use case is exposed.
- **H10 is this unit's:** later reminders add one file in `definitions/` plus one registry line.

## Design (codebase-design, 3 options compared)
- **A. Chosen: `reminder_job` rows as the truth, plus one delayed pg-boss job per row.**
  - Reschedule = `diffReminderSchedule` (keep, create, supersede).
  - The job carries only `reminderJobId`. `runReminder` locks the row (`FOR UPDATE`), applies `checkReminderAtRunTime` against the current deadline, evaluates `owes`, delivers, and marks the row `fired` in one transaction.
  - It's exact on time, survives edits and setting changes, and a fired row blocks double sends.
- **B. A pg-boss cron sweeper every 15 min over due rows.** Robust to lost jobs, but fires up to 15 min late and needs another schedule. Kept as a fallback: if #61's drain can't run delayed jobs by `startAfter`, switch to it (same table, same domain core).
- **C. Delayed jobs with the deadline snapshot in the payload, and no table.** Simplest, but it can't follow offset changes, can't show what's scheduled, and double-schedules without a singleton key.

**Table:** `reminder_job(id uuidv7, reminder_name text, subject_id uuid, offset_hours int, deadline_at timestamptz, fire_at timestamptz, status, job_id text null, fired_at null, created_at, updated_at)`.
- Index `(status, fire_at)`.
- Partial unique `(reminder_name, subject_id, offset_hours, deadline_at) WHERE status IN ('scheduled','fired')`, so moving a deadline A→B→A can plan A again.
- `subject_id` (not `competition_id`) lets #125's event reminders reuse the table.

**"Owes" for `entry_submission_due`:** a confirmed registration (individual route; or institution route under scope `all`) with no entry whose status is outside {`rejected`, `failed`}. `processing` counts as met (HR-37). Recipients are planned with 84a's routing (minor → guardians) and coordinators per institution registration.

## Registry and interface needs (what 84b codes against)
```ts
// own (H10)
export interface ReminderDefinition {
  name: "entry_submission_due" | (string & {});
  subjectType: "competition" | "event";
  offsetsSetting: SettingKey;                               // "reminders.<name>.offsets"
  deadlineOf(tx: AppDb, subjectId: string): Promise<Date | null>;
  owes(ctx: UseCaseContext, args: { subjectId: string; deadlineAt: Date }): Promise<AudienceSnapshot>;
  templateKey: string;                                      // "reminder_entry_submission"
}
export const REMINDERS: readonly ReminderDefinition[];
// #61: jobs, consumers, drain
jobs.sendAt(name: "reminder.run", data: { reminderJobId: string },
  opts: { startAfter: Date; singletonKey: string }): Promise<string /* job id */>;
jobHandlers["reminder.run"] = (ctx, data) => runReminder(ctx, data);
consumers["competition.published" | "competition.key_dates_changed"] =
  (ctx, e: { payload: { competitionId: string } }) => scheduleReminders(ctx, { subjectId: e.payload.competitionId });
h.drain(opts?: { until?: Date }): Promise<void>; // runs jobs whose startAfter <= h.clock.now()
// #62: settings
defineSetting({ key: "reminders.entry_submission_due.offsets", schema: reminderOffsetsSchema,
  default: DEFAULT_REMINDER_OFFSETS_HOURS, description: string });
settings.get(key): Promise<number[]>;
// #70/#71: competition_key_date(competition_id, kind 'submission_deadline', at);
//   competition.digital_submission_scope 'all' | 'shortlist_only'.
//   Events emitted in-transaction on publish and on a key-date edit (if missing, 84b adds the emit next to #71's reschedule hook: H24).
// #85b: entry(id, registration_id, status entry_status) with the nine F2 values
// 84a / #81b: planAnnouncementAudience(snapshot, at) routing (minor → guardians, one copy per person)
// #69 + #58: deliver(ctx, { templateKey, recipient, variables, dedupeKey }); blindIndex(value)
```
If 84a hasn't merged when 84b builds, import its `audience.ts` by cherry-picking `0bbaeec`. Don't fork the routing.

## Residue
- **HR-37:** offsets default `[72h, 24h]`; `processing` counts as met; no catch-up for offsets already passed.
- **HR-36:** reminder template copy.
- **HR-14:** a DLT template for the reminder SMS.
- **HR-10:** reminders run only in the worker, so worker-preview must be rebuilt for previews.

## Test plan
- **Seam 1 world:** a published competition (scope `all`) whose submission deadline is 2027-02-13 23:59 IST. It has:
  - adult individual A with no entry;
  - adult individual B with a `submitted` entry;
  - minor individual C with a guardian and no entry;
  - adult D with a `rejected` entry (owes);
  - an institution registration (coordinator plus 2 students, one without an entry).
- A second competition with scope `shortlist_only` has the same institution setup.
- Use `h.clock.set`/`advance` and `h.drain()`. Assert on `h.email.sent` recipients, `reminder_job` statuses and the jobs enqueued.
- **Unit:** done (27 cases).
- **Seam 2:** none (no page).

## Slices (ordered)
1. **Scheduling:** schema, migration, registry, settings key, `scheduleReminders` triggered by publish (rows and delayed jobs, idempotent). AC 1, 10. `reminders-schedule.test.ts`
2. **Submission reminder:** `runReminder`, the run-time check, `entry_submission_due` owes for individuals with guardian routing. AC 2, 3, 6, 9. `reminders-entry-submission.test.ts`
3. **Reschedule:** deadline edit and offsets change, stale jobs no-op. AC 4, 5. `reminders-reschedule.test.ts`
4. **Coordinators and seed:** coordinators, shortlist-only scope, dedupe on retry, seed. AC 7, 8, 11. `reminders-coordinators.test.ts`
