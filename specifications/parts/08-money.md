## 8. Payments, Donations, Auctions & Financial Transparency

> **Owns:** `PaymentService`, `LedgerService`, `PaymentProvider`, `DonationQuery`, the enums `PaymentPurpose` and `PaymentStatus` (verbatim from §3.5), and every enum declared here. Sets `PhysicalArtworkStatus` `LISTED_FOR_AUCTION` / `SOLD`, and reverts `LISTED_FOR_AUCTION` or `SOLD` → `statusBeforeListing`, only through §6's artwork transition service (`setAuctionState`). **Milestones:** §8.1–8.4 and §8.6–8.7 are MVP. §8.5 (auctions) is post-MVP (M6–M8); its tables ship in the MVP schema.

### 8.1 Configuration (`MoneyConfig`)

Values live in the platform settings store. FINANCE edits `org.*`, `payment.*`, `donation.*` and `transparency.*`; AUCTION_MANAGER edits `auction.*`; SUPER_ADMIN can edit any key. Every change writes `AuditLog`. Amounts are in minor units (paise). Defaults marked *placeholder* are UI starting values, not FOA facts.

| Key | Default | Meaning |
|---|---|---|
| `org.legalName`, `org.address`, `org.pan`, `org.registrations[]` | none (required before go-live) | Printed on receipts. `registrations` = `{ label, number, validFrom?, validTo? }[]` (12A, 80G, CSR-1…) |
| `org.has80G` | `false` | Enables tax-receipt capture and the receipt's tax section (§8.4.4) |
| `org.fcraEnabled` | `false` | `false` = INR only, domestic methods only, foreign payments auto-refunded (§8.4.6) |
| `org.baseCurrency` | `INR` | Ledger and transparency currency |
| `payment.orderTtlMinutes` / `payment.refundDualApprovalAboveMinor` | `30` / `1000000` *placeholder* | Checkout validity in the UI (abandoned orders swept after 24h) / refunds above this need a second approver |
| `donation.suggestedAmountsMinor` | `[50000, 100000, 250000, 500000]` *placeholder* | Chips on `/donate` |
| `donation.minAmountMinor` / `donation.maxOnlineAmountMinor` | `10000` / `100000000` *placeholder* | Above the max, the form points to bank transfer |
| `donation.defaultFrequency` / `donation.recurringMaxAmountMinor` | `ONE_TIME` / `1500000` (₹15,000) | Preselected on `/donate` / RBI limit for e-mandate debits without extra authentication |
| `donation.recurringTotalCount` / `donation.maxPauseCycles` / `donation.haltedAutoCancelDays` | `120` / `3` / `30` | |
| `donation.cashMaxMinor` / `donation.cash80GMaxMinor` | `19999900` / `200000` | Cash must be under ₹2,00,000 (Income-tax Act s.269ST). Cash above ₹2,000 never gets 80G text |
| `transparency.showOrgDonorAmounts` / `transparency.showBudgets` | `true` / `false` | |
| `auction.paymentWindowHours` / `auction.secondChanceWindowHours` / `auction.maxSecondChanceOffers` | `72` / `48` / `2` | |
| `auction.antiSnipeWindowSec` / `auction.antiSnipeExtendSec` / `auction.antiSnipeMaxTotalMin` | `120` / `120` / `60` | |
| `auction.incrementTable` | `[{upTo:100000,inc:10000},{upTo:500000,inc:25000},{upTo:2000000,inc:50000},{upTo:null,inc:100000}]` | Increment band chosen by the current price |
| `auction.proxyBiddingEnabled` / `auction.minLotDurationHours` | `true` / `24` | |
| `auction.shippingCountries` / `auction.shippingFeeMode` | `["IN"]` / `INCLUDED` | `INCLUDED`: FOA absorbs shipping. `FLAT`: adds `auction.flatShippingMinor` |
| `auction.autoDeliverAfterDays` / `auction.nonPaymentStrikesToSuspend` | `14` / `2` | |
| `auction.minorCreditCap` / `auction.logisticsPartners` | `FIRST_NAME_INITIAL` / `[]` | Most identifying credit allowed for creators under 18 / partners offered at shipping |

### 8.2 Payments Core

#### 8.2.1 Data model

```prisma
enum PaymentPurpose { REGISTRATION_FEE, DONATION, AUCTION }                                  // §3.5 verbatim
enum PaymentStatus  { CREATED, AUTHORIZED, CAPTURED, FAILED, REFUNDED, PARTIALLY_REFUNDED }   // §3.5 verbatim
enum PaymentChannel { RAZORPAY, OFFLINE }   enum OfflineMethod { CHEQUE, DD, BANK_TRANSFER, UPI_DIRECT, CASH }
enum RefundStatus { REQUESTED, PENDING, PROCESSED, FAILED, REJECTED }   enum WebhookEventStatus { RECEIVED, PROCESSED, IGNORED, FAILED }
enum RefundReason { PAYER_REQUEST, DUPLICATE, WITHDRAWAL, EVENT_CANCELLED, LOT_CANCELLED, LATE_CAPTURE, FOREIGN_PAYMENT_BLOCKED, AMOUNT_MISMATCH, OTHER }

model Payment { id String @id; purpose PaymentPurpose; status PaymentStatus @default(CREATED); channel PaymentChannel
  amountMinor Int; currency String; refundedMinor Int @default(0); feeMinor Int?; taxOnFeeMinor Int?
  payerUserId String? /* null only for guest DONATION / OFFLINE */; payerName String?; payerEmail String?; payerPhone String?
  refType String /* 'RegistrationPaymentBatch'|'Donation'|'AuctionLot' */; refId String; notes Json? /* competitionId, fundId, offerRank */
  providerOrderId String? @unique; providerPaymentId String? @unique; providerSubscriptionId String?
  method String?; isInternational Boolean @default(false); failureCode String?; failureReason String?
  offlineMethod OfflineMethod?; offlineReference String?; proofFileAssetId String?; recordedByUserId String?
  guestAccessTokenHash String? /* SHA-256, 7-day TTL */; expiresAt DateTime?; authorizedAt DateTime?; capturedAt DateTime?; failedAt DateTime?
  providerSettlementId String?; settledAt DateTime?; reconciledAt DateTime?; createdAt DateTime; updatedAt DateTime
  @@index([refType, refId]) @@index([status, createdAt]) }   // partial unique: one Payment in (CREATED, AUTHORIZED) per (refType, refId)
model Refund { id String @id; paymentId String; amountMinor Int; currency String; reason RefundReason; reasonText String?
  status RefundStatus @default(REQUESTED); lineRefs Json? /* [{refType, refId}] */; isSystem Boolean @default(false)
  requestedByUserId String?; approvedByUserId String?; providerRefundId String? @unique
  createdAt DateTime; processedAt DateTime?; failureReason String? }
model WebhookEvent { id String @id; provider String; providerEventId String; eventType String; payload Json
  status WebhookEventStatus @default(RECEIVED); attempts Int @default(0); lastError String?; receivedAt DateTime; processedAt DateTime?
  @@unique([provider, providerEventId]) }   // payload redacted to ids + status after 180 days
model ProviderPlan { id String @id; provider String; amountMinor Int; currency String; interval String; providerPlanId String @unique
  @@unique([provider, amountMinor, currency, interval]) }           // created lazily per recurring amount
model ReconciliationRun { id String @id; provider String; forDate DateTime @db.Date; status String /* RUNNING|OK|ISSUES|FAILED */
  itemsMatched Int; issuesFound Int; startedAt DateTime; finishedAt DateTime? }
model ReconciliationIssue { id String @id; runId String?; kind String /* MISSING_IN_DB|NOT_CAPTURED_IN_DB|AMOUNT_MISMATCH|MISSING_AT_PROVIDER|DISPUTE */
  severity String /* INFO|WARN|CRITICAL */; paymentId String?; providerRef String; detail Json
  status String @default("OPEN") /* OPEN|RESOLVED|IGNORED */; resolvedByUserId String?; resolutionNote String? }
```

#### 8.2.2 `PaymentService` and `PaymentProvider`

```ts
PaymentService.createOrder({ purpose, amountMinor, currency, payerUserId /* null: guest donation */, refType, refId, notes?, payer? })
  => { paymentId, checkout: CheckoutParams, expiresAt }   // reuses the open Payment for the ref if amount+currency match,
                                                           // else marks it FAILED(SUPERSEDED) and creates a new one
PaymentService.requestRefund({ paymentId, amountMinor, reason, reasonText?, lineRefs?, system?: boolean }) => Refund
PaymentService.recordOfflinePayment({ purpose, refType, refId, amountMinor, method, reference, receivedAt, proofFileAssetId }) => Payment
PaymentService.getStatus(paymentId) => { status, capturedAt? }

interface PaymentProvider {   // RazorpayProvider (prod) and FakePaymentProvider (tests/local, deterministic signatures) MUST exist
  createOrder(i: { amountMinor; currency; receipt /* Payment.id */; notes: Record<string,string> }): Promise<{ providerOrderId }>;
  verifySignature(i: { kind: 'ORDER'; orderId; paymentId; signature } | { kind: 'SUBSCRIPTION'; subscriptionId; paymentId; signature }): boolean;
  verifyWebhook(rawBody: string, headers: Headers): { valid: boolean; eventId: string | null };
  parseWebhook(rawBody: string): NormalizedEvent;            // { type, paymentId?, orderId?, refundId?, subscriptionId?, entity }
  fetchPayment(providerPaymentId): Promise<ProviderPayment>;  // { id, orderId, status, amountMinor, currency, method, international, amountRefundedMinor, subscriptionId?, error? }
  fetchOrderPayments(providerOrderId): Promise<ProviderPayment[]>;
  refund(i: { providerPaymentId; amountMinor; refundId; notes }): Promise<{ providerRefundId; status: 'PENDING'|'PROCESSED'|'FAILED' }>;
  createSubscription(i: { amountMinor; currency; interval: 'MONTHLY'; totalCount; notes }): Promise<{ providerSubscriptionId; providerPlanId }>;
  cancelSubscription(id): Promise<void> /* immediate */; pauseSubscription(id): Promise<void>; resumeSubscription(id): Promise<void>;
  fetchSubscription(id): Promise<ProviderSubscription>;
  fetchSettlementItems(dateIst): Promise<SettlementItem[]>;  // { type: payment|refund|adjustment, entityId, amountMinor, feeMinor, taxMinor, settlementId, settledAt }
}
```

