# 84a: Announcements to confirmed registrants (#84, M2, risk K/PD/E, size L)

Branch `ticket/84-announce`, worktree `/root/foa-wt/84a`, cut from `foa/M0` at 442dd99. The head start is `0bbaeec` (pure domain core, below). Blocker: 81b. Sibling **84b** owns reminders: the registry, `reminder_job`, the settings keys and `entry_submission_due`. Re-base onto `foa/M2` when the build starts.

## Scope
- **In:** the `announcement` table and `announcement_status` enum (`draft`, `sent`); the use cases `createAnnouncement`, `updateAnnouncement`, `getAnnouncement`, `listAnnouncements`, `previewAnnouncement` and `sendAnnouncement`; the worker consumer `fanOutAnnouncement` for `competition.announcement_sent`; the audience loader over the registration tables; the `announcement` template rows (email, in_app, sms) seeded through #69's map; the audit action `announcement.sent`; three admin pages; the namespace `adminAnnouncements`; the preview seed (one draft and one sent announcement on the seeded competition); `tests/e2e/84-announcements.spec.ts`.
- **Out:** reminders (84b). A rich-text sanitiser: fields are plain text, so none is needed (F4). SMS go-live, which waits on DLT (HR-14). Communications consent: announcements are a service message (HR-37).

