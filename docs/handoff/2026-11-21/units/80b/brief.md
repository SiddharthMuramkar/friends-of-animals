# 80b: Cancelling a competition refunds everyone (#80, M1, M, risk: money + auth)

Branch `ticket/80-cancel`, worktree `/root/foa-wt/80b`, cut from `foa/M0` 442dd99 (rebase onto `foa/M1` once 80a is in it). Key X9. Blocker **80a** (refunds funnel), and through the chain 71 (status machine), 70a (competitions), 75b/77a (registrations, batches), 69 (messages), 61a (outbox), 60 (step-up). Prepped 2026-11-21 by pane foa-p80. Head start on the branch: `src/server/modules/competitions/domain/cancellation.ts` + test (pure).

## Scope
- **In (80b):** `competition_status` + `cancelled` (with `cancelled_at`, `cancel_reason`), and `registration_status` + `cancelled`, each value in this unit's migration and unused in its DDL. Use case `cancelCompetition({ competitionId, reason })` with step-up: in one transaction it moves the status, supersedes unapproved discretionary refunds, starts one `cancellation` refund per paid batch through 80a's `startSystemRefund` (no approval), cancels unpaid and free registrations and open batches, and emits one message event per affected registration and per institution registration. Status jobs (#71) for a cancelled competition become stale. The `cancelled` chip on public and admin pages. Page `/admin/competitions/[id]/cancel`. Preview seed: one cancelled competition.
- **Out:** 80a owns refund rows, the send funnel, retries, webhooks, `refunded` registrations and finance pages. Artwork returns (M2+), entry withdrawal cascades (#85+), ledger reversal (#105). Results-era statuses (M4) add their own "cannot cancel" rows.

## Decisions (reversible, recorded)
- Who: **super admin only** (prior art: cancel is SA only), with step-up. Competition managers, staff admins and finance are refused: cancelling moves money with no second person.
- From: every status except `cancelled` (draft included). `cancelled` is terminal. Later statuses add their rows (from results published on, forbidden). The 71 table gets a new cause `cancellation` so no "manager" move can reach `cancelled`.
- Registrations: unpaid (`enrolled`, `pending_payment`, `pending_guardian`) and free `confirmed` → `cancelled` at once. Paid `confirmed` stay until their refund is `refunded`, then 80a marks them `refunded`. Withdrawn stay withdrawn.
- Refunds per batch: everything not yet refunded and not held by an approved, processing or refunded refund. Unapproved (`requested`) discretionary refunds are superseded (rejected, reason `superseded_by_cancellation`) and their items join the cancellation refund. Offline-paid batches get a `manual` cancellation refund for finance to pay out.
- One message per affected registration to its family contact (guardian for a minor, adult themselves) and one per institution registration to its coordinators. A guardian with two children gets two messages, each naming the child's registration.

## Acceptance checks (Seam 1 unless marked: `h.as(actor).cancelCompetition`, PGlite + real migrations, FakeClock, FakePaymentGateway, `h.drain()`)
1. Super admin with fresh step-up cancels with a reason → status `cancelled`, `cancelled_at` = clock, reason stored; audit `competition.cancelled` (before/after status, reason). Second factor 10 min 1 s old → `step_up_required` and nothing changes.
2. Transition table: every status → `cancelled` allowed only for cause `cancellation`; `cancelled` → every status forbidden; cancelling again → `already_cancelled` with no new refund, row, audit or message. Pure + S1.
3. A competition with 3 gateway-paid batches (sizes 1, 2, 5): one `cancellation` refund per batch, approved with no approver. After drain the fake holds 3 refunds whose amounts equal each batch's remaining amount; all 8 registrations `refunded`; no finance action was needed.
4. Prior refund state (pure **done** + S1): a batch with one item already refunded and one in an approved refund → the cancellation refunds only the rest; a `requested` discretionary refund is superseded and its items are in the cancellation refund. Nothing is ever refunded twice: Σ refunds per batch ≤ captured amount.
5. Unpaid registrations → `cancelled`; open batches (`created`, `order_created`) → `cancelled`; free confirmed registrations → `cancelled` with no refund.
6. An offline-paid batch → a `manual` cancellation refund, `approved`, shown in finance's queue; 0 gateway calls for it.
7. Tells everyone: after drain, each affected registration's family contact holds one cancellation message, and each coordinator of an affected institution registration holds one; the email fake count equals registrations + coordinators. Paid registrations later also get 80a's refund notice.
8. Refunds run as jobs with retries: `cancelCompetition` itself makes 0 gateway calls. With `h.gateway.failNext(1)`, the first drain refunds all but one batch; advancing past the backoff and draining sends the last one; exactly one refund per batch.
9. Scheduled work stops: after cancelling a `published` competition, setting the clock past its open date and draining leaves it `cancelled` with no `competition.status_changed` audit row.
10. Registration is refused: 75a's window rule treats `cancelled` as closed (`registerInstitution`, `enrolStudent`, individual register all refuse `closed`). Paying for an open batch of a cancelled competition is refused.
11. Authorization: super admin passes; competition manager, staff admin, finance and member are refused, and nothing changes.
12. Public and admin pages show `cancelled` as icon plus word (pure chip/label helper test); 70b's read model keeps a cancelled competition listed with its label.
13. Seed: `seed.preview()` adds one cancelled competition with refunded and cancelled registrations; running it again changes nothing.
14. axe on `/admin/competitions/[id]/cancel`, light and dark. Seam 2, written, **Not run**.

## Files
- New: `src/server/modules/competitions/domain/cancellation.ts` + test (**done**), `src/server/modules/competitions/cancel-competition.ts` + `cancel-competition.test.ts`, `src/server/seed/competition-cancelled.ts`, `src/app/admin/competitions/[id]/cancel/**` (route-local `_components`), `messages/en-IN/competitionCancel.json`, `tests/e2e/80-cancel-competition.spec.ts`, migration `--name 80_cancel_competition`.
- Touch (X9 held): 70a's `schema/competitions.ts` (enum value, two columns), 71's `domain/status-machine.ts` (+ `cancelled`, cause `cancellation`, table test rows) and `planStatusJob` (cancelled → stale), 71's status chip messages, 70a's admin competition page (a "Cancel competition" link for super admins).
- One line each (merge queue): `registration_status` enum (Q1 file), `can()` policy (`competition.cancel`, super admin, step-up), #69 routes + templates (`registration.competition_cancelled` → family contact, `institution_registration.competition_cancelled` → coordinators), `app.ts`, `seed/index.ts`, `src/i18n/messages.ts`, `src/lib/app-routes.ts`.

## Chosen design (codebase-design; three candidates)
- **A. Cancel and refund inline.** One use case calls the gateway per batch. HTTP inside or after a long transaction, no retries, a partial failure leaves a cancelled competition with unknown refunds. Rejected.
- **B. One transaction plans and records; the relay pays (chosen).** Load the competition `FOR UPDATE`, load its registrations with batch and refund state, apply the pure `planCancellation`, then write: status, superseded requests, `startSystemRefund` per planned refund (each emits its own `refunds.send` delivery), registration and batch cancels, message events, audit. The relay sends refunds with 61a's retry and backoff, and 80a's funnel makes each send idempotent. The use case is a thin adapter; the rules (what to refund, what to cancel, what to supersede) sit in one pure function with a table of cases.
- **C. Two-phase fan-out.** The cancel transaction writes only the status and one `competition.cancellation_requested` job, whose handler creates the refunds later. Keeps the transaction tiny for huge competitions, but the refunds don't exist when the page returns and a half-done fan-out needs resume logic. Rejected at M1 sizes; revisit if one competition passes ~5,000 paid batches.

## Interface needs (code against these; adapt names, not shapes)
```ts
// 80a
startSystemRefund(tx: AppDb, ctx: UseCaseContext, r: { kind: "cancellation"; batchId: string; itemIds: string[]; reason: string; idempotencyKey: string /* `cancellation:${competitionId}:${batchId}` */ }): Promise<{ refundId: string } | { skipped: "nothing_to_refund" }>;
supersedeRequestedRefunds(tx: AppDb, ctx: UseCaseContext, r: { batchIds: string[]; reason: "superseded_by_cancellation" }): Promise<string[]>;
// rows the plan reads (one query joining registration, payment_batch_item, payment_batch, refund_item, refund)
// 71: COMPETITION_STATUSES, transitionCause(from, to), planStatusJob(...) → "stale" for a cancelled competition
// 70a: loadForUpdate(tx, competitionId) → { id, status, code }; competition columns cancelledAt, cancelReason (added here)
// 75a: registrationWindow(status) → "closed" for cancelled; institutionRegistration{id, competitionId}; coordinatorsOf(db, institutionId)
// 77a: paymentBatch.status ⊇ "created" | "order_created" | "captured" | "cancelled"; nextPaymentBatchStatus(from, "superseded")
// 59a/60: can(ctx, "competition.cancel", { scopes: [{ type: "competition", id }] }) with step-up; writeAudit
// 61a/69: emit(tx, clock, { type: "registration.competition_cancelled", aggregateType: "registration", aggregateId, payload: { competitionId, refund: "gateway" | "manual" | "none" } })
```

## Residue
- **HR-34:** who may cancel (super admin only), cancellable statuses, cancellation copy.
- **HR-10/M1:** `refunds.send` and the new message events run on previews only after `worker-preview` is rebuilt (or via 61a's preview drain route).
- **HR-09:** Razorpay test refunds on staging (rides on 80a).

## Test plan
Pure (**done**): `domain/cancellation.test.ts` (refund remaining items, supersede requested, keep approved, cancel unpaid/free, offline → manual, withdrawn untouched, already refunded skipped, nothing to refund). Seam 1: `cancel-competition.test.ts` (AC 1–11, 13); 71's `status-machine.test.ts` gains the `cancelled` rows (AC 2). Seam 2 + axe: `tests/e2e/80-cancel-competition.spec.ts`, **Not run**.

## Slices (size M: one)
0. **Done:** `planCancellation` (pure).
1. Cancel a competition: enum values + columns, status table rows, `cancelCompetition` with step-up and authz, refunds through 80a, cancels, message events, stale status jobs, chip, seed, page, namespace, Seam 2 spec (AC 1–14). → `src/server/modules/competitions/cancel-competition.test.ts` + `tests/e2e/80-cancel-competition.spec.ts`