Only domain services call `createOrder`. The amount always comes from server data: §6's fee config, the validated donation choice, or the lot's hammer price.

#### 8.2.3 Razorpay implementation

- **Orders:** `POST /v1/orders` with `amount` (paise), `currency`, `receipt = Payment.id`, `notes = { paymentId, purpose, refType, refId }` (max 15 keys, 256 chars each). The account MUST use automatic capture, so AUTHORIZED is transient; Razorpay auto-refunds authorizations that are never captured.
- **Checkout:** the server returns `{ key: RAZORPAY_KEY_ID, order_id | subscription_id, amount, currency, name, description, prefill, notes }`, and the client opens Checkout.js. With `org.fcraEnabled=false`, international methods are hidden in Checkout and international cards stay disabled on the account.
- **Return:** the Checkout `handler` posts `razorpay_payment_id`, `razorpay_order_id` (or `razorpay_subscription_id`) and `razorpay_signature` to `confirmCheckoutReturn`. The expected signature is the hex `HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)` (subscriptions: `payment_id + "|" + subscription_id`), compared with `crypto.timingSafeEqual`. A valid signature doesn't capture anything by itself; the service then calls `fetchPayment` and applies the provider's status and amount.
- **Webhooks** (`src/app/api/webhooks/razorpay/route.ts`) are the source of truth. Read the raw body (`await req.text()`) before parsing, verify `X-Razorpay-Signature` = `HMAC_SHA256(rawBody, RAZORPAY_WEBHOOK_SECRET)`, and use the `X-Razorpay-Event-Id` header as the idempotency key. Subscribed events: `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`, `subscription.authenticated|activated|charged|pending|halted|paused|resumed|cancelled|completed`, `payment.dispute.created`. Razorpay retries failed deliveries for about 24h.
- **Pipeline:** (1) invalid signature → 400, WARN log, nothing stored; (2) `INSERT … ON CONFLICT (provider, providerEventId) DO NOTHING`, and an existing PROCESSED/IGNORED row → 200; (3) enqueue `payments.processWebhook(id)` and return 200 within 2s; (4) the job runs one transaction with `SELECT … FOR UPDATE` on the Payment (transition, Outbox rows, event status). Unknown types → IGNORED. Five retries with backoff, then FAILED (replayable in `/admin/payments`).
- **Ordering:** handlers never assume event order. If an event finds an earlier state than expected (e.g. `refund.processed` before `payment.captured`), the handler calls `fetchPayment` and applies the missing transitions first.
- **Attempts:** one order can carry several payment attempts. `payment.failed` sets FAILED only if no attempt is captured, and a later `payment.captured` moves FAILED → CAPTURED. Subscription charges are keyed by `providerPaymentId`: whichever of `payment.captured` and `subscription.charged` arrives first creates the Payment, and the other is a no-op.

#### 8.2.4 Payment state machine

| From → To | Trigger | Guard | Side effects |
|---|---|---|---|
| ∅ → CREATED | `PaymentService.createOrder` | amount > 0, server-computed. Currency allowed by config | Provider order created. AuditLog |
| CREATED/FAILED → AUTHORIZED | `payment.authorized` | | `authorizedAt` |
| CREATED/AUTHORIZED/FAILED → CAPTURED | `payment.captured`, `order.paid`, `confirmCheckoutReturn` or reconciliation, each after `fetchPayment` | Provider amount and currency equal the Payment's. Otherwise a CRITICAL `AMOUNT_MISMATCH` issue and stop | `capturedAt`. The purpose handler (§8.3–8.5) and `LedgerService.record` run in the same transaction. Outbox `payment.captured` |
| CREATED/AUTHORIZED → FAILED | `payment.failed` (no captured attempt), sweeper (`ABANDONED`), newer order (`SUPERSEDED`) | | Outbox `payment.failed` |
| CAPTURED/PARTIALLY_REFUNDED → PARTIALLY_REFUNDED | `refund.processed` | Σ processed < amount | `refundedMinor` updated. Ledger reversal. Outbox `payment.refunded` |
| CAPTURED/PARTIALLY_REFUNDED → REFUNDED | `refund.processed` | Σ processed = amount | Same, with `fully: true` |

**Stale or late captures.** A handler for a §8-owned ref (Donation, AuctionLot) returns `ACCEPTED` or `REJECTED_STALE`. A ref is stale when it's already paid, the lot has been re-offered or cancelled, or the payment is foreign while FCRA is off. A stale capture is still recorded as CAPTURED and posted, then fully refunded at once as a system refund (`LATE_CAPTURE`, `DUPLICATE` or `FOREIGN_PAYMENT_BLOCKED`) without approval. §6 owns its own refs: a capture for a registration that is no longer payable puts the batch in NEEDS_REVIEW and emits `registration.paymentNeedsReview`. There is no automatic refund.

#### 8.2.5 Refunds

- **Who:** FINANCE or SUPER_ADMIN. REGISTRATION_FEE refunds may also be requested by COMPETITION_MANAGER or STAFF_ADMIN and are approved by FINANCE. Above `payment.refundDualApprovalAboveMinor`, a different FINANCE/SUPER_ADMIN user must approve. System refunds (§8.2.4, `cancelLot`, and, for registration fees, only §6's competition cancellation and duplicate resolution) skip approval. **Partial refunds** are allowed: the service locks the Payment and rejects `refundedMinor + Σ pending + amount > amountMinor`.
- **Flow:** REQUESTED → (approval) → PENDING once the provider's `refund` is called with `refundId` in notes (after a network error, check the provider's refunds before retrying, so nothing is sent twice) → PROCESSED on `refund.processed`, or FAILED on `refund.failed` (FINANCE notified, may retry). REJECTED = approver declined. OFFLINE payments are refunded outside the gateway: FINANCE records the reference and proof, and the refund is PROCESSED at once.
- **Ledger:** on PROCESSED, post a negative entry with the original type and category, `sourceType=REFUND`.

#### 8.2.6 Reconciliation

- **Daily `payments.reconcile`** (06:00 IST, previous IST day): `fetchSettlementItems` (Razorpay `GET /v1/settlements/recon/combined?year&month&day`), match by `providerPaymentId`/`providerRefundId`, set fee, tax, settlement id, `settledAt` and `reconciledAt`, and post fee + tax as EXPENSE `PAYMENT_GATEWAY_FEES` (`sourceType=SETTLEMENT_FEE`).
- **Issues:** `NOT_CAPTURED_IN_DB` (auto-healed by applying the capture; INFO), `MISSING_IN_DB` (CRITICAL; refs never auto-created), `AMOUNT_MISMATCH` (CRITICAL), `MISSING_AT_PROVIDER` (CAPTURED but unsettled after T+3 days; WARN), `DISPUTE` (from `payment.dispute.created`; CRITICAL). CRITICAL issues emit `reconciliation.issueFound`. FINANCE resolves issues in `/admin/payments` with a note (AuditLog).
- **Hourly `payments.healPending`:** CREATED/AUTHORIZED Payments older than 15 min → `fetchOrderPayments` and apply. After 24h with nothing captured → FAILED (`ABANDONED`). RecurringDonations not updated in 35 days → `fetchSubscription` and apply.

### 8.3 Registration Fees (contract with §6)

- **Call:** one order per `RegistrationPaymentBatch`. §6 computes the fee from its competition config and calls `PaymentService.createOrder({ purpose: REGISTRATION_FEE, amountMinor, currency, payerUserId, refType: 'RegistrationPaymentBatch', refId: batchId, notes: { competitionId } })`, where `amountMinor` is the batch total (Σ `RegistrationPaymentBatchItem.amountMinor`). It never calls for a zero fee or waiver. **Individual:** a batch of one, payer = participant or guardian user. **Institution bulk:** a batch of N, payer = INSTITUTION_ADMIN/coordinator. One Payment covers the batch, and §6 keeps the item ↔ Registration map. §6's register page opens Checkout with the returned `checkout`. §8 never changes Registration state.
- **Events back** (Outbox, routed by `refType`; §6 consumers MUST be idempotent): `payment.captured { paymentId, purpose, refType, refId, amountMinor, currency, capturedAt }`, `payment.failed { paymentId, refType, refId, failureCode }`, `payment.refunded { paymentId, refundId, refType, refId, amountMinor, fully, lineRefs? }`. If the registration is no longer payable (cancelled or already paid), §6 puts the batch in NEEDS_REVIEW and emits `registration.paymentNeedsReview`. There is no automatic refund.
- **Offline payment** (cheque, DD, transfer): §6 `markBatchPaidOffline` (FINANCE or STAFF_ADMIN) calls `recordOfflinePayment({ refType: 'RegistrationPaymentBatch', refId, … })`, creating an OFFLINE Payment in CAPTURED that emits the same `payment.captured`.
- **Partial refund of a batch:** COMPETITION_MANAGER or STAFF_ADMIN calls `requestRefund({ paymentId, amountMinor, reason: WITHDRAWAL, lineRefs: [{ refType: 'RegistrationPaymentBatchItem', refId }, …] })`, where `amountMinor` is the sum of the listed items' `amountMinor`, and FINANCE approves under the normal approval rules. The Payment becomes PARTIALLY_REFUNDED, and `payment.refunded` returns the `lineRefs`.
- **Ledger:** INCOME `REGISTRATION_FEES`, tagged with `competitionId`. The payer gets an acknowledgement PDF by signed link (payment id, registration ref, amount, mode). It isn't a donation receipt and uses no receipt number.

