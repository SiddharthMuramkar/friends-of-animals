# 77a: Bulk fee payment, payments core (#77, M1, L, risk)

Branch `ticket/77-payments-core`, worktree `/root/foa-wt/77a`. Blockers: 72 (fees), 75b (registration, profiles). Key X10.
Head start on the branch (cut from `foa/M0`, pure, no schema): `src/server/payments/domain/{batch-status,batch-amount,capture-decision}.ts` + tests.

## Scope
- **In (77a):** the Payments module. A `PaymentGateway` port with an in-memory fake and a webhook simulator (valid and invalid signatures, replays), and a shared contract. Tables `payment_batch`, `payment_batch_item`, `gateway_webhook_event`. Use cases: pay an institution's fees (one order per batch), confirm the Checkout return, receive a gateway webhook, read a batch. One capture path that confirms every registration and gives each a `{comp}-R-{6}` number. Free competitions confirm with no order. Outbox events for the receipt and confirmations. Audit rows. The payment-batch and registration transition tables. A preview seed with paid and unpaid batches. Production wiring is `unconfiguredPaymentGateway`, which refuses everything, the same pattern as email.
- **Out:** 77b owns the Razorpay adapter (fetch, no SDK), the non-production fallback adapter, env vars, the webhook route, the pay and status pages, the Checkout island, CSP allowances and the `payments` messages namespace. 77c owns the Seam 2 journey (30-row CSV → pay → 30 confirmed) and the coordinator dashboard's pay link. #79 adds offline capture and `needs_review`. #80 adds refunds. #105 adds ledger postings. Donation receipt numbers (`FOA-RCPT-…`) belong to #106 and are not introduced here.

