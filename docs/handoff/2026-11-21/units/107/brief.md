# 107: Recurring donations (#107, M5, L, risk: money + auth + Checkout)

Branch `ticket/107-recurring-donations`, worktree `/root/foa-wt/107`, cut from `foa/M0` 442dd99 (rebase onto `foa/M5` once 106b is in it). Blocker 106b, and through it 106a, 105, 80a, 77a/77b, 81b, 69, 62, 61, 60, 59. No siblings. Keys: none assigned, **but this unit edits the Payments port, fake and adapters (X10/H14/H36)**: serialize with open Payments work. Prepped 2026-11-21 by pane foa-p107.
Head start on the branch (pure, 88 tests): `src/server/modules/donations/recurring/domain/{recurring-status,recurring-sync}.ts`.

## Scope
- **In:** monthly donations on Razorpay Subscriptions: plan per amount, subscription, Checkout authorisation (reusing 106b's island), a gateway-truth sync that turns each captured charge into a donation through 106a's capture path, failed-charge notices, halted/completed/expired mirroring, donor and finance cancellation with refund of any charge that lands after the request, a 24 h sweeper for abandoned mandates, the port's subscription methods in the fake, the contract, the Razorpay adapter and the fallback adapter, `donorDashboard` pages, a finance list, seed, messages.
- **Out:** 106a owns `donor`, `donation` (incl. `recurring_donation_id`, `gateway_payment_id` unique), `donation_status`, receipts and FY numbering, `decideDonationCapture` (FCRA, amount), `donation.captured` → ledger + thank-you. 106b owns `/donate`, the checkout route and island, receipt pages and reissue. 105 owns the ledger and its consumer. 80a owns refunds. 108 (offline, 80G) follows this unit. Pause/resume, amount changes, FY donation statements: not built.

## Acceptance checks (Seam 1 unless marked: `h.as(actor).<useCase>`, PGlite + real migrations, FakeClock, FakePaymentGateway, `h.drain()`)
1. `startRecurringDonation({ amountMinor: 100000n, showOnWall })` as a signed-in adult → `recurring_donation` `pending_authorisation`; the fake holds 1 plan (₹1,000 monthly) and 1 subscription (`total_count` = `recurring.totalCycles`, notes `{ recurringDonationId }`, `customer_notify: false`); returns subscription Checkout params. A second start for ₹1,000 reuses the plan. Out of bounds → `amount_too_small` / `amount_too_large`, nothing written.
2. `subscription.authenticated` (simulator, valid signature) or `confirmRecurringCheckout({ id, paymentId, signature })` → `active`, audit `recurring_donation.activated`, one `recurring_donation.activated` message. Invalid signature → refused, no row/audit/outbox change.
3. **Ticket AC1.** `subscription.charged` p1 → exactly 1 donation (`captured`, monthly, linked, `gateway_payment_id` p1), 1 receipt `FOA-RCPT-2627-00000n`, after drain 1 posting Dr 1100 / Cr 4200. `clock.advance({ days: 31 })`, charge p2 → second donation, receipt n+1.
4. **Ticket AC2.** Replaying p1's webhook (same event id) → `duplicate`. p1 seen again through any other signal (Checkout return, a new event id, view sync) → donations, receipts, postings, outbox rows and fake messages identical.
5. **Ticket AC4.** `subscription.pending` → `past_due`, exactly 1 `recurring_donation.charge_failed` message, 0 donations, no receipt number used (next capture takes n+1). Replay → still 1 message. A failure in the next cycle → a second message. A retry captured → `active`.
6. **Ticket AC3.** Owner `cancelRecurringDonation({ id })` → the fake records 1 `cancelSubscription(id, { atCycleEnd: false })`, status `cancelled`, `cancelled_by = donor`, 1 `recurring_donation.cancelled` message; `h.gateway.runCycle()` afterwards charges nothing. Provider call throws → `{ status: "cancel_pending" }`; after drain (outbox retry) `cancelled`, still exactly 1 provider cancel (fetch before calling).
7. **"No charge after cancellation".** A charge created at or after `cancel_requested_at` → no donation, no receipt, one system refund kind `recurring_after_cancel` for the full amount at the fake, ledger nets zero (Dr 1100 / Cr 2100, then Dr 2100 / Cr 1100), donor told. Seen twice → one refund.
8. `subscription.halted` → `halted` (+ notice if that cycle had none); `completed` → `completed`; gateway `expired`, or `expireAbandonedRecurringDonations` (system) after 24 h unauthorised → gateway cancel + `cancelled`, `cancelled_by = system`. Paused or unknown gateway status → audit `recurring_donation.conflict`, no change.
9. **Ticket AC5.** Transition table, every allowed and forbidden pair (pure, **done**).
10. **Ticket AC7.** `startRecurringDonation`: adult member passes; visitor → `sign_in_required`; signed-in minor (81b teen login) → `minor_must_ask_guardian`. `confirmRecurringCheckout`, `getMyRecurringDonation`: owner passes, another member `not_found`. `cancelRecurringDonation`: owner and finance pass, another member `not_found`, content manager `forbidden`. `listMyRecurringDonations`: user passes, visitor refused. `listRecurringDonations`: finance passes, member and competition manager refused. `expireAbandonedRecurringDonations`: system only, a user actor refused.
11. FCRA: an international-card charge with `org.fcraEnabled=false` → 106a's foreign path (full refund, no receipt), recurring status unchanged.
12. Audit rows for start, activate, cancel request, cancel, halt, conflict: actor, before/after, ids and statuses only (no donor PII).
13. **Ticket AC8 seed.** `seed.preview()` adds member1 active ₹1,000 with 2 charges and receipts, member2 `past_due`, member3 `cancelled`; running it again changes nothing.
14. **Ticket AC8 axe (Seam 2, written, Not run).** `tests/e2e/107-recurring.spec.ts`: `/dashboard/donations`, `/dashboard/donations/recurring/[id]` (cancel with confirmation `<dialog>`), `/admin/donations/recurring`, `/donate/checkout/monthly/[id]`, `/donate` monthly option; `expectRendersAccessibly` light and `.dark`.

## Files
- **New:** `src/server/db/schema/recurring-donations.ts` (enum `recurring_donation_status` from `RECURRING_DONATION_STATUSES`; `recurring_donation`: id, donor_id, user_id NOT NULL, amount_minor bigint, currency CHECK INR, status, gateway_plan_id, gateway_subscription_id unique, show_on_wall, wall_name, next_charge_at, cancel_requested_at, cancel_requested_by, cancelled_at, cancelled_by text registry `donor|finance|provider|system`, created_at, updated_at; `gateway_plan`: amount_minor, period, interval, gateway_plan_id, unique (amount_minor, period, interval); `recurring_charge_failure`: recurring_donation_id, cycle_key, unique (recurring_donation_id, cycle_key), gateway_payment_id null, first_failed_at, attempts, notified_at; `recurring_late_charge`: gateway_payment_id unique, refund_id). Module `src/server/modules/donations/recurring/{index,start,confirm-checkout,sync,cancel,send-cancel,expire-abandoned,list}.ts` + tests. `src/server/seed/recurring-donations.ts`. `src/app/dashboard/donations/**`, `src/app/admin/donations/recurring/**`, `src/app/donate/checkout/monthly/[id]/**`. `messages/en-IN/donorDashboard.json`. `tests/e2e/107-recurring.spec.ts`.
- **Migrations:** `107_refund_kind` (adds `recurring_after_cancel` to 80a's `refund_kind`; nothing else in it), then `107_recurring_donations`. FK `donation.recurring_donation_id → recurring_donation.id` is one line in 106a's `donations.ts` (H35).
- **Hotspots (one line or small append each):** X10/H14/H36 `ports/payment-gateway.ts` + contract, `test/fakes/payment-gateway.ts`, `ports/razorpay/*`, fallback adapter, `receive-gateway-webhook.ts` (route `subscription.*` hints by subscription id to `syncRecurringDonation`); H34 ledger mapping row; H35/H37 `donations.ts` FK; H9 events, templates, subscriber `recurring_donations.cancel`; H10 hourly schedule `recurring.expireAbandoned`; H8 `can()` actions `recurring_donation.start|read_own|cancel_own|cancel_any|list`; H7 settings `recurring.minAmountMinor` (10000), `recurring.maxAmountMinor` (1500000), `recurring.totalCycles` (120), `recurring.authorisationWindowHours` (24); H5 inventory; H19 dashboard/admin nav + `app-routes.ts`; H3 `messages.ts`; `donate`, `donationCheckout`, `adminDonations` namespaces (serialize with 106b); `schema/index.ts`, `seed/index.ts`, `app.ts`.

## Design (codebase-design, three interfaces)
- **A. One handler per subscription event** (the spec's `handleSubscriptionEvent`): shallow; each event type carries its own out-of-order and replay rules, and `subscription.pending` payloads carry no payment entity (Razorpay sample), so dedupe keys differ per type.
- **B. Gateway-truth funnel (chosen).** Every signal (webhook, Checkout return, cancel, sweep, dashboard view) is a hint naming a subscription. `syncRecurringDonation(deps, id)` fetches the subscription and its charges outside any transaction, then in one transaction (`FOR UPDATE` on the row) applies the pure `planRecurringSync` (done): the status move, charges to record (each through 106a's `decideDonationCapture` then `recordCapturedDonation`), late charges to refund, the once-per-cycle failure notice, whether to cancel at the gateway, conflicts. Mirrors 77a's capture funnel and 80a's refund funnel; order- and count-independent; idempotent by `gateway_payment_id` and `(recurring_donation_id, cycle_key)`.
- **C. Optimistic local state** (provider response drives state, webhooks reconcile): fewest moving parts but the late-charge race is decided by timing, not data.
- **Cancellation (from the spec's two contenders):** tx1 writes `cancel_requested_at` + an outbox `recurring_donations.cancel` delivery; the use case then tries `sendCancel` inline; the relay retries it. `sendCancel` fetches first (adopts an already-cancelled subscription), cancels immediately, then syncs. Status changes only on the gateway's word (contender a), but without a 7th status; any charge created at or after the request is refunded, never recorded.
- **Deviations, recorded:** `halted → active` is allowed (issues-M5 §2.1 forbids it) because Razorpay's webhook docs say `subscription.activated` fires from `halted` after the donor retries. Failure dedupe is per billing cycle, not per payment id, because the `subscription.pending` payload has no payment. `customer_notify: false` so FOA sends the only messages.

## Interface needs (code against these; adapt names, not shapes)
```ts
// Port (this unit adds; 77a's file, 77b's adapters). Money = { amountMinor: bigint; currency: "INR" }
type GatewaySubscription = { id: string; planId: string; status: string; currentStart: Date | null; chargeAt: Date | null; endedAt: Date | null; notes: Record<string, string> };
type GatewaySubscriptionCharge = { paymentId: string; invoiceId: string | null; captured: boolean; amountMinor: bigint; currency: string; international: boolean; createdAt: Date };
interface PaymentGateway { /* 77a, 80a … */
  ensurePlan(p: { amount: Money; period: "monthly"; interval: 1; name: string }): Promise<{ planId: string }>;
  createSubscription(s: { planId: string; totalCount: number; customerNotify: false; notes: Record<string, string> }): Promise<GatewaySubscription>;
  subscriptionCheckout(s: { subscriptionId: string; description: string }): CheckoutParams;
  verifySubscriptionCheckout(r: { subscriptionId: string; paymentId: string; signature: string }): boolean; // verify formula in Razorpay docs at build
  fetchSubscription(id: string): Promise<GatewaySubscription>;
  fetchSubscriptionCharges(id: string): Promise<GatewaySubscriptionCharge[]>; // invoices → payments
  cancelSubscription(id: string, o: { atCycleEnd: false }): Promise<GatewaySubscription>;
  readWebhook(raw: string, h: Headers): { eventId: string; type: string; orderId: string | null; paymentId: string | null; refundId: string | null; subscriptionId: string | null } | null }
// Fake controls: authoriseSubscription(id), chargeSubscription(id, { at?, international? }), failSubscriptionCharge(id), haltSubscription(id), runCycle(), cancelCalls
// 106a
recordCapturedDonation(tx: AppDb, ctx: UseCaseContext, d: { donorId: string; frequency: "monthly"; recurringDonationId: string; amountMinor: bigint; gatewayPaymentId: string; capturedAt: Date; showOnWall: boolean; wallName: string | null }): Promise<{ donationId: string; receiptNumber: string } | { duplicate: true }>;
ensureDonorForUser(tx: AppDb, ctx: UseCaseContext, u: { userId: string; donorType: "individual" }): Promise<{ donorId: string }>;
isMinor(db: AppDb, userId: string, now: Date): Promise<boolean>; decideDonationCapture(...) // as on ticket/106-core
// 106a/80a system refund (the foreign_payment path, kind widened)
startSystemRefund(tx: AppDb, ctx: UseCaseContext, r: { kind: "foreign_payment" | "recurring_after_cancel"; gatewayPaymentId: string; amount: Money; reason: string; idempotencyKey: string }): Promise<{ refundId: string }>;
// 105: mapping row source "recurring_after_cancel" Dr 1100 / Cr 2100; refund reverses. 106b: <CheckoutButton params={CheckoutParams}/> accepts subscriptionId
// 59/60 can(ctx, action, resource) throws DomainError; writeAudit(tx, ctx, entry). 61 emit(tx, clock, event), subscriber registry, h.drain(). 62 getSetting(db, key). 69 route rows + templates
// harness: h.seed.member(), h.seed.finance(), h.seed.teenLogin(), h.signIn(user), h.gateway
```

## Residue
- **HR-09:** Subscriptions enabled in Razorpay test mode, `subscription.*` events on the staging webhook. Previews run on the fallback adapter (authorise + first charge simulated), recorded in the PR.
- **HR-15:** Subscriptions live. **HR-51:** monthly bounds ₹100–₹15,000, 120 cycles, no pause, provider charge day, individual donors only, `customer_notify: false`. **HR-50:** copy for activated, failed charge, cancelled, late-charge refund. **HR-47:** one receipt per charge; late-charge accounting through 2100. **HR-14:** SMS stays off. **HR-10:** `worker-preview` redeploy for the cancel retry and message handlers. **HR-31:** retention of recurring rows (financial floor). **HR-28:** real-device check.

## Test plan
Pure (**done**): `recurring-status.test.ts`, `recurring-sync.test.ts`. Seam 1: the slice files below, fakes only, no internal mocks. Contract: the gateway contract gains subscription cases, run by the fake, the fallback (PGlite) and Razorpay (fetch double). Seam 2: `tests/e2e/107-recurring.spec.ts`, **Not run** (no Postgres server; previews fail at `pnpm db:migrate`). Not run: real Razorpay test mode (HR-09).

## Slices (ordered; one behaviour, one test file each)
0. **Done:** state machine and sync planner (AC 9).
1. Port subscription methods + fake + contract, schema and both migrations, `startRecurringDonation` with bounds, plan reuse, adult check, authz (AC 1, 10 start). → `src/server/modules/donations/recurring/start.test.ts`
2. Sync funnel: webhook routing, `confirmRecurringCheckout`, `syncRecurringDonation`; charges → donations, receipts, postings; replays; failure notices; halted, completed, conflict; FCRA; audit (AC 2–5, 8 except abandoned, 11, 12). → `sync.test.ts`
3. Cancellation: owner and finance cancel, inline + outbox retry, late-charge refund, abandoned sweeper (AC 6, 7, 8 abandoned, 10 cancel). → `cancel.test.ts`
4. Razorpay and fallback adapter subscription methods, webhook parser `subscriptionId` (contract). → `src/server/ports/razorpay/subscriptions.test.ts`
5. Lists, messages and templates, seed, pages, namespaces, Seam 2 spec (AC 10 lists, 13, 14). → `list.test.ts`, `src/server/seed/recurring-donations.test.ts`, `tests/e2e/107-recurring.spec.ts`