### 8.4 Donations (modules 11, 24)

#### 8.4.1 Data model

```prisma
enum DonorType { INDIVIDUAL, CORPORATE, CSR, FOUNDATION, INSTITUTIONAL }   enum NameDisclosure { DISCLOSED, ANONYMOUS }
enum DonationFrequency { ONE_TIME, MONTHLY }   enum DonationStatus { PENDING, CAPTURED, FAILED, PARTIALLY_REFUNDED, REFUNDED }
enum RecurringDonationStatus { PENDING_AUTHORIZATION, ACTIVE, PAST_DUE, PAUSED, HALTED, CANCELLED, COMPLETED }   enum FundKind { GENERAL, CAMPAIGN, EVENT, COMPETITION }

model Fund { id String @id; code String @unique; slug String @unique; name String; description String?; kind FundKind
  eventId String?; competitionId String?; goalMinor Int?; currency String; startsAt DateTime?; endsAt DateTime?
  isActive Boolean; isPublic Boolean; showProgress Boolean @default(false) }   // seed GENERAL: cannot be deactivated
model Donor { id String @id; userId String? @unique; donorType DonorType; name String /* person or organisation */
  contactPersonName String?; email String?; emailNormalized String?; phone String?
  panEncrypted Bytes?; panLast4 String?; addressLine1 String?; addressLine2 String?; city String?; state String?; pinCode String?; country String?
  createdAt DateTime  @@index([emailNormalized]) }
model Donation { id String @id; donorId String; fundId String; donorType DonorType; frequency DonationFrequency; recurringDonationId String?
  paymentId String? @unique; status DonationStatus @default(PENDING); amountMinor Int; currency String; source String /* ONLINE|OFFLINE */; recordedByUserId String?
  nameDisclosure NameDisclosure @default(ANONYMOUS); publicDisplayName String?; message String? /* ≤280 */; messageApprovedAt DateTime?; messageApprovedBy String?
  taxReceiptRequested Boolean @default(false); taxName String?; taxPanEncrypted Bytes?; taxPanLast4 String?; taxAddress Json?; declaredAdult Boolean; declaredIndianOrigin Boolean?
  receiptNumber String? @unique; receiptFy String?; receiptSeq Int?; receiptFileAssetId String?; receiptTemplateVersion Int?; receiptIssuedAt DateTime?; receiptCancelledAt DateTime?
  utm Json?; createdAt DateTime; capturedAt DateTime?  @@unique([receiptFy, receiptSeq]) }
model RecurringDonation { id String @id; donorId String; userId String; fundId String; amountMinor Int; currency String; status RecurringDonationStatus
  providerSubscriptionId String @unique; providerPlanId String; nameDisclosure NameDisclosure; publicDisplayName String?; taxReceiptRequested Boolean
  chargesCount Int @default(0); failedAttempts Int @default(0); nextChargeAt DateTime?; pauseCyclesUsed Int @default(0); pausedAt DateTime?
  cancelledAt DateTime?; cancelledBy String? /* DONOR|ADMIN|PROVIDER|SYSTEM */; cancelReason String?; createdAt DateTime }
model ReceiptSequence { fy String @id /* "2627" = Apr 2026–Mar 2027 */; lastSeq Int @default(0) }
model ReceiptTemplate { id String @id; version Int @unique; name String; bodyHtml String; taxSectionHtml String?
  signatoryName String; signatoryTitle String; signatureFileAssetId String?; isActive Boolean; createdBy String; createdAt DateTime }
```

**`DonationQuery`** (read API for other sections): `DonationQuery.totalForFund(fundId, since?: Date) => { amountMinor, currency, donorCount }`, computed from CAPTURED donations net of refunds.

#### 8.4.2 Donate flow

1. **Form** (`/donate`; `?fund=<slug>` preselects): fund (active public funds, default GENERAL), frequency (default `donation.defaultFrequency`), amount (chip or custom whole rupees within min/max; MONTHLY ≤ `recurringMaxAmountMinor`), donor type (default INDIVIDUAL). Organisation types require name, contact person, email, phone and a DISCLOSED/ANONYMOUS radio with no default. INDIVIDUAL shows an unchecked "Show my name on the supporters wall" box (checked = DISCLOSED) and an editable public name (prefilled first name + last initial). An optional message appears only after FINANCE or CONTENT_MANAGER approval.
2. **Identity:** ONE_TIME allows guest checkout (name and email required, phone optional). MONTHLY needs a user with a verified email or phone; the form offers inline OTP sign-in. Minors can't donate; a guardian donates on their behalf. **Adulthood:** `isAdult(userId)` is false iff the user has their own ParticipantProfile (`ParticipantProfile.userId = userId`) with age < 18. Guardians who manage a minor's profile are not minors. Users without one, and guests, self-declare by ticking "I am 18 or older".
3. **Tax receipt** (rendered only if `org.has80G`): "I need a tax-exemption receipt" reveals name as on PAN, PAN (`^[A-Z]{5}[0-9]{4}[A-Z]$`) and address with pin code. Required once ticked, never collected otherwise.
4. **FCRA declaration** (when `org.fcraEnabled=false`): "I am an Indian citizen donating from my own Indian funds", or "Indian-registered entity" for organisations.
5. **`createDonationCheckout`:** upsert the Donor (by `userId`, else `emailNormalized` + `donorType`) → Donation PENDING → ONE_TIME: `PaymentService.createOrder` (`refType='Donation'`); MONTHLY: `provider.createSubscription` (reusing the `ProviderPlan` for the amount) plus RecurringDonation PENDING_AUTHORIZATION → return Checkout params.
6. **Return:** `confirmCheckoutReturn` redirects to `/donate/thank-you?p=<paymentId>&t=<guestToken>`, which polls `GET /api/v1/payments/[paymentId]/status` every 2s for up to 60s. When a user later verifies an email, Donor rows with that `emailNormalized` and no `userId` are attached to them (AuditLog).

#### 8.4.3 Capture handling (inside the `payment.captured` transaction)

1. **Foreign payment while FCRA is off** (`isInternational && !org.fcraEnabled`): return `REJECTED_STALE` (`FOREIGN_PAYMENT_BLOCKED`). No receipt number is allocated. The donation becomes REFUNDED when the refund processes, and the donor is told why.
2. **Otherwise, receipt allocation:** Donation → CAPTURED. Compute the FY from `capturedAt` in Asia/Kolkata (Apr–Mar). Run `INSERT … ON CONFLICT DO NOTHING`, then `UPDATE "ReceiptSequence" SET "lastSeq"="lastSeq"+1 WHERE fy=$1 RETURNING "lastSeq"`, giving `receiptNumber = FOA-RCPT-{fy}-{seq:06}`. Because this runs in the capture transaction, numbers are gapless and failed payments never consume one.
3. **Ledger:** INCOME, with the category from the donor-type map (`INDIVIDUAL→DONATIONS_INDIVIDUAL`, `CORPORATE→DONATIONS_CORPORATE`, `CSR→CSR_CONTRIBUTIONS`, `FOUNDATION|INSTITUTIONAL→GRANTS_INSTITUTIONAL`), tagged with `fundId`. Outbox `donation.captured` (§10 sends a thank-you message only, no attachment).
4. **Receipt PDF:** the job `donations.renderReceipt` writes the PDF (FileAsset `PDF`, private bucket) and, after it renders, emits `donation.receiptIssued`. §10's message carries a signed download link valid for 7 days, not an attachment.

#### 8.4.4 Receipts

- **Template:** the active `ReceiptTemplate` renders only whitelisted variables: org legal name, address, PAN, `org.registrations`; receipt number and date (IST); donor name and type; amount in figures and Indian-system words ("Rupees One Lakh Five Thousand Only"); mode (UPI, card, netbanking, cheque no., bank ref) and transaction ref; fund; recurring flag; "No goods or services were provided in exchange".
- **Tax section:** `taxSectionHtml` (80G text, registration no. and validity, donor PAN and address) renders only if `org.has80G && taxReceiptRequested && !(CASH && amount > cash80GMaxMinor)`.
- **Regeneration** (template fix, name correction) keeps the number, bumps `receiptTemplateVersion`, and keeps old files. **Refund** sets `receiptCancelledAt` and re-renders with a "CANCELLED, refunded on …" watermark ("Amended: ₹X refunded" if partial). Numbers are never reused.
- **Recurring:** one receipt per charge, plus a FY consolidated statement (not a receipt) on `/dashboard`. **Form 10BD:** if `org.has80G`, FINANCE exports the data per FY; the accountant confirms the columns.

#### 8.4.5 Donation and recurring state machines

