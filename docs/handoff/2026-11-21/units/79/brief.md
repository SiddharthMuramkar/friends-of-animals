# 79: Offline payments and payments needing review (#79, M1, L, risk)

Branch `ticket/79-offline-payments-and-payments-needing`, worktree `/root/foa-wt/79`. Blockers 63a (files), 77a (payments core),
78 (X10 serialization on `schema/payments.ts`). Extra (spec): #60 staff 2FA gate on `/admin/**`. No siblings: this unit is all of #79.
Head start `5691a2f` (cut from `foa/M0`, pure, no schema): `src/server/payments/domain/{offline-payment,review-case}.ts` + tests.

## Scope
- **In:** `recordOfflinePayment` (cheque, bank transfer, cash; reference; private proof file via 63a) with the same effect as an
  online capture, through 77a's capture path. Detection of captures that can't be accepted, inside 77a's funnel (`syncBatch`),
  so webhook, Checkout return and any sweep all route the same way: the batch moves to `needs_review`, a review case opens, and
  nothing is refunded. `listPaymentReviewCases`, `getPaymentReviewCase`, `resolvePaymentReviewCase` (outcome + reason).
  `getOfflinePaymentProof` (signed URL, staff only). Batch machine rows, `can()` rules, audit, inventory rows, preview seed,
  three admin pages + namespace `adminPayments`, Seam 2 axe spec.
- **Out:** issuing refunds (#80 reads resolved cases with `refund_due` and runs its duplicate path; 80a), the ledger (#105),
  the payer-facing "pay by cheque or transfer" panel and FOA bank details (77b's pay page; needs FOA facts, not built),
  partial payments, editing or voiding an offline payment (later; record a review case instead).

## Acceptance checks (Seam 1 = `h.as(actor).<useCase>` on PGlite + real migrations, FakeClock, FakePaymentGateway, FakeStorage)
1. **Offline capture** (S1). Finance records `{batchId, method:"cheque", reference:"004512", amountMinor:<batch amount>,
   receivedOn:<IST today>, proofFileId}` on an `order_created` batch of N: batch `captured`, `capture_method = offline`,
   `captured_at` = clock; one `offline_payment` row (normalised reference, `recorded_by`); N registrations `confirmed` with numbers
   matching `^[A-Z]{3,6}\d{2}-R-[0-9A-HJKMNP-TV-Z]{6}$`; outbox `payment.batch_captured` + N `registration.confirmed` in the same
   transaction; audit `payment.offline_recorded`, batch captured, each confirmation. After `h.drain()`: receipt + N confirmations.
   A `created` batch (order not yet opened) is accepted too.
2. **Roles** (S1). `finance`, `staff_admin`, `super_admin` pass. The batch's own `institution_coordinator`, a
   `competition_manager`, a member and a visitor get `forbidden` with no row, audit or outbox change. Same table for
   `listPaymentReviewCases`, `resolvePaymentReviewCase`, `getOfflinePaymentProof`.
3. **Refusals, nothing written** (S1 + pure, done). Field errors: `reference_invalid` (cheque ≠ 6 digits; transfer ≠ 8–35
   letters/digits; cash receipt ≠ 1–40 of letters, digits, space, `/`, `-`), `amount_invalid` (≤ 0), `amount_mismatch` (≠ batch),
   `received_on_invalid`, `received_in_future` (after IST today), `received_too_long_ago` (> 366 days). Use-case refusals:
   `proof_invalid` (missing, not the actor's, purpose ≠ `offline_payment_proof`, status not `uploaded|scanning|clean`),
   `already_paid` (batch captured; a double submit lands here, one row), `batch_not_payable` (failed, cancelled, needs_review),
   `registration_not_payable` (a registration withdrawn/cancelled). A closed registration window does **not** block it.
4. **Late capture → needs_review, 0 refunds** (S1). Each case: batch → `needs_review`, one `payment_review_case`
   (reason, gateway payment id, `batch_status_before`, opened_at), webhook row outcome `needs_review`, audit `payment.review_opened`,
   nothing confirmed that wasn't, and the gateway fake records **no refund call**. Replaying the webhook adds no second case.
   a) A superseded by B, B captured, A's order paid → `already_paid`. b) Registration withdrawn while the order was open →
   `registration_cancelled`. c) Clock past the competition's registration close → `registration_closed`. d) Batch captured offline,
   then a gateway capture on its order → `already_paid`, registrations stay confirmed. e) Two captures on one order → batch
   captured for the first and a case `already_paid` for the second. f) Captured amount ≠ batch → `amount_mismatch` (replaces
   77a AC 11's "stays order_created + audit"; 77a's audit row stays). g) A superseded, B still open, A paid → `batch_superseded`.
5. **List** (S1). `listPaymentReviewCases({ state: "open" | "resolved" })`: newest first; batch id, payer (institution name or
   person), reason, amount, opened_at, resolution fields when resolved.