## Acceptance checks (all Seam 1: `h.as(actor).<useCase>` on PGlite + real migrations, FakeClock, FakePaymentGateway)
1. `payInstitutionFees` for N payable registrations creates one batch, N items, and exactly one fake order for N × the institution fee (bigint paise, receipt = batch id).
2. A `payment.captured` webhook for that order makes every registration `confirmed`, each with a unique number matching `^[A-Z]{3,6}\d{2}-R-[0-9A-HJKMNP-TV-Z]{6}$`. The batch becomes `captured` with `captured_at` = clock.
3. `confirmCheckout` with a valid signature does the same. With an invalid signature it is refused, and no row, audit row or outbox row changes.
4. Replaying the same webhook (same event id) returns `duplicate`, and rows, audit rows and outbox rows stay identical.
5. A webhook with a bad or missing signature returns `rejected` and stores nothing.
6. Webhook and Checkout return in either order (or twice each) confirm once: one set of numbers, one `payment.batch_captured` event.
7. Free competition (fee 0): `payInstitutionFees` confirms the registrations at once and the fake has 0 orders.
8. The capture transaction writes `payment.batch_captured` (receipt to the payer) and one `registration.confirmed` per registration (confirmation to the family contact) to the outbox. After `h.drain()`, the fakes hold the receipt and N confirmations (#69 map rows plus templates).
9. Transition tables: payment batch (done, pure). Registration: `<#75 unpaid status> → confirmed` on capture or free confirm. `confirmed → confirmed` and confirming a withdrawn or cancelled registration are refused.
10. Paying again with the same payable set reuses the open order. A changed set (students added) supersedes the old batch (`cancelled`, items released) and opens a new one. The DB refuses two holding items for one registration (partial unique index, tested with a direct insert).
11. A captured amount ≠ the batch amount means nothing is confirmed, the batch stays `order_created`, and an audit row records the mismatch.
12. A capture on a `cancelled` or `failed` batch confirms nothing. The webhook row is kept with outcome `not_payable`, the seam #79 turns into `needs_review`.
13. Authorization, per use case: the institution's coordinator and institution admin pass. Another institution's coordinator and a plain member are refused. `receiveGatewayWebhook` runs as a visitor, and its signature is the authorization: valid passes, invalid fails.
14. Audit rows: batch created, batch captured, and each registration confirmed (actor, before and after).
15. `seed.preview()` adds one paid and one unpaid batch, and running it again changes nothing.

## Files
New: `src/server/payments/{index.ts (paymentsUseCases), pay-institution-fees.ts, confirm-checkout.ts, receive-gateway-webhook.ts, get-payment-batch.ts, sync-batch.ts}`, `src/server/payments/domain/*` (done), `src/server/ports/payment-gateway.ts` (+ `.contract.ts`, `unconfiguredPaymentGateway`), `src/test/fakes/payment-gateway.ts`, `src/server/db/schema/payments.ts`, `src/server/seed/payments.ts`, `src/server/registration/confirm.ts`, migration `drizzle/NNNN_77_payments_core.sql`.
Hotspots (serialize or one line each): `src/server/deps.ts`, `src/test/harness.ts` (X1: `payments` dep, `h.gateway`), `src/server/app.ts` (one `composeUseCases` entry), `schema/index.ts` + `seed/index.ts` barrels, `registration_status` enum (#75's file), the `can()` policy (#59), the event→message map and templates (#69), the data inventory (#73), `drizzle/meta/*` (regenerated in the merge queue).

## Design (compared with codebase-design)
- **A. Signal-applies-payload:** each signal (Checkout return, each webhook type) runs its own transition from its payload. The interface is shallow (one handler per event type), and out-of-order events (`failed` after `captured`, repeated attempts) need per-type rules.
- **B. Gateway-truth funnel (chosen):** every signal is only a hint naming an order. `syncBatch(ctx, batchId)` fetches the order's payments through the port outside any transaction. In one transaction (`SELECT … FOR UPDATE` on the batch) it applies the pure `decideCapture` (head start), then `confirmRegistrations`, audit and outbox. Three entry points share one deep decision. It doesn't depend on event order or count, it is idempotent by construction, and #79 (offline, sweep) and #80 reuse the same funnel. The webhook table only dedupes and records outcomes.
- **C. Event-sourced gateway log:** every gateway event is appended and folded per batch. This gives the strongest history, but it adds a reducer and replay tooling the ledger (#105) already covers. Rejected as more interface for no AC.
- Holding: `payment_batch_item.released_at` null while the batch holds its registrations (`holdsRegistrations`). Unique index `(registration_id) WHERE released_at IS NULL`. It uses no enum value in DDL, so a migration that adds enum values stays safe.
- Order creation: tx1 inserts the batch and items (`created`), then `gateway.createOrder`, then tx2 records `order_opened` and `gateway_order_id` (or `order_refused` → `failed`, items released). No transaction stays open across HTTP.
- Registration numbers: generated in the capture transaction with #73's codes module. Each try runs in a savepoint (`tx.transaction`), so a 23505 retry doesn't abort the capture.
- `gateway_webhook_event` stores provider, event id (unique), type, order id, outcome and times. It never stores the raw payload, which carries the payer's email and phone.

## Interface needs (code against these; adjust to what lands)
```ts
// #72 fees
getCompetitionFee(db: AppDb, q: { competitionId: string; route: "institution" | "individual" }): Promise<{ amountMinor: bigint; currency: "INR" } | null>; // 0n = free
// #75a/#75b tables: institutionRegistration{id, institutionId, competitionId, reference}; registration{id, competitionId,
//   institutionRegistrationId, participantProfileId, status: registration_status, registrationNumber: string | null (unique)}
listPayableRegistrations(db: AppDb, institutionRegistrationId: string): Promise<{ id: string; competitionId: string }[]>;
familyContactFor(db: AppDb, participantProfileId: string): Promise<{ email: string | null; phone: string | null }>; // guardian for minors
// #70: competition.code, e.g. "PAWS26"
// #73 codes
makeCode(spec: { prefix: string; length: number }, random?: () => Uint8Array): string; // Crockford, no I L O U
// #59
can(actor: Actor, action: "payments.pay" | "payments.read", resource: { kind: "institution"; id: string }): Promise<boolean>;
writeAudit(tx: AppDb, entry: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; actor: Actor }): Promise<void>;
// #61
emit(tx: AppDb, event: { type: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> }): Promise<void>;
// harness: h.drain(), h.seed.verifiedInstitution(), h.seed.coordinator(), h.seed.enrolledStudents(n, { competition })
```
Port this unit adds (77b implements it):
```ts
export interface PaymentGateway {
  readonly name: "razorpay" | "razorpay-test" | "fallback" | "fake" | "unconfigured";
  createOrder(o: { amount: Money; receipt: string; notes: Record<string, string> }): Promise<{ orderId: string }>;
  checkout(o: { orderId: string; amount: Money; description: string }): CheckoutParams; // what the browser opens
  verifyCheckout(r: { orderId: string; paymentId: string; signature: string }): boolean; // orderId from our row
  readWebhook(rawBody: string, headers: Headers): { eventId: string; type: string; orderId: string | null } | null; // null = bad signature
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
}
```

## Residue
- HR-31: retention of payer and payment records, with a financial floor of 8 years. Inventory rows are marked `toConfirm`.
- HR-34: fee amounts are FOA data entry. The seed uses sample fees.

## Test plan
The pure tables are done: 42 tests. Seam 1 files are in the slices. Contract: `payment-gateway.contract.ts` run by the fake (77a) and by both 77b adapters. No Seam 2 here (77c). Not run: none expected beyond the build gate.

## Slices
1. Port, fake and contract, harness wiring, `payInstitutionFees` → one order for Σ (AC 1, 13 pay). Test: `src/server/payments/pay-institution-fees.test.ts`.
2. Webhook funnel: event table, `syncBatch`, `confirmRegistrations`, numbers, audit (AC 2, 4, 5, 11, 12, 14). Test: `receive-gateway-webhook.test.ts`.
3. Checkout return and `getPaymentBatch` (AC 3, 6, 13 read and confirm). Test: `confirm-checkout.test.ts`.
4. Free confirm, outbox events plus #69 templates, drain, preview seed (AC 7, 8, 15). Test: `payment-messages.test.ts`.
5. Registration transition table, pay-again or supersede, partial unique index (AC 9, 10). Test: `pay-again.test.ts`.
