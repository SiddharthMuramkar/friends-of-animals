# 106a: One-time donations with receipts, core (#106, M5, L, risk)

Branch `ticket/106-core`, worktree `/root/foa-wt/106a`, base `foa/M0` 442dd99. Blockers: 105 (ledger), 81b (minors), and through them 77a, 80a, 81a, 61a, 59, 62, 69, 73. Key X10 (Payments). Hotspots H34, H35 (owner), H36 (owner), H37 (shared with 106b).
Head start landed: `f4e9138` (pure, no schema): `src/server/modules/donations/domain/{donation-status,receipt-number,donation-capture,receipt-link,amount-in-words}.ts` + tests (148 cases). Rebase onto `M5` at claim.

## Scope
- **In (106a):** the Donations module's server side. Tables `donor`, `donation`, `receipt`, `receipt_sequence`, `receipt_link`. Payments gets a batch `purpose` (`registration_fee` | `donation`) and a purpose-handler record so the capture funnel reaches Donations. Use cases `startDonation`, `confirmDonationCheckout`, the donation capture handler, the foreign-payment refusal, `handleDonationRefund`, `expirePendingDonations`. Gapless receipt numbers per FY, a frozen receipt snapshot, ledger postings (2.2 rows), outbox events and the thank-you message carrying the first receipt link. Minor refusal, settings keys, inventory rows, audit, preview seed.
- **Out:** 106b owns every page and route (`/donate` form island, `/donate/checkout/[id]`, `/donate/thank-you`, `/receipts/[token]`, `/receipts/request`, `/admin/donations/**`), CSP and `Permissions-Policy` allowances (X4), `robots.ts`, messages namespaces, and the read/reissue use cases `getReceiptByToken`, `reissueReceiptLink`, `requestReceiptLinkByEmail`, `listDonations`, `getDonation`, `getDonationOutcome`. #107 recurring, #108 offline + 80G/PAN, #110 donor wall read model.

