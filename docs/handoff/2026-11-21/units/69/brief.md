# Unit 69: message templates, in-app inbox and channel preferences

M1 · L · risk (auth/security, personal data, infra) · key X5 · branch `ticket/69-message-templates-in-app-inbox` · worktree `/root/foa-wt/69` · blockers 58, 62, 64 (and through them 57, 59, 60, 61). No siblings: this unit owns the whole ticket. Base `foa/M0` today; rebase onto `foa/M1` when the build pane starts.

## Scope
**In:** the Notifications module `src/server/modules/notifications/`:
- templates staff edit without a deploy (email, SMS, in-app);
- `message_route` rows mapping each outbox event to its messages, with #61's welcome email moved onto them;
- a dispatcher the worker runs for every outbox event;
- the in-app inbox (unread count, mark read, mark all read);
- email/SMS preferences with a required-by-law override;
- SMS gated by `sms.enabled` and the template's DLT id, with email and in-app covering for it;
- seed data, 4 pages, the header unread badge.

**Out:** guardian audiences for minors (#81 adds a resolver and rows), reminders and announcements (#84), digests, quiet hours, frequency caps, provider delivery webhooks, unsubscribe links (#126), the rich-text sanitiser (#111). Template bodies stay plain text.

## Acceptance checks (seam)
1. **Edit, then the next message uses it** (S1). `as(contentManager).updateMessageTemplate({ key: "identity.welcome", channel: "email", subject, body })`, then a sign-up, then `h.drain()`. `h.email.lastTo(addr)` has the new subject and text. The version goes up by 1, and one `audit_log` row holds before and after.
2. **Mapped event sends, unmapped sends nothing** (S1). With a route row, `emit` + `drain` delivers email and an inbox item. An event type with no row (or a row with `enabled=false`) delivers nothing to email, SMS or the inbox. The welcome regression now runs through the map, and #61's hard-coded handler is gone.
3. **Inbox** (S1). After a drain, `listInbox` shows the item newest first and `countUnread` = 1. `markInboxItemRead` makes it 0, and so does `markAllInboxRead`. Another user's `markInboxItemRead(id)` fails `not_found`, and their list doesn't contain the item.
4. **SMS turned off, legal messages still go** (S1). With `sms.enabled` on and preferences `{ email: true, sms: false }`: a normal route sends no SMS but does send the email. A `required_by_law` route sends the SMS.
5. **Flag off means no SMS at the port** (S1). With `sms.enabled` false, `h.sms.sent` stays empty for normal and required routes, even with the SMS preference on. An SMS-only route instead delivers an email and an inbox item.
6. **Each message is delivered once** (S1). Draining twice, or the relay redelivering the same outbox event, gives one delivery per (event, recipient, channel), enforced by a unique index on `message_delivery`.
7. **Safe templates** (S1 + unit). An unknown `{{placeholder}}` is refused `invalid_template` and nothing is written. Variable values are HTML-escaped in the email HTML. Editing an SMS body clears `dlt_template_id`, and SMS for that key is suppressed `sms_unregistered` (email covers) until someone sets an id again.
8. **Authorization** (S1). Template use cases: `content_manager` passes; `member` and `staff_admin` fail `forbidden` and nothing is written. `super_admin` follows #59's global rule. Inbox and preference use cases: a user passes and a visitor fails `forbidden`.
9. **Seed** (S1). Running `seedPreview` twice gives the same templates, routes, preferences and inbox rows. Every seeded member has at least 1 unread and 1 read inbox item.
10. **axe** (S2, written, Not run). `expectRendersAccessibly` passes in light and dark on `/admin/templates`, `/admin/templates/[key]`, `/account/inbox` and `/account/notifications`.
11. **Header badge** (S2). A signed-in member sees an unread count that says what it counts in words, not by colour alone, and it drops after mark-read.

## Design (codebase-design; three interfaces compared)
- **A. Code event catalogue, with only the copy in the DB.** Routes, audiences and channels live in TS and templates in the DB. Payloads are typed and route changes are reviewed in a PR. But it fails AC2's "mapping row" literally, and disabling a route needs a deploy.
- **B. DB route rows plus typed code registries (chosen).** `message_route` rows hold event type, audience, template key, channels, `required_by_law` and `enabled`. Code holds two small registries: event context loaders (event type → payload zod plus the variables it provides) and audience resolvers (audience key → user ids plus per-recipient variables).
  - Callers never call Notifications: they `emit(tx, event)` (#61), and one outbox subscriber runs `dispatchEvent(deps, event)`.
  - That one deep function hides route lookup, audience resolution, preference, consent and flag reads, `planDelivery`, rendering, idempotent `message_delivery` rows, the port calls and inbox inserts.
  - Later tickets add one resolver (#81 `guardian_of_participant`, #75 `institution_coordinators`) and seed rows.
- **C. Callers call `notify(tx, { template, to, vars })` directly.** It is the shallowest: every caller re-implements audiences and preferences, and AC2 has no table at all.

**Why B.** It has the smallest interface for producers (`emit` only), it meets AC2 literally, and its internal seams are testable: `planDelivery` and `renderTemplate` are pure.

**Invariants:**
- Every template key has `email` and `in_app` rows (cover). `sms` is optional.
- A template's declared `variables` are set by code or seed, never by the editor. Edits are checked against them.
- A seed contract test proves every route's event loader provides its template's variables.

**Channel rule (pure `planDelivery`):**
- Required-by-law routes use the route's channels and ignore preferences.
- Other routes use route channels ∩ preferences, and withdrawn messages consent (#64) drops their email and SMS.
- If SMS was asked for but doesn't go out (preference, flag, no DLT id, no verified phone), email and in-app are added as cover.
- In-app is never a preference.
- Suppressed channels get a `message_delivery` row with `status='suppressed'` and a reason.

## Interface needs (what the build codes against; adapt to the merged names)
```ts
// #61 outbox (61a)
type OutboxEvent = { id: string; eventType: string; aggregateType: string; aggregateId: string; payload: unknown; occurredAt: Date };
declare function emit(tx: AppDb, clock: Clock, e: Omit<OutboxEvent, "id" | "occurredAt">): Promise<string>;
type OutboxSubscriber = { name: string; handle(deps: Deps, event: OutboxEvent): Promise<void> }; // at-least-once
// append { name: "notifications", handle: dispatchEvent } to the subscriber registry; Harness.drain(): Promise<void>
// #58 SMS port: Deps.sms, Harness.sms (FakeSms: sent, lastTo, failNext)
type SmsMessage = { to: string /* E.164 */; text: string; dltTemplateId: string }; // append dltTemplateId if absent
interface SmsSender { send(m: SmsMessage): Promise<void> }
declare function readVerifiedPhone(db: AppDb, userId: string): Promise<string | null>; // decrypts, E.164
// #62 settings
declare function getSetting(db: AppDb, key: "sms.enabled"): Promise<boolean>; // default false; harness/seed can set it
// #59 roles, policy, audit
declare function can(actor: Actor, action: `notifications.${"templates.read" | "templates.edit" | "inbox.read" | "preferences.edit"}`): boolean;
declare function writeAudit(tx: AppDb, actor: Actor, e: { action: string; entityType: string; entityId: string; before: unknown; after: unknown }): Promise<void>;
// seed builder for staff: h.seed.staff({ role: "content_manager" }) with a fresh second factor (#60)
// #64 consent: true when the latest event for purpose "messages" is "given"
declare function hasMessagesConsent(db: AppDb, userId: string): Promise<boolean>;
```
If #60's staff gate lives in `can()`, the template tests use a staff actor with a fresh second factor.

## Files
- **New:**
  - `src/server/db/schema/notifications.ts`: enums `message_channel`, `message_delivery_status`; tables `message_template` (unique key+channel+locale, `version`, `variables` jsonb, `dlt_template_id`), `message_route`, `message_delivery` (unique `outbox_event_id`+`user_id`+`channel`), `inbox_item` (index on `user_id`, `read_at`, `created_at` desc), `notification_preference`;
  - one generated migration `69_notifications`;
  - `src/server/modules/notifications/{domain/*,use-cases/*,dispatch.ts,audiences.ts,events.ts,index.ts}`;
  - `src/server/seed/notifications.ts`;
  - `src/app/admin/templates/**` (or #59b's `(staff)` group);
  - `src/app/account/{inbox,notifications}/**` (verify #57's prefix);
  - namespaces `inbox`, `notificationSettings`, `adminTemplates`;
  - `tests/e2e/69-messages.spec.ts`.
- **Hotspots (append one line each):**
  - `schema/index.ts`, `seed/index.ts` (`seeders`, after identity), `src/server/app.ts` (`composeUseCases`);
  - #61's subscriber registry and welcome handler (delete);
  - `src/i18n/messages.ts`, the route registry and `SIGNED_IN_PREFIXES`;
  - **X5** `site-header.tsx`/`header-nav.tsx` (badge; serialize with 73/78/81a);
  - the `can()` rules file;
  - the data inventory, if it exists by then (`inbox_item`, `message_delivery`).
- **No new port and no X1 edit:** in-app is internal, and SMS comes from #58.

## Residue
- **HR-14:** DLT registration for every SMS template, then fill in `dlt_template_id`. `sms.enabled` stays off until then. SMS rows are seeded without ids, so they're suppressed and covered.
- **HR-33:** counsel confirms the required-by-law list. The default rows, marked to confirm: consent receipts, payment receipts, refund notices, safeguarding notices (OTP bypasses the outbox). FOA also approves the default template copy, which is seeded as drafts.
- **HR-10:** redeploy `worker-preview` from M1's tip so the new dispatcher runs on previews. Seam 2 never depends on a drained message: seeded inbox rows only.
- **HR-28:** real-device checks on the 4 pages.
- **HR-31:** retention of inbox bodies and delivery rows, to confirm.

## Test plan
- **Unit (now):** `domain/*.test.ts` for placeholder parsing, unknown-variable refusal, HTML escaping, the revision rules (subject only on email and in-app; the DLT id cleared when the SMS body changes), the `planDelivery` truth table, and inbox link safety.
- **Seam 1** (`createHarness`, real migrations, fake clock, email/SMS fakes, drain): one test file per slice below. No mocks of internal modules.
- **Seam 2:** axe on the 4 pages plus the badge. Written but Not run here (no Postgres; previews fail at `db:migrate`).

## Slices (ordered; each is one behaviour and one test file)
1. **S1 templates.** Schema, migration, `listMessageTemplates`, `getMessageTemplate`, `updateMessageTemplate` with versioning, audit and authz. Proves 7, 8 (templates). `use-cases/templates.test.ts`
2. **S2 dispatch.** Routes, event loaders, the `subject_user` audience, the `dispatchEvent` subscriber, email and in-app delivery, idempotency, welcome moved onto the map. Proves 1, 2, 6. `dispatch.test.ts`
3. **S3 inbox.** `listInbox`, `countUnread`, `markInboxItemRead`, `markAllInboxRead`, owner isolation, authz. Proves 3, 8 (inbox). `use-cases/inbox.test.ts`
4. **S4 channels.** `getNotificationPreferences`, `updateNotificationPreferences`, SMS through #58's port, flag, DLT, required-by-law, cover. Proves 4, 5. `channels.test.ts`
5. **S5 surfaces.** Seeder, 4 pages, header badge, namespaces, Seam 2 spec. Proves 9, 10, 11. `src/server/seed/notifications.test.ts` + `tests/e2e/69-messages.spec.ts`

## Head start already on the branch
Commit `6fe1c07` on `ticket/69-message-templates-in-app-inbox`, based on `foa/M0` 442dd99. The pure core lives under `src/server/modules/notifications/domain/`, with 47 unit tests:
- `template.ts`: `templatePlaceholders`, `checkTemplate`, `renderTemplate`, `renderEmailHtml`;
- `revision.ts`: `reviseTemplate`;
- `delivery-plan.ts`: `planDelivery`;
- `inbox-link.ts`: `isInboxLink`;
- `channels.ts`: `MESSAGE_CHANNELS`, which the schema's `pgEnum` reuses.

Slices 1, 2 and 4 import these as they are.
