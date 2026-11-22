# 80a: Refunds approved by finance (#80, M1, L, risk: money + auth)

Branch `ticket/80-refunds`, worktree `/root/foa-wt/80a`, cut from `foa/M0` 442dd99 (rebase onto `foa/M1` once 79 is in it). Key X10. Blocker 79 (and through it 77a, 78, 63a, 60, 59a, 61a, 69). Sibling **80b** (cancel a competition) is blocked by this unit and calls its `startSystemRefund`. Prepped 2026-11-21 by pane foa-p80. Head start on the branch: `src/server/payments/domain/{refund-status,refund-plan,refund-sync}.ts` + tests (pure).

## Scope
- **In (80a):** `refund` + `refund_item` tables, `refund_status` + `refund_kind` enums, `registration_status` + `refunded`. Use cases `requestRefund` (whole batch or listed items), `approveRefund`, `rejectRefund`, `retryRefund`, `recordManualRefund`, `listRefunds`, `getRefund`. One send/sync funnel used by approval, system refunds, retries and refund webhooks. Gateway port gains `refund` + `fetchRefunds`; the fake and the contract grow with it. The duplicate path: #79's review resolution gains outcome `refund`, which refunds without approval. Internal `startSystemRefund` for 80b. Audit rows, `refund.processed`/`refund.failed` events + templates, preview seed, three admin pages, `refunds` namespace.
- **Out:** 80b owns `cancelled` competitions, the cancel use case and page, mass cancellation refunds, notifying registrants, `registration_status` + `cancelled`. 77b implements the Razorpay `refund`/`fetchRefunds` calls and subscribes `refund.*` webhooks (verify event names and the idempotency header against Razorpay docs then, never from memory). #105 posts ledger reversals off `refund.processed`. Dual approval above a threshold (prior art) is not in the ticket: not built.