6. **Resolve** (S1 + pure, done). `resolvePaymentReviewCase({ caseId, outcome, reason })` records outcome, reason (trimmed,
   10–2000 chars, else `reason_required` / `reason_too_long`), `resolved_by`, `resolved_at` = clock, audit `payment.review_resolved`
   (before/after). `confirm` (only for amount_mismatch, registration_closed, batch_superseded, and only when no other case on the
   batch is open) → batch `captured`, registrations confirmed with numbers through the capture path; each must still be awaiting
   payment, else `registration_not_payable`; an open newer batch holding them is superseded. `refund` → `refund_due = true`
   (for #80), no gateway call. `keep` → no money movement. refund/keep: batch back to `captured` if it was captured before
   review, else `cancelled` (items released). Twice → `already_resolved`.
7. **Batch transition table** (pure, edit 77a's `batch-status.ts` + test). Statuses + `needs_review`; events + `offline_recorded`,
   `review_opened`, `review_confirmed`, `review_cleared`, `review_dismissed`. New rows: created/order_created –offline_recorded→
   captured; order_created/captured/cancelled/failed/needs_review –review_opened→ needs_review; needs_review –review_confirmed→
   captured, –review_cleared→ captured, –review_dismissed→ cancelled. Every other pair stays refused (77a's exhaustive test).
8. **Proof delivery** (S1). Finance (not the uploader) and staff_admin get a signed URL for a `clean` proof; coordinator and member
   `forbidden`. 63a's gate still applies (`file_not_ready` while scanning for non-uploaders).
9. **Seed** (S1). `seed.preview()` adds one cheque-paid batch and one `needs_review` batch with an open `registration_closed`
   case; running it twice changes nothing.
10. **Inventory** (Vitest). Rows for `offline_payment.reference`, `.proof_file_asset_id` (cheque images hold account no. and
    signature), `.recorded_by_user_id`, `payment_review_case.resolution_reason` (free text), `toConfirm: true`.
11. **axe** (S2, written, Not run). `/admin/payments/batches/[id]`, `/admin/payments/review`, `/admin/payments/review/[id]`, light
    and `.dark`: `tests/e2e/79-offline-payments.spec.ts`.

## Files
- **Done (head start):** `src/server/payments/domain/offline-payment.ts` (methods, reference normalisation, field checks, IST
  date) and `review-case.ts` (reasons in precedence order, `reviewReasonFor`, `allowedOutcomes`, `planResolution`,
  `characterCount` in graphemes for the reason length), with tests (93).
- **New:** `src/server/payments/{record-offline-payment,open-review-case,list-review-cases,resolve-review-case,
  get-offline-payment-proof}.ts` + tests; `src/app/admin/payments/batches/[id]/{page.tsx,actions.ts,_components/*}`,
  `src/app/admin/payments/review/{page.tsx,[id]/page.tsx,[id]/actions.ts}`, `messages/en-IN/adminPayments.json` (shared with #80),
  `tests/e2e/79-offline-payments.spec.ts`; one generated migration `79_offline_review`.
- **Touch, 77a's files (X10, after 78):** `schema/payments.ts` (append enums `offline_payment_method`, `payment_capture_method`,
  `payment_review_reason`, `payment_review_outcome`; `needs_review` appended to `payment_batch_status`; column
  `payment_batch.capture_method` nullable; tables `offline_payment` (batch_id unique, method, reference, amount_minor,
  received_on date, proof_file_asset_id → file_asset, recorded_by_user_id, recorded_at) and `payment_review_case` (batch_id,
  reason, gateway_payment_id unique nulls-distinct, amount_minor, batch_status_before, opened_at, resolved_at, resolved_by_user_id,
  outcome, resolution_reason, refund_due bool default false)); `domain/batch-status.ts` (AC 7); `domain/capture-decision.ts`
  (after `captured`, report captured payment ids not yet known → review); `sync-batch.ts` (route via `reviewReasonFor`);
  `receive-gateway-webhook.ts` (outcome `needs_review`); `seed/payments.ts`.
- **Touch, 63a's files:** `domain/purposes.ts` (`offline_payment_proof`: pdf/png/jpeg/webp, 10 MiB, all envs) + enum value;
  `file.read` rule: purpose `offline_payment_proof` → finance, staff_admin, super_admin.
- **Registries (one line each):** `src/server/app.ts`, `can()` policy, `src/i18n/messages.ts`, `src/lib/app-routes.ts`,
  `src/server/privacy/inventory.ts`, `drizzle/meta/*` (merge queue).
- **Migration rules:** `ALTER TYPE … ADD VALUE` for `needs_review` and `offline_payment_proof`, neither used in DDL. No partial
  index on an enum value: "one offline payment per batch" is a plain unique on `batch_id`.

## Design (codebase-design vocabulary; risk: money, auth, PD)
- **A. Status-only extension** (`captured_offline` + `needs_review` statuses). Every reader of "paid" (#80 refunds, #105 ledger,
  dashboards) must learn two paid statuses; a captured batch that receives a duplicate loses its paid status; where review returns
  to is stored nowhere. Shallow: the knowledge leaks to every caller. Rejected.
- **C. Review as a side table only** (no batch status). Smallest change to 77a, but fails AC "the batch moves to needs-review"
  and the table AC, and #80 could refund a batch whose money is in dispute. Rejected.
- **B. One `captured` status + `capture_method` column + `payment_review_case` aggregate + `needs_review` status (chosen).**
  Readers keep one paid status. Two deep pure modules carry the rules: `reviewReasonFor` (one landing decision inside 77a's
  funnel, so all signals behave the same and replays stay idempotent through the unique gateway payment id) and `planResolution`
  (outcome × reason × status-before → batch event, confirm or not, refund due). Use cases stay thin: `can()`, lock the batch
  `FOR UPDATE`, decide, write, audit, emit. Offline capture reuses 77a's `confirmRegistrations`, so "same effect" holds by
  construction. Each case stores `batch_status_before`; a second case on a batch in review copies it.
- **Defaults (reversible, residue HR-34):** amount must equal the batch amount; receipt date within 366 days; proof accepted while
  the scan runs (delivery stays gated), so money isn't held up by the scanner; outcomes confirm/refund/keep; reason ≥ 10 chars;
  finance, staff_admin, super_admin may record and resolve (super admin named explicitly: 59a has no wildcard).

## Interface needs (code against these; adapt names to what lands, never wrap)
```ts
// 77a
syncBatch(ctx: UseCaseContext, batchId: string): Promise<SyncOutcome>;      // funnel; 79 adds the "needs_review" outcome
confirmRegistrations(tx: AppDb, ctx: UseCaseContext, b: { batchId: string; capturedAt: Date }): Promise<{ registrationIds: string[] }>;
nextPaymentBatchStatus(from: PaymentBatchStatus, event: PaymentBatchEvent): PaymentBatchTransition;
decideCapture(batch: BatchForCapture, payments: readonly GatewayPayment[]): CaptureDecision;
paymentBatch{ id, payerUserId, institutionRegistrationId, route, status, amountMinor, currency, gatewayOrderId, gatewayPaymentId, capturedAt, createdAt }
paymentBatchItem{ id, batchId, registrationId, amountMinor, releasedAt }; gatewayWebhookEvent{ eventId, outcome, ... }
h.gateway: FakePaymentGateway  // capture(orderId, { amountMinor? }), calls log (no `refund` method exists until #80)
// 75a/75b: registration{ id, status, competitionId }; registrationWindow(competition, keyDates, now): "open" | "closed" | "not_yet"
// 63a
fileAsset{ id, ownerUserId, purpose, status }; getFileDownloadUrl(ctx, { fileId }): Promise<{ url: string; expiresAt: Date }>;
// 59a
authorize(ctx, "payments.offline.record" | "payments.review.read" | "payments.review.resolve" | "payments.offline.proof.read"): Promise<{ role: Role | null }>;
recordAudit(tx, { action, entityType, entityId, before, after, actor, actorRole }): Promise<void>;
// 61a
emit(tx: AppDb, clock: Clock, event: { type: string; aggregateType: string; aggregateId: string; payload: Record<string, unknown> }): Promise<void>;
// harness: h.seed.staff({ role: "finance" }), h.seed.coordinator(), h.seed.enrolledStudents(n, { competition }), h.drain()
```

## Residue
- **HR-31:** retention of proof files, references, resolution text (`toConfirm: true`; financial floor 8 y).
- **HR-34:** the defaults above (amount match, 366-day window, outcomes, reason length, roles). #79 isn't listed there yet: add it.
- **HR-17:** production finance appointments with 2FA. **HR-01:** Seam 2 axe on previews.
- No HR fits FOA's bank details and cheque payee for a payer-facing panel; nothing is built for it here (noted for 77b/HR-21).

## Test plan
Pure (done): `domain/offline-payment.test.ts`, `domain/review-case.test.ts`. Seam 1 per slice. 77a's exhaustive batch table test
gets the new rows. Seam 2: one axe spec (Not run: no Postgres here). Not run: preview E2E.

## Slices
1. Schema + migration + batch rows + `recordOfflinePayment` (ACs 1, 2, 3, 7). Test `src/server/payments/record-offline-payment.test.ts`.
2. Late captures route to review in the funnel (AC 4). Test `src/server/payments/review-detection.test.ts`.
3. List and resolve (ACs 5, 6, 2). Test `src/server/payments/resolve-review-case.test.ts`.
4. Proof delivery, seed, inventory (ACs 8, 9, 10). Test `src/server/payments/offline-proof.test.ts` (+ seed test).
5. Admin pages, `adminPayments` messages, axe spec (AC 11). Tests `src/app/admin/payments/_lib/*.test.ts`, `tests/e2e/79-offline-payments.spec.ts`.