| Entity: From → To | Trigger | Guard | Side effects |
|---|---|---|---|
| Donation ∅ → PENDING | `createDonationCheckout` | Validation passed | Payment CREATED |
| Donation ∅ → CAPTURED | `recordOfflineDonation` (FINANCE) | Proof attached. Cash < `cashMaxMinor` | OFFLINE Payment CAPTURED. Receipt. Ledger |
| Donation PENDING/FAILED → CAPTURED | `payment.captured` | Not foreign-blocked | Receipt, ledger, `donation.captured` |
| Donation PENDING → FAILED | `payment.failed` / `ABANDONED` | | No email for abandoned payments |
| Donation CAPTURED → PARTIALLY_REFUNDED / REFUNDED | `payment.refunded` | | Receipt amended or cancelled. `donation.refunded` |
| Recurring ∅ → PENDING_AUTHORIZATION | `createDonationCheckout` (MONTHLY) | Signed in | Provider subscription created. Sweeper cancels it if still unauthorised after 24h |
| PENDING_AUTHORIZATION → ACTIVE | `subscription.authenticated` / `activated` | | `recurringDonation.activated` |
| ACTIVE/PAST_DUE → ACTIVE | `subscription.charged` | Idempotent on `providerPaymentId` | New Donation + Payment CAPTURED (disclosure and tax fields copied). `failedAttempts=0`. `recurringDonation.charged` |
| ACTIVE → PAST_DUE | `subscription.pending` (charge failed, provider retrying) | | `failedAttempts++`. `recurringDonation.chargeFailed` (with an update-payment link) |
| PAST_DUE → HALTED | `subscription.halted` (retries exhausted) | | `recurringDonation.halted`. Auto-cancel after `haltedAutoCancelDays` |
| ACTIVE ↔ PAUSED | Donor or FINANCE pause/resume → provider, confirmed by `subscription.paused` / `resumed` | `pauseCyclesUsed < maxPauseCycles` | `recurringDonation.paused` / `recurringDonation.resumed` |
| non-terminal → CANCELLED | Donor/FINANCE cancel, `subscription.cancelled`, or HALTED timeout | | Provider cancelled immediately. `recurringDonation.cancelled` |
| ACTIVE → COMPLETED | `subscription.completed` | | Donor invited to renew |

Changing the amount means cancelling and creating a new subscription, because the mandate must be re-authorised.

#### 8.4.6 Foreign contributions

`org.fcraEnabled=false` (default): INR only, international methods off at Checkout and on the account, declaration required, international captures auto-refunded (§8.4.3). `true` is specified but not built until FOA confirms registration. It needs a second provider account settling into FOA's FCRA-designated bank account (chosen by `Payment.providerAccount: DOMESTIC|FCRA`), `isForeignContribution` ledger tagging, and donor nationality fields for FCRA reporting.

#### 8.4.7 Admin donation management (`/admin/donations`)

- **Search:** receipt no., donor name/email/phone, PAN last 4, fund, donor type, status, source, date and amount range, recurring.
- **Actions:** view; refund (§8.2.5); resend or regenerate the receipt; record an offline donation (method, reference, received date, required proof upload, donor details, disclosure); edit disclosure or public name at the donor's request; approve or reject messages; manage Funds; manage receipt templates (new version, sample-data preview, activate); export CSV (PAN masked unless `includePan=true`, which needs a reason and is AuditLogged); export Form 10BD data.
- **Roles:** FINANCE has full access. STAFF_ADMIN is read-only. CONTENT_MANAGER approves messages and edits Fund copy.

### 8.5 Auctions (Phase 15; modules 5, 23), post-MVP

#### 8.5.1 Data model

```prisma
enum AuctionLotStatus { DRAFT, SCHEDULED, LIVE, CLOSED_PENDING_PAYMENT, CLOSED_UNSOLD, PAID, SHIPPED, DELIVERED, CANCELLED, RELISTED }
enum CreatorCreditMode { FULL_NAME, FIRST_NAME_INITIAL, ANONYMOUS }   enum BidKind { MANUAL, PROXY }   enum BidStatus { VALID, VOIDED }

model AuctionEvent { id String @id; slug String @unique; title String; description String?; startsAt DateTime; endsAt DateTime; isPublished Boolean; createdBy String }
model AuctionLot { id String @id; lotCode String @unique; auctionEventId String; physicalArtworkId String; entryId String; competitionId String; participantId String
  status AuctionLotStatus @default(DRAFT); title String; story String?; awardLabel String?; disciplineLabel String; ageCategoryLabel String
  imageFileAssetId String /* STAMPED */; extraImageFileAssetIds String[]; dimensionsText String?; materialText String?; conditionNote String?
  creditMode CreatorCreditMode; creditLine String /* rendered snapshot */; currency String; startingBidMinor Int; reserveMinor Int?; fixedIncrementMinor Int?
  opensAt DateTime; closesAt DateTime; originalClosesAt DateTime; extensionCount Int @default(0)
  currentBidMinor Int?; leaderUserId String?; bidCount Int @default(0); version Int @default(0)
  proceedsFoaBps Int; proceedsCreatorBps Int; proceedsSchoolBps Int /* snapshot at SCHEDULED; sum = 10000 */
  winnerUserId String?; hammerMinor Int?; offerRank Int @default(0); paymentDueAt DateTime?; paymentId String?; shareNameWithArtist Boolean @default(false)
  shippingAddress Json?; logisticsPartner String?; trackingNumber String?; trackingUrl String?; shippedAt DateTime?; deliveredAt DateTime?; deliveryIssueOpen Boolean @default(false)
  relistedFromLotId String?; cancelReason String?; createdBy String; createdAt DateTime; updatedAt DateTime
  @@index([status, closesAt]) }  // partial unique (physicalArtworkId) WHERE status NOT IN (CANCELLED, RELISTED, CLOSED_UNSOLD)
model AuctionBid { id String @id; lotId String; bidderUserId String; amountMinor Int; kind BidKind; status BidStatus @default(VALID)
  placedAt DateTime @default(now()); idempotencyKey String @unique; ipHash String?; voidReason String?  @@index([lotId, amountMinor]) }
model AuctionMaxBid { id String @id; lotId String; bidderUserId String; maxAmountMinor Int; isActive Boolean; updatedAt DateTime  @@unique([lotId, bidderUserId]) }
model AuctionBidder { userId String @id; termsVersion Int; termsAcceptedAt DateTime; dateOfBirth DateTime @db.Date
  nonPaymentStrikes Int @default(0); suspendedAt DateTime?; suspendReason String? }
model AuctionTerms { id String @id; version Int @unique; bodyMarkdown String; publishedAt DateTime?; publishedBy String? }
model AuctionProceedsPolicy { competitionId String @id; foaBps Int @default(10000); creatorBps Int @default(0); schoolBps Int @default(0); payoutNote String?; updatedBy String }
model ProceedsPayout { id String @id; lotId String; payeeType String /* CREATOR|SCHOOL */; payeeRefId String; amountMinor Int
  status String /* PENDING|PAID|WAIVED */; reference String?; paidAt DateTime?; paidBy String? }
model AuctionAcknowledgement { id String @id; lotId String @unique; participantId String; institutionId String?; letterFileAssetId String; issuedAt DateTime }
```

#### 8.5.2 Lot eligibility guards

Checked in `createLot`, re-checked in `scheduleLot` and again at SCHEDULED → LIVE. Each failure has its own error code.