## Decisions (reversible, recorded)
- Payment batch status is **not** extended: a batch's refunded or partly refunded state is derived from its refund rows, so 77a/79's batch enum and machine stay untouched. Only `registration_status` gets `refunded`, in this unit's generated migration and never used in its DDL.
- A registration becomes `refunded` only when a refund listing its item reaches `refunded`. Duplicate refunds list no items and change no registration (the registrations stay paid by the other batch).
- Discretionary requests need a reason (1–500 chars). The policy "no refunds after confirmation, except cancellation or duplicates" is shown on the approval page; finance decides (HR-34).
- Roles: request = competition manager (that competition, or global), staff admin, super admin. Approve, reject, retry, record manual = **finance only**, all with step-up (#60 flag). Read = all of those. The requester can never approve or reject their own request.
- Offline-paid batches (79's capture method): approval moves to `approved`, method `manual`. Finance then records method + reference and it is `refunded` at once. No gateway call.
- Gateway idempotency key = our refund id (also sent in notes as `refundId`). Before any send, the funnel lists the payment's gateway refunds and adopts one carrying our id, so a lost response never pays twice.

## Acceptance checks (Seam 1 unless marked: `h.as(actor).<useCase>`, PGlite + real migrations, FakeClock, FakePaymentGateway, `h.drain()`)
1. `requestRefund({ batchId, reason })` on a captured batch → `requested`, items = every batch item, amount = batch amount. Audit `refund.requested`. The fake has 0 refunds.
2. Partial: request 2 of 5 item ids → amount = Σ those two. After approval and drain, only those 2 registrations are `refunded`; the other 3 stay `confirmed`.
3. Step-up: finance whose second factor is 10 min 1 s old → `step_up_required`; the refund stays `requested`, no gateway call, no audit row. At 9 min 59 s → `approved`. Drain → the fake holds 1 refund for the exact amount with idempotency key = refund id; refund `refunded`; registrations `refunded`; audit `refund.approved`, `refund.sent`, `refund.refunded`.
4. `rejectRefund({ refundId, note })` (step-up) → `rejected`, items released (requesting them again works), audit row, no gateway call. Empty note refused.
5. Separation of duties: a user holding staff admin and finance requests, then approves (or rejects) their own refund → `same_person`; nothing changes.
6. Guards → refusal codes: item already in a live refund `item_in_live_refund`; already refunded `item_already_refunded`; item of another batch `unknown_item`; batch not captured `batch_not_captured`; no items `empty`; zero total `nothing_to_refund`. A direct second live hold on one item fails the partial unique index.
7. Other refunds can't skip approval: `requestRefund` with `kind` or `status` in its input → `invalid_input` (strict zod). No use case on `as(actor)` creates an approved refund for a person: `"startSystemRefund" in h.as(finance)` is false.
8. Duplicate: `resolvePaymentReview({ caseId, outcome: "refund", reason })` on an `already_paid` case → a `duplicate` refund, approved at once (no approver), for the duplicate payment's full amount. After drain the fake holds it, and the registrations stay `confirmed`.
9. Gateway outcomes: fake answers `pending` → `processing`; a `refund.processed` webhook → `refunded`; `refund.failed` → `failed` + a `refund.failed` event; replaying an event id → `duplicate`, rows/audit/outbox identical; bad signature → `rejected`; webhook before or after the drain gives one outcome.
10. Retry safety: the fake records a refund and then throws (lost response) → the next drain adopts it through `fetchRefunds`; the fake has exactly 1 refund. `retryRefund` on `failed` (finance, step-up) sends once more.
11. Offline-paid batch: approval → `approved` (manual); `recordManualRefund({ refundId, method, reference })` → `refunded`, registrations `refunded`, 0 gateway calls; empty reference refused.
12. Transition table (pure, **done**): every `(status, event)` pair, `initialRefundStatus` per kind, terminal statuses.
13. Authorization: `requestRefund` passes for that competition's manager and staff admin; refused for a coordinator, a member and another competition's manager. `approveRefund`/`rejectRefund`/`retryRefund`/`recordManualRefund` pass for finance; refused for competition manager and staff admin. `listRefunds`/`getRefund`: finance passes, member refused. `resolvePaymentReview` with `refund`: finance passes, coordinator refused.
14. Audit: request, approve, reject, send, refunded, failed, manual record, each with actor and before/after; no payer PII in `after`.
15. Messages: `refund.processed` is emitted in the transaction that marks the refund `refunded`; after drain the payer (coordinator or individual) holds the refund notice (#69 route + template).
16. Seed: `seed.preview()` adds one `requested` refund (pending), one `refunded` whole-batch refund and one partial refund; running it again changes nothing.
17. axe on `/admin/payments/batches/[id]/refund`, `/admin/refunds`, `/admin/refunds/[id]`, light and dark. Seam 2, written, **Not run**.

## Files
- New: `src/server/db/schema/refunds.ts` (`refund`: id, batch_id FK, gateway_payment_id null for offline, kind, status, method gateway|manual, amount_minor bigint, currency, reason, requested_by null for system, requested_at, decided_by, decided_at, decision_note, idempotency_key unique, gateway_refund_id unique, manual_method, manual_reference, sent_at, refunded_at, failure_code; `refund_item`: refund_id, batch_item_id, amount_minor, released_at; unique `(batch_item_id) WHERE released_at IS NULL`). `src/server/payments/refunds/{index,request-refund,decide-refund,retry-refund,record-manual-refund,send-refund,start-system-refund,list-refunds}.ts` + Seam 1 tests. `src/server/seed/refunds.ts`. `src/app/admin/refunds/**`, `src/app/admin/payments/batches/[id]/refund/**`. `messages/en-IN/refunds.json`. `tests/e2e/80-refunds.spec.ts`. Migration `--name 80_refunds`.
- Touch (X10 held): 77a's `ports/payment-gateway.ts` + contract, `src/test/fakes/payment-gateway.ts`, `receive-gateway-webhook.ts` (refund hint → `syncRefund`); 79's `resolvePaymentReview` (outcome `refund`).
- One line each (merge queue): `schema/index.ts`, `seed/index.ts`, `app.ts` `composeUseCases`, the `can()` policy (actions `refund.request|approve|reject|retry|record_manual|read`, `payment_review.resolve_refund`, step-up flags), outbox handler registry (`refunds.send`), #69 routes + templates, `src/i18n/messages.ts`, `src/lib/app-routes.ts`, data inventory (`refund.reason`, `manual_reference`), `registration_status` enum (Q1 file).

## Chosen design (codebase-design; three candidates)
- **A. Inline send in each use case.** Approval calls the gateway after its transaction; 80b and duplicates copy the call. Shallow: three callers own retry, lost-response and webhook rules. Rejected.
- **B. Refund funnel through the outbox (chosen).** Every path ends in a committed `approved` refund plus one `refunds.send` delivery in the same transaction. The relay (61a) runs `sendRefund(deps, refundId)`: list the payment's gateway refunds, adopt ours or call `refund`, then apply the pure `decideRefundSync` in a transaction holding `FOR UPDATE` on the refund (mark refunded, release or refund registrations, audit, outbox). Webhooks and retries call the same `syncRefund`. The interface is small (`requestRefund`, `decideRefund`, `startSystemRefund`, `syncRefund`); retries, backoff and mass sends come from the relay; no HTTP inside a transaction; order and count of signals don't matter. Mirrors 77a's capture funnel.
- **C. Reconciliation-first.** A periodic sweep compares approved refunds with the gateway. Strongest drift detection, but the relay plus adopt-before-send already covers a lost response; a sweep can call `syncRefund` later. Rejected for now.

## Interface needs (code against these; adapt names, not shapes)
```ts
// 77a port additions (this unit adds them; 77b implements Razorpay)
type GatewayRefund = { id: string; paymentId: string; amountMinor: bigint; currency: string; status: "pending" | "processed" | "failed"; notes: Record<string, string> };
interface PaymentGateway { /* 77a … */ refund(r: { paymentId: string; amount: Money; idempotencyKey: string; notes: Record<string, string> }): Promise<GatewayRefund>; fetchRefunds(paymentId: string): Promise<GatewayRefund[]>;
  readWebhook(raw: string, h: Headers): { eventId: string; type: string; orderId: string | null; paymentId: string | null; refundId: string | null } | null }
// 77a tables: paymentBatch{id, status, amountMinor, currency, gatewayPaymentId, payerUserId}; paymentBatchItem{id, batchId, registrationId, amountMinor, releasedAt}
// 79: paymentBatch.captureMethod "gateway" | "offline"; paymentReviewCase{id, batchId, reason, gatewayPaymentId, resolvedAt}; resolvePaymentReview(ctx, { caseId, outcome, reason })
// 59a/60: can(ctx, action, resource) throws DomainError("forbidden" | "step_up_required"); POLICY[action].secondFactor = "step-up"; writeAudit(tx, ctx, entry)
// 61a: emit(tx, clock, { type, aggregateType, aggregateId, payload }); handler registry entry "refunds.send"; h.drain()
// 75b/77a: registration.status ⊇ "confirmed"; canTransitionRegistration(from, to)
// harness: h.signIn(user) with h.stepUp(actor) (fresh second factor), h.seed.finance(), h.seed.competitionManager({ competitionId }), h.seed.capturedBatch({ items: n })
```
Exported for 80b and 79: `startSystemRefund(tx: AppDb, ctx: UseCaseContext, r: { kind: "cancellation" | "duplicate"; batchId: string; itemIds?: string[]; gatewayPaymentId?: string; reason: string; idempotencyKey: string }): Promise<{ refundId: string } | { skipped: "nothing_to_refund" }>` and `supersedeRequestedRefunds(tx, ctx, { batchIds: string[]; reason: string }): Promise<string[]>`.

## Residue
- **HR-34:** refund policy default (no refunds after confirmation except cancellation/duplicates; discretionary refunds by finance approval), finance-only approval, no dual-approval threshold.
- **HR-09:** Razorpay test-mode refunds and `refund.*` webhooks on staging. **HR-15:** live refunds.
- **HR-10/M1:** the `refunds.send` handler runs on previews only after `worker-preview` is rebuilt (or via 61a's preview drain route).
- **HR-31:** retention of refund reason and manual reference (financial floor 8 y), inventory rows `toConfirm`.

## Test plan
Pure (**done**): `refund-status.test.ts`, `refund-plan.test.ts`, `refund-sync.test.ts`. Seam 1: the slice files below, fake clock only, step-up via the harness. Contract: the gateway contract gains refund cases run by the fake (and by 77b's adapters). Seam 2 + axe: `tests/e2e/80-refunds.spec.ts`, **Not run** (no Postgres server; previews fail at `pnpm db:migrate`).

## Slices (ordered; each one behaviour, one test file)
0. **Done:** refund machine, request planning, sync decision (pure).
1. Schema, `requestRefund` whole or partial with guards, authz, audit (AC 1, 6, 7, 13 request, 14). → `src/server/payments/refunds/request-refund.test.ts`
2. Approve/reject with step-up and separation of duties; port `refund` + fake; `refunds.send` funnel; registrations refunded (AC 2, 3, 4, 5, 13 decide). → `decide-refund.test.ts`
3. Gateway outcomes: pending, refund webhooks, failed + retry, adopt after a lost response, manual refund for offline batches (AC 9, 10, 11). → `refund-sync.test.ts`
4. Duplicate path through #79's resolution and `startSystemRefund` (AC 7, 8, 13 resolve). → `duplicate-refund.test.ts`
5. Messages, preview seed, three pages, `refunds` namespace, Seam 2 spec (AC 15, 16, 17). → `refund-messages.test.ts` + `tests/e2e/80-refunds.spec.ts`