## Acceptance criteria (each with the seam that proves it)
1. A competition manager creates a draft, edits it and reads it back. `listAnnouncements` shows the competition's drafts and sent announcements, newest first. *Seam 1*
2. `previewAnnouncement` returns the rendered email and in-app message for a sample recipient, plus the recipient counts. Nothing is sent: the email/SMS fakes stay empty, and no outbox or inbox row is written. *Seam 1*
3. `sendAnnouncement` marks it `sent` (`sent_at`, `sent_by`, `recipient_count`) and writes one `competition.announcement_sent` outbox row in the same transaction. A second send fails with `announcement_already_sent`, and editing after sending fails with `announcement_not_editable`. *Seam 1*
4. After `h.drain()`, every planned recipient has one email. Account holders also have one inbox item; contact-only recipients (F13) get email (and SMS) only. *Seam 1*
5. Messages about a minor go to the guardian, never the minor. A 15-year-old with their own login gets nothing and their guardian gets it. A minor with no reachable guardian is counted as `unreachable` and gets nothing. *Unit (done) + Seam 1*
6. Unconfirmed individual or institution registrations and withdrawn students get nothing. Every coordinator of a confirmed institution registration gets it. A guardian of two enrolled siblings gets one copy. *Unit (done) + Seam 1*
7. Draining again, or a fan-out retried after `h.email.failNext(1)`, sends no duplicates. The dedupe key is `announcement:<id>:<blindIndex(recipient.key)>`. *Seam 1*
8. No SMS while `sms.enabled` is false; with it true, SMS goes to recipients who have a phone and whose preference is on (#69's rules). *Seam 1*
9. Sending writes one audit row `announcement.sent`: before `{status:"draft"}`, after `{status:"sent", counts}`, with no recipient list and no contact data. *Seam 1*
10. Authorisation for every use case: a global competition manager and one scoped to this competition pass. A content manager, a coordinator, a participant, and a competition manager scoped to another competition fail with `forbidden`. *Seam 1*
11. axe is clean on the three pages (desktop and Pixel 7), plus one run with `.dark`. *Seam 2: written, not run here*
12. The preview seed adds one draft and one sent announcement and is idempotent. *Seam 1 seed test*

## Files
- **Done:** `src/server/modules/announcements/domain/{age,audience,content}.ts` and their tests.
- **New:**
  - `src/server/db/schema/announcements.ts`
  - `src/server/modules/announcements/{index.ts,load-audience.ts,render.ts,use-cases/*.ts,fan-out.ts,seed.ts}` and their `*.test.ts`
  - `src/app/admin/competitions/[code]/announcements/{page.tsx,new/page.tsx,[id]/page.tsx,_components/*,_lib/*}`
  - `messages/en-IN/adminAnnouncements.json`
  - `tests/e2e/84-announcements.spec.ts`
- **Hotspots, one line each:** schema barrel (H1); `drizzle/*` and meta (H2, regenerate, `--name 84_announcements`); `src/i18n/messages.ts` (H3); the `seeders` list (H6); the `can()` action table (H8); the outbox event union, consumer registry and event-to-template seed (H9); admin nav and `app-routes.ts` (H19); `composeUseCases(...)` in `src/server/app.ts`.
- **H33:** reuse #81b's guardian routing if it exists. Otherwise 84a adds contact-addressed delivery to notifications (F13); keep it to one new function.

## Design (codebase-design, 3 options compared)
- **A. One outbox row per recipient, written in the send transaction.** Atomic, but it does O(recipients) work inside a Vercel request and puts recipient identities in outbox payloads (PD).
- **B. Chosen: one event, plus a deep fan-out module in the worker.** `sendAnnouncement` is shallow (zod, `can()`, flip the status, `emit`, audit). `fanOutAnnouncement(ctx, {announcementId})` hides the loader, `planAnnouncementAudience`, rendering and per-recipient `deliver` with a dedupe key. A retry is safe because the plan is deterministic (rows ordered by id) and delivery dedupes. The request does O(1) work and the payload carries ids only.
- **C. Chunked jobs (one per N recipients).** Only worth it beyond tens of thousands of recipients per competition, which this project won't see. Revisit if a fan-out exceeds the job timeout.

The audience is planned twice: at send time for the confirmation count and the audit row, and at fan-out for delivery. Any difference (a registration confirmed seconds later) is accepted, and the fan-out logs its actual count. The `announcement` row keeps the content columns from issues-M2 §3 #84. The event time is stored in UTC; the form takes IST through #70's IST↔UTC helper.

**Head start:** `planAnnouncementAudience(snapshot, at)` takes the decrypted `AudienceSnapshot`. `isUnder18On` reads the IST calendar; unknown DOB and 29 Feb birthdays count as minors. `announcementContentSchema` and `announcementSections` handle the content.

## Interface needs (what 84a codes against)
```ts
// #59: access and audit
can(actor: Actor, action: "announcement.manage", resource: { competitionId: string }): void; // throws forbidden
audit.write(tx, { action: "announcement.sent", entityType: "announcement", entityId: string,
  before: Json, after: Json }): Promise<void>; // actor taken from ctx
// #61: outbox and drain
emit(tx, { type: "competition.announcement_sent", aggregateType: "announcement",
  aggregateId: string, payload: { announcementId: string; competitionId: string } }): Promise<void>;
consumers["competition.announcement_sent"] = (ctx: UseCaseContext, e) => fanOutAnnouncement(ctx, e.payload);
h.drain(): Promise<void>; h.sms: FakeSms; // #58
// #69 (+ #81b, F13): delivery and preview rendering
type Recipient = { kind: "user"; userId: string } | { kind: "contact"; email: string | null; phone: string | null; name: string | null };
deliver(ctx, { templateKey: "announcement", recipient: Recipient, variables: Record<string, string>,
  dedupeKey: string }): Promise<"sent" | "duplicate">;
renderTemplate(ctx, { templateKey: string, channel: "email" | "in_app" | "sms", variables: Record<string, string> }):
  Promise<{ subject?: string; text: string; html?: string }>;
// #58
blindIndex(value: string): string; // FIELD_HMAC_KEY
// #70: competition(id, code, name, status); #75/#77/#78/#81 tables read by load-audience.ts:
// registration(id, competition_id, participant_profile_id, route, institution_registration_id, status)
// institution_registration(id, institution_id, competition_id, status) -- "confirmed" after #77
// participant_profile(id, owner_kind, user_id?, dob enc 'YYYY-MM-DD', email/phone enc, guardian_* enc)
// guardian(id, user_id, verified_at), guardian_link(guardian_id, participant_profile_id, revoked_at)
// user_role(user_id, role 'institution_coordinator', scope_type 'institution', scope_id)
```
At claim time, check what actually exists on trunk: the registration status names, whether #69 escapes variables (if it does, pass sections as separate variables, not pre-rendered HTML), and the `deliver` shape. Map the snapshot's `confirmed`/`enrolled` flags from the real statuses.

## Residue
- **HR-36:** announcement template copy (email, in-app, SMS short form).
- **HR-37:** announcement is a service message (follows channel preferences, ignores communications consent); an adult with no contact of their own falls back to their guardian.
- **HR-14:** a DLT template for the announcement SMS. SMS stays off until then.
- **HR-21:** help contacts are a typed field, so no `SITE.org` placeholder is baked in.
- **HR-10:** rebuild worker-preview so fan-out runs on previews.
- **HR-28:** real-device checks of the three pages.

## Test plan
- **Seam 1 world:** a competition with 2 confirmed adult individuals; 1 confirmed 15-year-old (own login) plus a guardian account; 1 confirmed institution registration with 2 coordinators and 3 enrolled students (one adult with a contact; two minor siblings sharing one contact-only guardian; a third, withdrawn); 1 pending individual registration.
- Assert on: `h.email.sent` (exact recipients), inbox rows (account holders only), the outbox row, the audit row, `h.sms`, and the dedupe after re-drain.
- **Unit:** done (36 cases).
- **Seam 2:** a signed-in seeded competition manager visits list, new and detail, with `expectRendersAccessibly` on each (`.dark` once). Listed under "Not run".

## Slices (ordered)
1. **Drafts:** schema, migration, create/update/get/list, `can()`, zod. AC 1, 10 (partial). `announcements-draft.test.ts`
2. **Preview:** `load-audience.ts`, `render.ts`, `previewAnnouncement` with counts; sends nothing. AC 2, 6. `announcements-preview.test.ts`
3. **Send:** status flip, `emit`, audit, re-send and edit refusals. AC 3, 9, 10. `announcements-send.test.ts`
4. **Fan-out:** consumer, guardian routing end to end, dedupe on retry, SMS flag. AC 4, 5, 7, 8. `announcements-fan-out.test.ts`
5. **UI and seed:** three pages, `adminAnnouncements`, seed, the e2e spec. AC 11, 12. `src/server/modules/announcements/seed.test.ts`