1. `PhysicalArtwork.status ∈ {VERIFIED, IN_EXHIBITION, RETAINED}` (§6), and no other non-terminal lot exists for the artwork.
2. `Entry.auctionCandidate = true` (§7), and the entry is not WITHDRAWN or DISQUALIFIED.
3. `Competition.allowAuction = true` (§6).
4. `ConsentService.has(participantId, AUCTION_OF_ARTWORK, competitionId)` and `ConsentService.has(…, PUBLIC_DISPLAY, …)`. For a creator under 18, the auction consent must have been given by a guardian and `GUARDIAN_VERIFIED` must be present (§12).
5. **Credit:** `creditMode` = the consent's `metadata.creditMode`, captured on §12's consent form (ANONYMOUS if absent), capped at `auction.minorCreditCap` for minors. AUCTION_MANAGER can only choose a more private mode. `creditLine`: FULL_NAME → full name, school, city. FIRST_NAME_INITIAL → "Aarav S.", school, city. ANONYMOUS → "Young artist, {ageCategory}". DOB and exact age are never shown.
6. **Image:** `StampService.stamp(<web derivative>, { variant: 'GALLERY' })`. Only STAMPED assets are public.
7. **Prefill:** title, story (the participant's statement), `finalAwardLabel`, discipline, age category, and the dimensions, material and condition from §6 verification.

#### 8.5.3 Bidding (English ascending)

- **Eligibility** (`assertBidderEligible`): the bidder must be signed in and have `User.phoneVerifiedAt` set. They must have accepted the current `AuctionTerms.version`. Their declared DOB must make them 18+ on the bid date, and `isAdult(userId)` (§8.4.2) must hold, so minors can't bid. They must not be suspended and must not hold AUCTION_MANAGER or FINANCE. Guardians and relatives of the creator may bid; the admin view flags them.
- **Minimum next bid:** `startingBidMinor` when there are no bids, else `currentBidMinor + (fixedIncrementMinor ?? band(currentBidMinor))`. Amounts are whole rupees.
- **`placeBid({ lotCode, amountMinor, idempotencyKey })`**, one transaction:
  1. `SELECT … FROM "AuctionLot" WHERE "lotCode"=$1 FOR UPDATE`.
  2. Guards, on the DB clock: `LOT_NOT_LIVE`, `LOT_CLOSED` (`now() ≥ closesAt`), `NOT_ELIGIBLE`, `BID_TOO_LOW { minNextMinor }`, `ALREADY_LEADING` (the leader raises via `setMaxBid`).
  3. Insert a MANUAL bid. If another bidder's active max is ≥ the bid, insert a PROXY bid for them at `min(theirMax, amount + increment)` and they stay leader (a tie between a max and a manual bid goes to the earlier max). Then update `currentBidMinor`, `leaderUserId`, `bidCount`, `version++`.
  4. Anti-sniping: if `closesAt − now() < antiSnipeWindowSec`, set `closesAt = min(now() + antiSnipeExtendSec, originalClosesAt + antiSnipeMaxTotalMin)`, `extensionCount++`, and reschedule the close job.
  5. Outbox: `bid.placed`, `bid.outbid` to the previous leader (if changed), `lot.extended`.
- **`setMaxBid({ lotCode, maxAmountMinor })`:** same lock. The max must be ≥ minNext (or above the bidder's own max if they lead), and any needed proxy bid is placed at once. Max bids can only be raised, never lowered or withdrawn, and only their owner sees them. **Proxy bidding is ON by default** (recommended): casual bidders for children's art can't watch the close, and proxies blunt sniping.
- **Live updates by polling:** `GET /api/v1/auctions/lots/[lotCode]/state` → `{ status, currentBidMinor, minNextMinor, bidCount, closesAt, serverNow, reserveMet, youAreLeading, version }` (`no-store`, ETag on `version`). Clients poll every 10s, every 3s in the last 5 min, and right after their own bid. SSE can come later behind the same payload.
- **Public history:** amount, time and a per-lot pseudonym ("Bidder 3"; the viewer sees "You"). The reserve amount is never exposed, only met / not met. Rate limits: 10 bids/min per user, 60/min per IP. **`voidBid`** (AUCTION_MANAGER, reason required) recomputes the leader and price from the remaining VALID bids under the lock and notifies the affected bidders.

#### 8.5.4 Closing, payment, second chance

- **Close job:** `auctions.closeLot` runs at `closesAt` and is rescheduled on each extension. A per-minute sweeper catches any LIVE lot past `closesAt`. Under the lock the job re-checks `now() ≥ closesAt`; if the close has moved, it reschedules and exits.
- **Outcome:** no VALID bids, or `currentBidMinor < reserveMinor` → CLOSED_UNSOLD. Otherwise → CLOSED_PENDING_PAYMENT with `winnerUserId = leader`, `hammerMinor = currentBidMinor`, `offerRank = 1`, `paymentDueAt = now + paymentWindowHours`. Max bids are deactivated. `lot.won` goes to the winner and `lot.closed` to the other bidders.
- **`startLotPayment({ lotCode, shippingAddress, shareNameWithArtist })`** (current winner only): the address country must be in `shippingCountries`. The service calls `createOrder({ purpose: AUCTION, amountMinor: hammerMinor (+ flat shipping), refType: 'AuctionLot', refId, notes: { offerRank } })`.
- **Reminders:** §10 sends `reminder.auctionPayment` T−24 h and T−2 h before `paymentDueAt`. §8 emits no reminder event.
- **Overdue job** (at `paymentDueAt`, if not PAID): send `lot.paymentOverdue` and add a strike (reaching `nonPaymentStrikesToSuspend` suspends the bidder). Then, if `offerRank ≤ maxSecondChanceOffers`, make a **second-chance offer** to the highest VALID bid from a different, still-eligible bidder with a bid ≥ reserve, at that bidder's own highest bid. The lot stays CLOSED_PENDING_PAYMENT with the new winner, `offerRank++`, `paymentDueAt = now + secondChanceWindowHours`, and emits `lot.secondChanceOffered`. Paying is acceptance. `declineSecondChance` or a timeout moves on to the next candidate. No candidates left → CLOSED_UNSOLD.
- **Capture handler:** PAID only if `payerUserId = winnerUserId` and `notes.offerRank = offerRank`. Anything else is `REJECTED_STALE` and auto-refunded (`LATE_CAPTURE`).
- **On PAID:** artwork → SOLD (§6 service); ledger INCOME `AUCTION_PROCEEDS` tagged with `auctionEventId` and `competitionId`; PENDING ProceedsPayouts for non-zero creator or school shares; a purchase confirmation PDF for the buyer (a purchase, not a donation, so no tax-exemption receipt); `lot.paid`, `lot.sold`.

#### 8.5.5 Fulfilment, acknowledgement, proceeds

- **Shipping:** AUCTION_MANAGER calls `markLotShipped({ logisticsPartner, trackingNumber, trackingUrl? })` → SHIPPED (`lot.shipped`). Shipping invoices are manual EXPENSE `LOGISTICS` entries.
- **Delivery:** DELIVERED via the buyer's `confirmLotDelivery`, AUCTION_MANAGER's `markLotDelivered`, or automatically `autoDeliverAfterDays` after shipping. The buyer can call `reportDeliveryIssue` (photos, within 48h of delivery); this sets `deliveryIssueOpen`, blocks auto-delivery and alerts AUCTION_MANAGER.
- **Artist acknowledgement** (end-to-end flow step 13): on `lot.sold`, the job `auctions.issueAcknowledgement` renders a thank-you letter PDF (title, lot code, competition, award, amount raised, FOA signatory; the buyer's name only if `shareNameWithArtist`, otherwise "a supporter of FOA"). It's stored as an AuctionAcknowledgement and shown on the creator's `/dashboard` and, for the school route, on `/institution`. `lot.acknowledged { participantId, guardianId?, institutionId?, lotId, letterFileAssetId }` lets §10 thank the creator (via the guardian for minors) and the school coordinator.
- **Proceeds:** FINANCE pays PENDING ProceedsPayouts outside the platform (guardian's account for minors, or the school's account) and records `markProceedsPayoutPaid`, which posts EXPENSE `AUCTION_PROCEEDS_PAYOUTS`. A payee who declines makes the payout WAIVED. The lot page shows the split.

#### 8.5.6 Lot state machine

| From → To | Actor / trigger | Guard | Side effects |
|---|---|---|---|
| ∅ → DRAFT | AUCTION_MANAGER `createLot` | §8.5.2 guards 1–4 | Stamped image. AuditLog |
| DRAFT → SCHEDULED | AUCTION_MANAGER `scheduleLot` | Guards re-checked. `opensAt > now`. Duration ≥ `minLotDurationHours`. Event published. Current terms published. Proceeds policy exists | Artwork → LISTED_FOR_AUCTION (`setAuctionState`; the prior status is stored in `PhysicalArtwork.statusBeforeListing`). Proceeds snapshot. Jobs scheduled. `lot.scheduled` |
| SCHEDULED → DRAFT | AUCTION_MANAGER `unscheduleLot` | `now < opensAt` | Artwork → `statusBeforeListing` (`setAuctionState`). Jobs cancelled |
| SCHEDULED → LIVE | Job at `opensAt` | Consents still valid (otherwise → CANCELLED) | `lot.opened` |
| LIVE → CLOSED_PENDING_PAYMENT | Close job | `now ≥ closesAt`, a leader exists, reserve met | §8.5.4. `lot.won`, `lot.closed` |
| LIVE → CLOSED_UNSOLD | Close job | No bids, or reserve not met | Artwork → `statusBeforeListing` (`setAuctionState`). `lot.unsold` |
| CLOSED_PENDING_PAYMENT → same | Overdue job / `declineSecondChance` | An eligible next bid ≥ reserve, and `offerRank ≤ max` | New winner. `lot.paymentOverdue`, `lot.secondChanceOffered` |
| CLOSED_PENDING_PAYMENT → CLOSED_UNSOLD | Overdue job | No candidates left | Artwork → `statusBeforeListing` (`setAuctionState`). `lot.unsold` |
| CLOSED_PENDING_PAYMENT → PAID | `payment.captured` (AUCTION) | Payer = winner, `offerRank` matches | Artwork → SOLD. Ledger. Payouts. `lot.paid`, `lot.sold` |
| PAID → SHIPPED | AUCTION_MANAGER `markLotShipped` | Address, partner and tracking no. present | `lot.shipped` |
| SHIPPED → DELIVERED | Buyer / AUCTION_MANAGER / auto job | Auto only if `!deliveryIssueOpen` | `lot.delivered` |
| CLOSED_UNSOLD → RELISTED | AUCTION_MANAGER `relistLot` | Guards 1–4 still hold | New DRAFT lot with `relistedFromLotId` |
| DRAFT/SCHEDULED/LIVE/CLOSED_PENDING_PAYMENT → CANCELLED | AUCTION_MANAGER `cancelLot` (reason), or the `consent.withdrawn` consumer | | Bids lapse. Max bids deactivated. Artwork → `statusBeforeListing` (`setAuctionState`) if it was listed. Any later capture auto-refunded. `lot.cancelled` |
| PAID/SHIPPED → CANCELLED | AUCTION_MANAGER, with FINANCE approval (lost or damaged) | | Full refund (`LOT_CANCELLED`). Artwork: `setAuctionState` reverts SOLD → `statusBeforeListing`, or §6 `recordArtworkReturn` if the work goes back to the creator |

#### 8.5.7 Auction terms (`AuctionTerms`)

Versioned and published by STAFF_ADMIN. A bidder accepts them before their first bid and again on each new version. They MUST cover:

- **Bidding:** eligibility (18+, verified phone, shipping to `shippingCountries` only); bids are binding and can't be retracted (FOA alone may void a bid, for error or abuse); how proxy bidding, increments and anti-sniping work; a reserve may be undisclosed; the payment window, strikes, suspension and second-chance offers.
- **Ownership:** the creator (via the guardian for minors) donates the physical work to FOA under AUCTION_OF_ARTWORK consent, and title passes to the buyer on full payment. Copyright stays with the creator, so the buyer gets no reproduction or commercial rights. FOA keeps image use under PUBLIC_DISPLAY.
- **Sale:** original children's artwork, sold as is with the recorded condition note; transit-damage claims within 48h with photos, no other returns; a purchase is not a donation and gets no tax receipt; buyer identity is never published and is shared with the creator only on opt-in, and bidders appear as pseudonyms; the proceeds split is stated per lot; FOA may withdraw lots before payment, including on consent withdrawal, and bids on a withdrawn lot lapse without liability.

### 8.6 Finance Ledger & Budgets (module 29)

#### 8.6.1 Data model

```prisma
enum LedgerEntryType { INCOME, EXPENSE }   enum PeriodStatus { OPEN, LOCKED, PUBLISHED }
enum LedgerSourceType { PAYMENT, REFUND, OFFLINE_PAYMENT, SETTLEMENT_FEE, PROCEEDS_PAYOUT, PRIZE_FULFILMENT, MANUAL, REVERSAL }
enum FinancialReportType { AUDITED_STATEMENT, ANNUAL_REPORT, QUARTERLY_SUMMARY, REGISTRATION_DOCUMENT, OTHER }   enum FinancialReportStatus { DRAFT, PENDING_APPROVAL, PUBLISHED, WITHDRAWN }

model LedgerCategory { id String @id; code String @unique; name String; type LedgerEntryType; publicLabel String
  publicGroup String /* INCOME|PROGRAMS|FUNDRAISING|ADMINISTRATION */; isSystem Boolean; isActive Boolean; sortOrder Int }
model LedgerEntry { id String @id; seq BigInt @unique @default(autoincrement()); type LedgerEntryType; categoryId String
  amountMinor Int /* signed; negative only for refunds and reversals */; currency String; occurredAt DateTime; periodMonth String /* "2026-11" IST */; fy String
  fundId String?; auctionEventId String?; competitionId String?; sourceType LedgerSourceType; sourceId String?
  description String; counterpartyName String? /* never public */; attachmentFileAssetId String?
  reversalOfId String? @unique; lateAdjustment Boolean @default(false); createdByUserId String? /* null = system */; createdAt DateTime
  @@unique([sourceType, sourceId, categoryId]) @@index([periodMonth, categoryId]) }
model Budget { id String @id; fy String; categoryId String; fundId String?; amountMinor Int; currency String; notes String?
  status String /* DRAFT|APPROVED */; createdBy String; approvedBy String?; approvedAt DateTime?  @@unique([fy, categoryId, fundId]) }
model FinancialPeriod { month String @id; fy String; status PeriodStatus @default(OPEN); lockedBy String?; lockedAt DateTime?
  publishRequestedBy String?; publishRequestedAt DateTime?; publishedBy String?; publishedAt DateTime? }
model TransparencySnapshot { id String @id; throughMonth String; data Json; generatedAt DateTime }
model FinancialReport { id String @id; title String; type FinancialReportType; fy String?; fileAssetId String; summary String?
  status FinancialReportStatus; uploadedBy String; approvedBy String?; publishedAt DateTime?; withdrawnReason String? }
```

**Seed system categories.** INCOME: `DONATIONS_INDIVIDUAL`, `DONATIONS_CORPORATE`, `CSR_CONTRIBUTIONS`, `GRANTS_INSTITUTIONAL`, `REGISTRATION_FEES`, `AUCTION_PROCEEDS`, `SPONSORSHIP`, `OTHER_INCOME`. EXPENSE: `PRIZES_AWARDS`, `CERTIFICATES_PRINTING`, `LOGISTICS`, `PLATFORM_TECHNOLOGY`, `PAYMENT_GATEWAY_FEES`, `EVENTS_WORKSHOPS`, `AWARENESS_OUTREACH`, `ANIMAL_WELFARE_PROGRAMS`, `AUCTION_PROCEEDS_PAYOUTS`, `STAFF_ADMINISTRATION`, `PROFESSIONAL_FEES`, `OTHER_EXPENSE`. FINANCE can add and rename categories. System categories can't be deleted or change type.

#### 8.6.2 `LedgerService` rules

- **Signature:** `LedgerService.record({ type, category /* code */, amountMinor, currency, sourceType, sourceId, occurredAt, fundId?, auctionEventId?, competitionId?, description?, attachmentFileAssetId? })` is a superset of §3.5. It runs in the caller's transaction and is idempotent on `(sourceType, sourceId, category)`: a repeat call returns the existing row.
- **Immutable:** a Postgres trigger raises on UPDATE or DELETE of `LedgerEntry`. Corrections use `reverseLedgerEntry`, which adds a negated row (`reversalOfId`, `sourceType=REVERSAL`), optionally followed by a corrected entry.
- **Single entry** with categories is enough for the MVP. Amounts are in `org.baseCurrency`, on a cash basis: `occurredAt` = capture, refund or payment date.
- **Locked months:** an automatic posting whose month is LOCKED or PUBLISHED goes to the earliest OPEN month with `lateAdjustment=true`. Manual entries into locked months are rejected.

| Posting trigger | Type / category | Amount | Source |
|---|---|---|---|
| Captured payment (online / offline) | INCOME / by purpose: REGISTRATION_FEES, donor-type map (§8.4.3), AUCTION_PROCEEDS | +amount | PAYMENT or OFFLINE_PAYMENT / paymentId |
| Refund PROCESSED | Original type and category | −refund | REFUND / refundId |
| Settlement fee + tax | EXPENSE / PAYMENT_GATEWAY_FEES | +fee | SETTLEMENT_FEE / providerPaymentId |
| Proceeds payout paid | EXPENSE / AUCTION_PROCEEDS_PAYOUTS | +payout | PROCEEDS_PAYOUT / payoutId |
| Prize dispatched with a recorded cost (§7.8) | EXPENSE / PRIZES_AWARDS | +cost | PRIZE_FULFILMENT / prizeFulfilmentId |
| Manual (FINANCE) | Any active category | ± | MANUAL / entry id |

- **Manual entries:** FINANCE only, with a required description. EXPENSE entries also require an attachment: an invoice or receipt FileAsset (PDF, JPG or PNG) with `scanStatus=CLEAN`. Grants and CSR money received outside the gateway are recorded as offline donations (donor type FOUNDATION or CSR) so they get receipts. Other income (sponsorship, interest) is a MANUAL INCOME entry with an attachment.

#### 8.6.3 Budgets, reports, exports

- **Budgets:** one per FY × category (optionally × fund). FINANCE drafts; STAFF_ADMIN approves. Changing an approved budget needs a new approval, and AuditLog keeps the history.
- **Budget vs actual** (`/admin/finance`), per category for the FY and each quarter: budget, actual (Σ ledger), variance, % used. Rows at 90% or more show amber; above 100% show red. `budget.thresholdExceeded` fires once per category per FY when a category crosses 100%.
- **`exportLedgerCsv`:** RFC 4180, UTF-8 with BOM, one row per entry. Columns: `seq, date_ist, fy, period, type, category_code, category_name, amount_inr (2 dp), currency, fund_code, auction_event, competition_code, source_type, source_ref (payment id / receipt no. / refund id), provider_fee, description, counterparty, attachment_id, reversal_of_seq, late_adjustment, created_by`. Other exports: the donation register, Form 10BD data, and reconciliation issues.

#### 8.6.4 Period close and publish

| From → To | Actor | Guard | Effects |
|---|---|---|---|
| OPEN → LOCKED | FINANCE `lockPeriod` | Month ended. Previous month LOCKED. No OPEN CRITICAL reconciliation issue in the month | Manual postings blocked. `financialPeriod.locked` |
| LOCKED → OPEN | SUPER_ADMIN `reopenPeriod` (reason) | Not yet PUBLISHED | AuditLog |
| LOCKED → PUBLISHED | FINANCE `requestPeriodPublish`, then `approvePeriodPublish` by a different FINANCE or STAFF_ADMIN user | All earlier months PUBLISHED | Snapshot regenerated. `financialPeriod.published` |

A PUBLISHED month is never reopened. Later corrections arrive as `lateAdjustment` entries, and `/transparency` lists them as "adjustments to earlier periods".

### 8.7 Financial Transparency (`/transparency`, module 12)

- **Source:** the latest `TransparencySnapshot`, built only from LedgerEntries in PUBLISHED months and regenerated on period publish and on report publish or withdrawal. Public requests never query the ledger. The page is static and revalidated with `revalidateTag('transparency')`.
- **Periods:** FY ("FY 2026-27, Apr–Nov", published months only) and quarters (shown only when all three months are published).
- **Sections:**
  1. Totals: income, expenses and net, with "data through <month>" and a last-updated date.
  2. Charts, each with an accessible data table: income and expense by `publicLabel`, a monthly income-vs-expense trend, and the expense split by `publicGroup` (programs, fundraising, administration).
  3. Campaigns: per public Fund, total raised (Σ INCOME tagged with the fund), goal, donation count.
  4. Auctions: per published AuctionEvent, lots sold, total raised, amount paid to creators and schools.
  5. Supporters wall: individuals with a DISCLOSED donation (`publicDisplayName` and approved message, never amounts), and DISCLOSED organisations (name, plus the published-FY total if `showOrgDonorAmounts`). It covers CAPTURED, not fully refunded donations from any period, and is read live because it's recognition rather than financial data; a switch to ANONYMOUS disappears within one revalidation (≤ 5 min).
  6. Published reports, grouped by FY, with PDF downloads.
  7. Budget vs actual, only if `showBudgets`.
- **Never public:** identity of non-disclosed donors; any individual's donation amount; PAN, addresses, emails, phones; payment and refund ids; counterparty or vendor names; ledger attachments; bidder, buyer and payout-payee identities; unpublished months; reconciliation data. FINANCE MUST map any category that would reveal one person's pay to a broader `publicLabel`.
- **Report workflow:** FINANCE uploads the PDF (DRAFT) → `submitFinancialReport` (PENDING_APPROVAL) → `publishFinancialReport` by a different FINANCE or STAFF_ADMIN user (PUBLISHED; file copied to the public bucket) → `withdrawFinancialReport` (reason; WITHDRAWN; public copy deleted). A correction is uploaded as a new report.

### 8.8 Pages

| Route | Access | Contents |
|---|---|---|
| `/donate` | Public | §8.4.2 form. Fund header with a live provisional progress bar if `showProgress`. FAQ stating the receipt/80G status from config |
| `/donate/thank-you` | Payer session or guest token | Status polling, receipt download, share, manage-recurring link |
| `/auctions` | Public | LIVE and SCHEDULED lots grouped by AuctionEvent (image, title, credit line, current bid, time left). Filters: competition, discipline, price. A "Sold" archive with final prices. Cancelled lots hidden |
| `/auctions/[lotCode]` | Public; bidding needs eligibility | Images, title, credit line, story, award, competition, dimensions and condition, proceeds split, current bid, min next bid, countdown from `serverNow`, reserve indicator, bid and max-bid forms, pseudonymous history, terms link. Inline eligibility wizard (phone OTP → DOB → terms). A CANCELLED lot shows "withdrawn" and no bid data |
| `/dashboard` | Signed in | **Donations:** receipts, FY statement. **Recurring:** status, next charge, pause/resume/cancel, disclosure. **My bids:** leading or outbid, my max. **Won lots:** pay, address, tracking, confirm delivery, report issue. **My artwork in auctions** (participant or guardian), with acknowledgement letters |
| `/admin/payments` | FINANCE (STAFF_ADMIN read-only) | Payment search and detail (provider data), refund queue and approvals, webhook log and replay, reconciliation runs and issues, offline payment entry |
| `/admin/donations` | FINANCE (§8.4.7) | Donations, funds, receipt templates, exports, message moderation |
| `/admin/auctions` | AUCTION_MANAGER (FINANCE for payouts, STAFF_ADMIN read-only and terms) | Events; artwork picker listing only artworks that pass guards 1–4; lot editor and preview; scheduling; live monitor (bids, flags for shared-IP bidders and relatives); close and second-chance queue; fulfilment; bidder suspensions; terms versions |
| `/admin/finance` | FINANCE (STAFF_ADMIN approvals) | Ledger (filter, detail, reverse), manual entry, categories, budgets and budget vs actual, period lock/publish, reports, exports, transparency preview |

### 8.9 Server Actions

Every action validates input with zod, checks `can()` inside the service, and writes AuditLog for money, state or PII changes. "Owner" means the donor's or buyer's own user.

| Action | Input | Authorization | Effect |
|---|---|---|---|
| `confirmCheckoutReturn` | `{ paymentId, providerPaymentId, providerOrderId? \| providerSubscriptionId?, signature }` | Payer session or guest token | Verify signature, `fetchPayment`, apply transition idempotently, return status |
| `requestRefund` / `approveRefund` / `rejectRefund` | `{ paymentId, amountMinor, reason, reasonText, lineRefs? }` / `{ refundId, note? }` | FINANCE, SUPER_ADMIN. `requestRefund` also COMPETITION_MANAGER and STAFF_ADMIN, for REGISTRATION_FEE only (FINANCE approves). The approver must differ from the requester | §8.2.5 |
| `recordOfflinePayment` | `{ refType, refId, amountMinor, method, reference, receivedAt, proofFileAssetId }` | FINANCE, STAFF_ADMIN | OFFLINE Payment CAPTURED, `payment.captured` |
| `replayWebhookEvent` / `resolveReconciliationIssue` | `{ webhookEventId }` / `{ issueId, status, note }` | FINANCE, SUPER_ADMIN | Re-enqueue / resolve |
| `createDonationCheckout` | `{ fundId, amountMinor, frequency, donorType, donor, nameDisclosure, publicDisplayName?, message?, tax?, declarations, idempotencyKey }` | Public (MONTHLY needs a session) | §8.4.2 step 5 |
| `recordOfflineDonation` | `{ donor, donorType, fundId, amountMinor, method, reference, receivedAt, proofFileAssetId, nameDisclosure, tax? }` | FINANCE | Donation CAPTURED, receipt, ledger |
| `resendDonationReceipt` / `regenerateDonationReceipt` | `{ donationId }` / `{ donationId, reason, corrections? }` | Owner or FINANCE / FINANCE | §8.4.4 |
| `updateDonationDisclosure` / `pauseRecurringDonation` / `resumeRecurringDonation` / `cancelRecurringDonation` | `{ donationId \| recurringDonationId, nameDisclosure, publicDisplayName? }` / `{ recurringDonationId, reason? }` | Owner, FINANCE | Supporters wall updated / provider call, status changes on the webhook |
| `moderateDonorMessage` / `upsertFund` / `publishReceiptTemplate` | `{ donationId, approved }` / Fund fields / template fields | FINANCE or CONTENT_MANAGER / FINANCE or STAFF_ADMIN / FINANCE | |
| `exportDonations` / `exportLedgerCsv` | `{ filters, includePan, reason? }` / `{ from, to, categoryIds?, fundId? }` | FINANCE | CSV (AuditLog with the reason when PAN is included) / §8.6.3 |
| `acceptAuctionTerms` | `{ termsVersion, dateOfBirth }` | MEMBER with verified phone | Upserts AuctionBidder. Rejects under-18s |
| `placeBid` / `setMaxBid` | `{ lotCode, amountMinor, idempotencyKey }` / `{ lotCode, maxAmountMinor }` | Eligible bidder | §8.5.3 |
| `startLotPayment` / `declineSecondChance` / `confirmLotDelivery` / `reportDeliveryIssue` | `{ lotCode, shippingAddress, shareNameWithArtist }` / `{ lotCode }` / `{ lotCode, note?, photoFileAssetIds? }` | Current winner / buyer | §8.5.4, §8.5.5 |
| `upsertAuctionEvent` / `createLot` / `updateLot` | Event fields / `{ physicalArtworkId, auctionEventId }` / lot fields | AUCTION_MANAGER | `updateLot` is DRAFT only. In SCHEDULED, only copy fields can change, not prices or times |
| `scheduleLot` / `unscheduleLot` / `cancelLot` / `relistLot` | `{ lotId, reason?, opensAt?, closesAt?, startingBidMinor?, reserveMinor? }` | AUCTION_MANAGER | §8.5.6 |
| `voidBid` / `suspendBidder` / `reinstateBidder` | `{ bidId \| userId, reason }` | AUCTION_MANAGER | §8.5.3 |
| `markLotShipped` / `markLotDelivered` | `{ lotId, logisticsPartner, trackingNumber, trackingUrl? }` / `{ lotId, proofFileAssetId? }` | AUCTION_MANAGER | §8.5.5 |
| `publishAuctionTerms` / `setProceedsPolicy` | `{ bodyMarkdown }` / `{ competitionId, foaBps, creatorBps, schoolBps, payoutNote? }` | STAFF_ADMIN / FINANCE | New version, bidders re-accept / sum = 10000, applies to lots scheduled afterwards |
| `markProceedsPayoutPaid` / `waiveProceedsPayout` | `{ payoutId, reference?, paidAt? }` | FINANCE | Ledger EXPENSE on PAID |
| `createLedgerEntry` / `reverseLedgerEntry` | `{ type, categoryId, amountMinor, occurredAt, description, fundId?, competitionId?, counterpartyName?, attachmentFileAssetId }` / `{ entryId, reason }` | FINANCE | §8.6.2 |
| `upsertLedgerCategory` / `upsertBudget` / `approveBudget` | Category or budget fields / `{ budgetId }` | FINANCE / FINANCE / STAFF_ADMIN | |
| `lockPeriod` / `reopenPeriod` / `requestPeriodPublish` / `approvePeriodPublish` | `{ month, reason? }` | FINANCE / SUPER_ADMIN / FINANCE / a different FINANCE or STAFF_ADMIN user | §8.6.4 |
| `uploadFinancialReport` / `submitFinancialReport` / `publishFinancialReport` / `withdrawFinancialReport` | Report fields / `{ reportId, reason? }` | FINANCE; the publisher must differ from the uploader | §8.7 |

### 8.10 Domain Events (Outbox; §10 maps them to templates, §11 consumes all)

Payloads carry ids, amounts and codes only, never PAN, addresses or contact details.

- **Payments:** `payment.captured`, `payment.failed`, `payment.refunded` (§8.3 payloads; payer and §6). `refund.failed` and `reconciliation.issueFound` (FINANCE).
- **Donations:** `donation.captured` (thank-you message only, no attachment), `donation.receiptIssued` (after the PDF renders; signed download link valid 7 days), `donation.refunded`, `recurringDonation.activated`, `recurringDonation.charged` (each successful charge), `recurringDonation.chargeFailed`, `recurringDonation.halted` (donor and FINANCE), `recurringDonation.paused`, `recurringDonation.resumed`, `recurringDonation.cancelled`.
- **Bids:** `bid.placed` (analytics only), `bid.outbid { lotCode, currentBidMinor, minNextMinor }` (previous leader).
- **Lots:** `lot.scheduled`, `lot.opened`, `lot.extended`, `lot.won` (winner), `lot.closed` (other bidders), `lot.unsold` (bidders, "reserve not met" variant), `lot.paymentOverdue` (winner and AUCTION_MANAGER), `lot.secondChanceOffered`, `lot.paid` and `lot.sold` (buyer, AUCTION_MANAGER, FINANCE), `lot.acknowledged` (creator or guardian, institution coordinator), `lot.shipped` and `lot.delivered` (buyer), `lot.cancelled` (bidders, creator or guardian). Reminders are not emitted here: §10 handles them as `reminder.lotClosing` (T−1 h before close, to watchers and bidders) and `reminder.auctionPayment` (T−24 h and T−2 h before the payment deadline).
- **Finance:** `financialPeriod.locked`, `financialPeriod.published`, `financialReport.published`, `budget.thresholdExceeded`.

### 8.11 Security Notes

- **Amounts:** always computed server-side, from fee config, the validated donation choice or the hammer price. Client-sent prices, statuses and payment outcomes are never trusted; every capture is confirmed by `fetchPayment` or a verified webhook.
- **PCI:** card and UPI data only ever enter Razorpay Checkout, which keeps FOA in the minimal (SAQ-A-style) scope. No card data is logged or stored, and webhook payloads are redacted after 180 days. **Secrets** stay server-only (only `RAZORPAY_KEY_ID` reaches the client). Live keys (`rzp_live_`) refuse to load unless `VERCEL_ENV=production`.
- **Webhook route:** raw body, HMAC with constant-time compare, rate-limited, outside CSRF protection, no session. Server actions keep framework CSRF protection.
- **PAN:** app-level AES-256-GCM envelope encryption with the key from the secret store (§13). The UI shows only the last 4 characters, and every decrypt (export, receipt render) is AuditLogged.
- **Files:** receipts, letters and ledger attachments live in the private bucket behind signed URLs issued after an owner or role check. Guest tokens are 32 random bytes, stored hashed, valid for 7 days.
- **Separation of duties:** four-eyes control on large refunds, period publishing, report publishing and budget approval. Staff roles require 2FA (§4). AUCTION_MANAGER and FINANCE can't bid.
- **Integrity:** the ledger is immutable at the DB level. Receipt numbers come from a locked sequence row. Bids use row locks and the DB clock. Idempotency keys apply to webhooks, bids, checkouts and ledger postings.
- **Abuse:** bid and checkout rate limits. A shill-bidding report flags shared IP hashes and creator relatives among a lot's bidders.

### 8.12 Edge Cases

| Case | Required behaviour |
|---|---|
| Webhook arrives before the Checkout redirect | The webhook captures. `confirmCheckoutReturn` finds CAPTURED and returns it with no second posting |
| Redirect arrives but the webhook never does | Signature check plus `fetchPayment` captures. The later webhook is a no-op. `healPending` covers a lost redirect too |
| Duplicate webhook, or `payment.captured` plus `order.paid` | Same event id: unique constraint, 200 no-op. Different ids: the state guard makes it a no-op, and the ledger idempotency key prevents a double posting |
| Out-of-order events, or captured amount ≠ order amount | Fetch from the provider and apply the missing transitions in order / no capture, CRITICAL issue, FINANCE refunds |
| A bid in the last second | Accepted only if DB `now() < closesAt` under the row lock. The close moves out by `antiSnipeExtendSec`. The close job re-checks under the same lock and reschedules |
| Winner doesn't pay | Reminders, then an overdue strike, then second-chance offers (max 2), then CLOSED_UNSOLD, then an optional relist. The defaulter's late capture is auto-refunded |
| Consent withdrawn after listing, before close or payment | §12's `consent.withdrawn` (AUCTION_OF_ARTWORK or PUBLIC_DISPLAY) → `cancelLot` within one job cycle. Bidders and the guardian are notified. Artwork → `statusBeforeListing` (`setAuctionState`). An in-flight capture is auto-refunded. After PAID the sale stands per the terms; only the credit can switch to ANONYMOUS |
| Partial refund of a registration-fee batch | §8.3: amount = sum of the listed `RegistrationPaymentBatchItem`s, requested by COMPETITION_MANAGER or STAFF_ADMIN and approved by FINANCE, cumulative-sum guard, PARTIALLY_REFUNDED, negative REGISTRATION_FEES posting, `lineRefs` returned to §6 |
| Refund of a donation in a PUBLISHED month | The receipt is marked cancelled. The reversal lands in the next OPEN month with `lateAdjustment` |
| Two tabs pay the same registration / a subscription charge races a cancel | Second capture: §6 puts the batch in NEEDS_REVIEW and emits `registration.paymentNeedsReview`, with no automatic refund; any refund is requested by COMPETITION_MANAGER or STAFF_ADMIN and approved by FINANCE / record the donation with a receipt (the money is real), and FINANCE refunds on request |

### 8.13 Acceptance Criteria

1. A webhook with a bad signature returns 400 and creates no rows. The same valid event delivered 3× produces exactly one transition, one LedgerEntry and one Outbox event. Capture works with the webhook only, the redirect only, and both in either order, each yielding one CAPTURED Payment and one posting.
2. A provider amount that differs from `Payment.amountMinor` never captures and opens a CRITICAL issue. No server action accepts a price for a registration or lot from the client. The app refuses to start with `rzp_live_` keys when `VERCEL_ENV≠production`.
3. Unit tests cover every allowed and every disallowed transition of the Payment, Refund, Donation, RecurringDonation, AuctionLot, FinancialPeriod and FinancialReport machines.
4. Refunding 3 of 20 items in a `RegistrationPaymentBatch` gives PARTIALLY_REFUNDED, `refundedMinor` = the sum of the 3 items, a matching negative posting and `payment.refunded` with 3 `lineRefs`. Refunds beyond the remaining amount are rejected. A refund above the threshold can't be approved by its requester.
5. 100 concurrent captures in one FY get receipt numbers `000001`–`000100` with no gaps or duplicates. Failed and abandoned payments consume none. 31 Mar 23:59 IST → FY `2627`; 1 Apr 00:01 IST → `2728-000001`.
6. With `org.has80G=false`, `/donate` shows no PAN fields and receipts have no tax section; setting it to `true` shows both without a deploy. A guest ONE_TIME donation completes without an account. MONTHLY without a session is rejected. A signed-in minor can't donate.
7. An organisation donation with no disclosure choice fails validation. ANONYMOUS organisations and non-opted-in individuals never appear on `/transparency`; DISCLOSED ones do. An international capture with FCRA off is auto-refunded in full; the donation ends REFUNDED with no receipt number.
8. Recurring with FakePaymentProvider: two `subscription.charged` → two donations and two receipts. `pending` → PAST_DUE plus notification. `halted` → HALTED. A dashboard cancel calls `cancelSubscription`.
9. `createLot` fails with a distinct error code for each of: artwork status not in {VERIFIED, IN_EXHIBITION, RETAINED}, `auctionCandidate=false`, `allowAuction=false`, missing AUCTION_OF_ARTWORK consent, minor without guardian consent. A minor whose consent says FULL_NAME gets a FIRST_NAME_INITIAL lot. No public API or page exposes the creator's DOB, exact age, or the reserve amount.
10. Users without a verified phone, without accepted terms, under 18, suspended, or holding FINANCE or AUCTION_MANAGER can't bid.
11. 50 concurrent equal bids on one lot: exactly 1 accepted, 49 `BID_TOO_LOW`; the current price always equals the resolved highest VALID bid. A bid 30s before close sets `closesAt = now + 120s`. A bid at or after `closesAt` (DB time) gets `LOT_CLOSED`. The close job never closes a lot whose close was extended.
12. Proxy: A sets max ₹5,000, B bids ₹3,000 → A leads at ₹3,000 + increment. B bids ₹6,000 → B leads at ₹6,000 and A gets `bid.outbid`.
13. Reserve not met → CLOSED_UNSOLD and artwork → `statusBeforeListing`. A non-paying winner gets a strike after 72h and the next bidder gets a second-chance offer. The defaulter's later payment is auto-refunded (`LATE_CAPTURE`).
14. Consent withdrawal on a LIVE lot cancels it, notifies bidders and reverts the artwork. The same withdrawal after PAID leaves the sale intact.
15. PAID sets the artwork to SOLD, posts `AUCTION_PROCEEDS`, creates payouts per the snapshot, and issues an acknowledgement letter that names the buyer only if `shareNameWithArtist`.
16. UPDATE or DELETE on `LedgerEntry` fails at the DB level. A reversal nets to zero. A manual EXPENSE without an attachment, or a manual posting into a LOCKED month, is rejected.
17. `/transparency` reflects only PUBLISHED months. Self-approval of a period or report publish is rejected. An automated test asserts the snapshot JSON contains no email, phone, PAN or payment-id patterns.
18. Budget-vs-actual figures equal the ledger sums per category, and the CSV export of the same range sums to the same totals. Reconciliation turns a provider-captured, DB-CREATED payment into CAPTURED with an INFO issue and posts its gateway fee.

### 8.14 Open Questions (this section)

1. **80G / 12A / CSR-1 status.** Default applied: `org.has80G=false`. No PAN capture, generic donation receipts, Form 10BD export dormant. Templates and the config switch are ready.
2. **FCRA registration.** Default: `org.fcraEnabled=false`. INR and domestic methods only, citizenship declaration, international payments auto-refunded. FCRA mode is specified but not built.
3. **Auction proceeds split.** Default: 100% to FOA (`foaBps=10000`) for every competition, with creator and school recognised by an acknowledgement letter. Configurable per competition; payouts go to the guardian's or the school's account.
4. **Can minors' artwork be auctioned at all?** Default: yes, but only with guardian-given AUCTION_OF_ARTWORK consent plus GUARDIAN_VERIFIED, credit capped at FIRST_NAME_INITIAL, and copyright kept by the creator. Turning it off means one guard flag that blocks under-18 creators.
5. **Recurring donation default.** Default: ONE_TIME preselected, MONTHLY offered. Monthly is capped at ₹15,000, gets a receipt per charge, and requires an account.
6. **GST on registration fees and auction sales.** Default: no GST invoices; amounts are final. FOA's accountant must confirm before go-live.
7. **Auction logistics.** Default: India-only shipping, FOA absorbs the cost (`INCLUDED`), 72h payment window, up to 2 second-chance offers at the bidder's own highest bid.
8. **Disclosure depth on `/transparency`.** Default: DISCLOSED organisations with FY totals, individuals by name only, budgets hidden.
