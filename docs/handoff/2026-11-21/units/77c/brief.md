# 77c: Bulk fee payment, journey (#77, M1, M, risk)

Branch `ticket/77-journey`, worktree `/root/foa-wt/77c`. Blockers: 76 (CSV import, 30-row fixture), 77b (pages, adapters). No pure core: no head start.

## Scope
- **In (77c):** M1's Seam 2 journey for #77's last AC. An institution registers, is verified, registers for a competition, imports 30 students from CSV, pays in bulk, and sees all 30 confirmed with registration numbers. The coordinator dashboard's "Pay fees" entry and its paid/unpaid summary. The PR states which gateway ran (`razorpay-test` or `fallback`). This unit closes #77 (last of issue).
- **Out:** 77a owns the use cases, seed batches, outbox and Seam 1. 77b owns the adapters, pages, webhook and CSP. #76 owns the importer and its fixture.

## Acceptance checks
1. `tests/e2e/77-bulk-payment.spec.ts`, on desktop and Pixel 7, `retries: 0`:
   - sign up by email OTP from the capture mailbox and register an institution;
   - a seeded staff admin (seeded TOTP secret, #60) verifies it;
   - the authorised person registers for a seeded open competition with an institution fee;
   - import #76's clean 30-row fixture and see 30 enrolled;
   - "Pay fees" shows 30 × fee = total, and paying goes through Razorpay test Checkout or the fallback test checkout;
   - the status page and the dashboard show 30 `confirmed`, each with a distinct number matching `^[A-Z]{3,6}\d{2}-R-[0-9A-HJKMNP-TV-Z]{6}$`.
2. `expectRendersAccessibly` (light and `.dark`) on every page the journey reaches that no earlier spec covers (dashboard with payment summary, pay page states: unpaid, nothing to pay, paid).
3. The journey asserts nothing that needs a new worker handler on the preview (issues-M1 finding 0.2.6). Messages are covered at Seam 1 in 77a.
4. The dashboard (`/institution/registrations/[ref]`) shows "Pay fees" only while payable registrations exist, plus counts of confirmed and unpaid. Seam 1 read model (77a `getPaymentBatch` / #75's dashboard query) and Seam 2.
5. Gateway branch: if `getPaymentBatch().gateway === "razorpay-test"`, drive Razorpay's test Checkout iframe with a test success method, verifying the steps against Razorpay's test-mode docs when building. Otherwise use the fallback "Succeed" button. Never `test.skip` either branch.

## Files
New: `tests/e2e/77-bulk-payment.spec.ts`, `tests/e2e/support/institution-journey.ts` (helpers, if not already in #73–#76 support). Touch: `src/app/institution/registrations/[ref]/page.tsx` (dashboard: a hotspot shared with #75/#76/#83, merge after #76), `messages/en-IN/coordinator.json` (pay entry strings) or `payments.json`.

## Design
Not compared: a single implementation is fine for M, and the only fork is the gateway branch in AC 5. One spec for the whole acceptance path, helpers in `support/`. The gateway is read from the app (the status page shows which adapter ran, from 77b), never from an env var in the test.

## Interface needs
```ts
// #76: tests/e2e/fixtures/students-30.csv (clean 30 rows) and the import page /institution/registrations/[ref]/import
// #73/#60: seeded staff admin with TOTP secret; helper totp(secret, now) in tests/e2e/support
// 77b: pages /institution/registrations/[ref]/pay and /payments/[batchId]; /payments/test-checkout/[orderId] (fallback); data-gateway attribute on the status page
// 77a: seed builders seed.paymentBatch({ paid: boolean }) in the preview seed
```

## Residue
- HR-09 (R-RZP-E2E): re-run the journey on a preview in Razorpay test mode once the keys exist.
- HR-01/HR-02: Seam 2 on previews needs `BETTER_AUTH_SECRET` and `CAPTURE_MAILBOX_TOKEN`, plus the `e2e.yml` env on `main`.
- HR-10: messages on previews need `worker-preview` redeployed from the M1 tip. The journey doesn't depend on it.

## Test plan
Seam 2 only (written, not run here). Not run: the journey on the preview and locally on port 3100 (no Postgres server on this box), and Razorpay test mode (HR-09).

## Slices
1. Dashboard pay entry and summary, then the journey with both gateway branches and axe on the new states (AC 1–5). Test: `tests/e2e/77-bulk-payment.spec.ts`.