## Acceptance checks (Seam 1 unless marked: `h.as(actor).<useCase>` on PGlite + real migrations, FakeClock, FakePaymentGateway, `h.drain()`)
1. Adult member `startDonation` Rs 500 (individual) → donor + `pending` donation + donation-purpose batch + one fake order for 50000 paise. Webhook simulator `payment.captured` (valid signature) → `captured`, exactly one posting Dr 1100 / Cr 4200 (4210 corporate, 4220 CSR), exactly one receipt `FOA-RCPT-2627-000001`; a second donation → `-000002`.
2. FY rollover: clock 2027-03-31T23:59 IST → `-2627-00000n`; 2027-04-01T00:00 IST → `FOA-RCPT-2728-000001`. A failed payment consumes no number (gapless; `receipt_sequence` row lock).
3. Replay: the same webhook again, Checkout return after webhook, or both twice → no second posting, receipt, outbox row or message (counts and rows identical).
4. Invalid or missing signature → rejected; no donation, receipt, posting, audit or outbox change.
5. Refund of a captured donation (via #80's request + finance approval) → `refund_pending` → `refunded`/`partially_refunded` on `refund.processed`; reversal posting Dr 42xx / Cr 1100 with `reversal_of` = the capture posting; receipt `cancelled_at` set; its number is never reused.
6. Foreign capture (currency ≠ INR or `international: true`) with `org.fcraEnabled=false` → no receipt; `refund_pending`; posting Dr 1100 / Cr 2100; the fake gateway shows one full refund, kind `foreign_payment`; after `refund.processed` → `refunded`, posting Dr 2100 / Cr 1100, one `donation_foreign_refunded` message. With `org.fcraEnabled=true` an INR international payment follows AC 1.
7. Signed-in minor (81a linked teen, 15) `startDonation` → `{ ok: false, reason: "minor_must_ask_guardian" }`, nothing written; that teen's guardian is allowed; the 18th birthday in IST flips it (fake clock).
8. Transition table: every allowed and forbidden donation move (pure; done in the head start).
9. Validation: below `donations.minAmountMinor` / above `max` → `amount_out_of_range`; corporate/CSR without `discloseOrganisation` → `disclosure_required`; missing adult or Indian-source declaration → `declaration_required`; guest allowed while `donations.allowGuest`; `wallName` defaults to first name + last initial when `showOnWall`.
10. `expirePendingDonations` (system) after `donations.pendingExpiryHours` → `expired`; a capture on an expired donation → no receipt, batch outcome `not_payable` (#79 review), never auto-refunded.
11. After drain, one `donation_thank_you` email to the donor (in-app too if the donor has an account) with `/receipts/<token>`; no attachment; `receipt_link.expires_at` = send time + 7 days; only the SHA-256 is stored.
12. Authz: visitor and member pass `startDonation`; minor refused. Capture/refund handlers run only inside the Payments funnel; `expirePendingDonations` as `system/worker` passes, a user actor (even finance) is refused.
13. Audit rows for donation started/captured/refunded/expired and receipt issued/cancelled (no PD in before/after). Inventory rows for every donor PD column (Vitest coverage test). `seed.preview()` adds a captured donation with receipt, a pending one and a foreign-refunded one; running it twice changes nothing.

## Files
New: `src/server/modules/donations/{index.ts (donationsUseCases), start-donation.ts, confirm-donation-checkout.ts, capture.ts (purpose handler), foreign-refund.ts, refund.ts, expire.ts, receipts/{allocate.ts, snapshot.ts}, thank-you.ts, postings.ts, policy.ts}` + `*.test.ts`; `src/server/db/schema/donations.ts`; `src/server/seed/donations.ts`; migrations `NNNN_106_pre_enum_payment_purpose_refund_kind` (custom: `ALTER TYPE … ADD VALUE` for `foreign_payment` if #80's `refund_kind` is an enum) then `NNNN_106_donations` (generated).
Touch (hotspots): 77a's `payment_batch` (+ `purpose`, items optional for donations), `syncBatch`/`decideCapture` (purpose dispatch; donation batches hand the captured payment to `decideDonationCapture` before amount matching), `GatewayPayment` (+ `international`), 80a refund kinds + processed dispatch, #105 mapping file (append donation rows), #62 settings catalogue (`donations.*`), #59 policy (`donation.*` actions), #69 event→template map + 3 templates, #73 inventory, `src/server/app.ts` (one `composeUseCases` entry), schema/seed barrels, `drizzle/meta/*` (merge queue regenerates).

## Design (codebase-design; compared in this context)
- **A. Purpose column + purpose-handler record (chosen).** `payment_batch.purpose`; Payments' funnel looks up `PAYMENT_PURPOSES[batch.purpose]` (`registration_fee` = 77a's confirm, `donation` = this module). The record is typed `Record<PaymentPurpose, PaymentPurposeHandler>`, so a new purpose (#133 auctions) fails type-checking until handled. Two real adapters → a real seam; Payments keeps one webhook/signature/dedupe path (its depth), Donations owns donation rules (`decideDonationCapture`) behind `onCaptured`.
- **B. Polymorphic `payment_subject` interface** implemented by Registration and Donation (amount, items, order notes, confirm). Deeper in theory, but it rewrites 77a's landed registration path for one new caller; bigger X10 blast radius. Rejected.
- **C. Separate donation payment path** (own order table, own webhook handling). Duplicates signature checks, dedupe and the order-fetch funnel: two places to get replay safety right. Rejected.
- Receipt numbers: `receipt_sequence(fy PK, last_seq)`; `INSERT … ON CONFLICT DO NOTHING` then `UPDATE … SET last_seq = last_seq + 1 RETURNING` inside the capture transaction (row lock; gapless; rollback returns the number). Rejected: a Postgres SEQUENCE per FY (rollbacks burn numbers) and `max(seq)+1` with retry (races; PGlite can't show them). `UNIQUE (fy, seq)` and `UNIQUE (donation_id)` back it.
- Receipt snapshot (jsonb, `template_version`) frozen at capture: org facts, donor name/type/organisation per disclosure, amount, `amountInWords`, mode, gateway reference, FY, number. No 80G block while `org.has80G=false`.
- First receipt link is minted by the `donation.captured` consumer, in the same transaction that enqueues the email, never in the capture transaction: the plaintext token never sits in the outbox.
- Foreign path: capture tx sets `refund_pending`, posts Dr 1100/Cr 2100, emits `donation.foreign_refund_requested`; its consumer calls #80's system refund outside any transaction (no HTTP in a tx).
- Reversible defaults written in the PR: `failed → refund_pending` and `partially_refunded → refund_pending` added to 2.1's table; foreign = either test (HR-47); expired + money → review.

## Interface needs (code against these; rename to what landed)
```ts
// 105 ledger
post(tx: AppDb, p: { sourceType: string; sourceId: string; postingKind: string; occurredAt: Date; description: string;
  reversalOf?: { sourceType: string; sourceId: string; postingKind: string };
  lines: { accountCode: string; debitMinor?: bigint; creditMinor?: bigint; memo?: string }[] }): Promise<{ postingId: string; created: boolean }>; // idempotent by key
// 77a payments
type PaymentPurpose = "registration_fee" | "donation";
openPaymentBatch(ctx: UseCaseContext, b: { purpose: PaymentPurpose; amount: Money; notes: Record<string, string> }): Promise<{ batchId: string; checkout: CheckoutParams }>;
type GatewayPayment = { id: string; orderId: string; status: "created" | "authorized" | "captured" | "failed" | "refunded"; amountMinor: bigint; currency: string; international: boolean };
interface PaymentPurposeHandler {
  onCaptured(tx: AppDb, e: { batchId: string; payment: GatewayPayment; at: Date }): Promise<"applied" | "not_payable" | "amount_mismatch" | "duplicate">;
  onFailed(tx: AppDb, e: { batchId: string; at: Date }): Promise<void>;
  onRefundProcessed(tx: AppDb, e: { batchId: string; refundId: string; amountMinor: bigint; kind: RefundKind; at: Date }): Promise<void>;
}
confirmCheckout(ctx, i: { batchId: string; paymentId: string; signature: string }): Promise<{ status: PaymentBatchStatus }>;
// 80a refunds
requestSystemRefund(tx: AppDb, r: { batchId: string; paymentId: string; amountMinor: bigint; currency: string; kind: "foreign_payment"; reason: string }): Promise<{ refundId: string }>;
// 81a/81b/78 identity
isMinor(db: AppDb, userId: string, at: Date): Promise<boolean>; // own participant profile with age < 18 in IST; decrypts DOB in app code
// 62 settings, 59 access, 61 outbox, 69 notifications, 73 inventory
getSetting<K extends SettingKey>(db: AppDb, key: K): Promise<SettingValue<K>>;
can(ctx: UseCaseContext, action: "donation.start" | "donation.read" | "donation.list" | "donation.reissue_receipt", resource?: Resource): Promise<Decision>;
writeAudit(tx: AppDb, e: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; actor: Actor }): Promise<void>;
emit(tx: AppDb, e: { type: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> }): Promise<void>;
notify(tx: AppDb, m: { template: string; to: { userId: string } | { email: string }; vars: Record<string, string> }): Promise<void>;
// harness: h.drain(), h.gateway (FakePaymentGateway + webhook simulator), h.seed.member(), h.seed.guardianWithTeen(), h.settings.set(key, value)
```

## Residue
- HR-47: FY token `2627`, foreign test (either), chart rows 4200/4210/4220/2100, receipt fields and "no goods or services" line, amount-in-words style.
- HR-51: `donations.minAmountMinor` 10000, `maxAmountMinor` 10000000, `presetAmountsMinor`, `allowGuest` true, `pendingExpiryHours` 24.
- HR-31: donor PD retention (financial floor 8 y after FY end), inventory rows `toConfirm`. HR-50: thank-you, refund, foreign-refund template copy. HR-16: no 80G block until `org.has80G`. HR-14: SMS thank-you off until DLT. HR-15: live payments.

## Test plan
Pure (landed): status table, receipt numbers + FY, capture decision, link tokens, amount in words. Seam 1 per slice below, plus authz per use case. Optional real-Postgres check (not run here): 20 concurrent captures → 20 distinct gapless numbers. Not run: Seam 2 (106b), real Razorpay (HR-09).

## Slices
1. Schema, settings keys, `startDonation` with minor refusal, validation and authz (AC 7, 9, 12 start). Test `src/server/modules/donations/start-donation.test.ts`.
2. Purpose dispatch and domestic capture: receipt allocation, snapshot, posting, outbox, replay, FY rollover, signature refusal (AC 1–4, 8). Test `capture-donation.test.ts`.
3. Foreign refusal: system refund, both postings, refunded, message (AC 6). Test `foreign-donation.test.ts`.
4. Finance refund reversal, receipt cancel, expiry job, not-payable (AC 5, 10, 12 job). Test `refund-and-expiry.test.ts`.
5. Thank-you with first receipt link, audit, inventory, preview seed (AC 11, 13). Test `donation-messages.test.ts` + `src/server/seed/donations.test.ts`.
