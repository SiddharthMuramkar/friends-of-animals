# 77b: Bulk fee payment, Razorpay (#77, M1, L, risk)

Branch `ticket/77-razorpay`, worktree `/root/foa-wt/77b`. Blockers: 65 (CSP), 77a (port, use cases). Keys X4, X10.
Head start on the branch (cut from `foa/M0`): `src/server/ports/razorpay/signature.ts` + test. Both checks follow Razorpay's docs, and the test uses Razorpay's published Checkout example as a vector.

## Scope
- **In (77b):** the Razorpay adapter of 77a's `PaymentGateway`, over `fetch` (no SDK). The non-production fallback adapter (a hosted test checkout, so previews work before HR-09). Gateway selection by `APP_ENV`. Optional `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET`, required only in production, where the adapter fails closed. `POST /api/webhooks/razorpay` (raw body, no session). The pay page with the Checkout island, the Checkout-return server action, the batch status/receipt page, the `payments` messages namespace, and CSP plus `Permissions-Policy: payment` allowances for the pay page only.
- **Out:** 77a owns the use cases, tables, capture funnel, numbers and outbox events. 77c owns the journey and the dashboard link. #80 adds refunds through the adapter (add `refund` then).

## Acceptance checks
1. The Razorpay adapter passes 77a's contract against an injected `fetch` double that records requests. `createOrder` POSTs `/v1/orders` with Basic auth, integer `amount` in paise, `currency: "INR"`, `receipt` = batch id and `notes`. `fetchOrderPayments` GETs `/v1/orders/{id}/payments` and maps status, amount (bigint) and currency. Seam 1, adapter level.
2. Checkout signature: Razorpay's documented example verifies; another order, payment or secret fails; a malformed signature is false; an empty secret throws. Done (16 tests).
3. Webhook: `readWebhook` verifies `X-Razorpay-Signature` over the raw body, reads the event id from `x-razorpay-event-id` and the order id from `payload.payment.entity.order_id` (or `payload.order.entity.id`), and returns null on a bad or missing signature.
4. Selection (pure): production + keys → `razorpay`; production without keys → throws on first use. Preview, staging or local: keys present → `razorpay-test`, keys absent → `fallback`.
5. The fallback adapter passes the same contract (PGlite). Its test checkout page `/payments/test-checkout/[orderId]` records a captured or failed payment and returns through the same `confirmCheckout`. In production it returns 404 and the adapter refuses to build.
6. Webhook route: valid → 200 and the batch is captured; replay → 200 with no change; bad signature → 400. `Cache-Control: no-store`. The proxy and auth never redirect it. Seam 2 (route) plus Seam 1 (use case in 77a).
7. Pay page `/institution/registrations/[ref]/pay`: student count, fee each, total via `getFormatter()` `inr`. "Pay" opens Checkout (or the fallback). A successful return lands on `/institution/registrations/[ref]/payments/[batchId]`, which lists every registration with its number. If the batch is still `order_created`, the status page calls the use case's sync once on view, which covers previews that webhooks can't reach. Seam 2, `tests/e2e/77-pay-page.spec.ts`, with `expectRendersAccessibly` (light and `.dark`) on both pages.
8. CSP: the pay route alone adds Razorpay's Checkout origins (script, frame, connect, as Razorpay's docs list at build time) to #65's nonce CSP, plus `payment=` for Razorpay. Public pages' headers are unchanged. Test: `src/lib/security-headers.test.ts` (extended).
9. Authorization: signed out → redirect to sign-in. Another institution's coordinator gets `ExplainState` denial (77a's use cases refuse). Seam 1 through 77a, Seam 2 for the redirect.
10. No visible literals: every string comes from `messages/en-IN/payments.json` (new namespace plus a `NAMESPACES` entry).

## Files
New: `src/server/ports/razorpay/{signature.ts (done), gateway.ts, webhook.ts}`, `src/server/ports/payment-gateway-fallback.ts` (+ table `gateway_test_payment` in `schema/payments.ts` or its own `schema/payment-test-gateway.ts`), `src/server/ports/payment-gateway-select.ts`, `src/app/api/webhooks/razorpay/route.ts`, `src/app/institution/registrations/[ref]/pay/{page.tsx,_components/checkout-button.tsx,actions.ts}`, `src/app/institution/registrations/[ref]/payments/[batchId]/page.tsx`, `src/app/payments/test-checkout/[orderId]/page.tsx`, `messages/en-IN/payments.json`, `tests/e2e/77-pay-page.spec.ts`.
Hotspots: `src/env.schema.ts` + `.env.example` (serialize with #75's `PII_HASH_KEY`), `src/server/deps.ts` (swap `unconfiguredPaymentGateway` for the selection), CSP config `next.config.ts` / `src/lib/security-headers.ts` / `src/proxy.ts` (X4/X2, after #65), `src/i18n/messages.ts`, `src/lib/app-routes.ts`, the migration for the test-payment table.
Read first: `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`, `03-api-reference/03-file-conventions/route.md`, `02-guides/forms.md`, and #65's code on trunk.

## Design
- **A. Checkout-signature-first (chosen, with 77a's funnel):** the Checkout return posts `{paymentId, signature}` to a server action. `confirmCheckout` checks the signature against our stored order id, then fetches the order's payments and applies the decision. The webhook (staging and production) feeds the same funnel. The status page syncs once on view. This works on previews with no webhook at all (issues-M1 finding 0.2.5).
- **B. Order-polling-first:** the status page polls `fetchOrderPayments` every few seconds and ignores the Checkout signature. It is simpler UI but slower and chattier, and it trusts nothing the payer sends back, which A already guarantees by refetching. Rejected.
- Fallback adapter: DB-backed (`gateway_test_payment`), because previews run serverless and payment state must survive between requests. It signs Checkout returns with a fixed non-secret key; that's acceptable because it never builds when `APP_ENV=production`.
- No Razorpay SDK: two endpoints plus HMAC don't justify a dependency (no new pins, no `allowBuilds`).

## Interface needs
```ts
// 77a
import type { PaymentGateway, CheckoutParams, GatewayPayment, Money } from "@/server/ports/payment-gateway";
paymentGatewayContract(name: string, setup: () => Promise<{ gateway: PaymentGateway; capture(orderId: string, amount: Money): Promise<{ paymentId: string; signature: string }>; webhook(event: { type: string; orderId: string }, opts?: { signature?: "valid" | "invalid" }): { rawBody: string; headers: Headers } }>): void;
as(actor).payInstitutionFees({ institutionRegistrationId }): Promise<{ kind: "checkout"; batchId: string; checkout: CheckoutParams } | { kind: "confirmed"; registrationIds: string[] }>;
as(actor).confirmCheckout({ batchId, paymentId, signature }): Promise<{ status: PaymentBatchStatus }>;
as(visitor).receiveGatewayWebhook({ rawBody, headers }): Promise<{ outcome: "applied" | "duplicate" | "rejected" | "ignored" | "not_payable" }>;
as(actor).getPaymentBatch({ batchId, sync?: boolean }): Promise<PaymentBatchView>;
// #65: a per-route CSP allowance, e.g.
type CspAllowance = { routes: string[]; scriptSrc?: string[]; frameSrc?: string[]; connectSrc?: string[] }; // + the nonce from headers()
// #57/#59: resolveActor() in server actions; app-routes registry; form kit SubmitButton/FormAlert
```

## Residue
- HR-09: Razorpay test keys plus the webhook secret in Vercel Preview and staging, and the webhook URL on staging. Until then previews run on the fallback, and the PR records which adapter ran.
- HR-15: live KYC and live keys before production payments.
- HR-27: no CSP violations on staging after `M1 → main`.
- HR-28: a real-device check of the pay page and Checkout (iOS 16).

## Test plan
Seam 1: the adapter contract over a fetch double (Razorpay), the contract on PGlite (fallback), selection, the webhook parser, and the CSP header test. Seam 2 (written, not run here): `77-pay-page.spec.ts` with axe on both pages. Not run: Seam 2 (no Postgres server; Vercel previews fail at `pnpm db:migrate`), and real Razorpay test mode (HR-09).

## Slices
1. Signature (done) plus the Razorpay adapter and webhook parser over injected fetch (AC 1–3). Test: `src/server/ports/razorpay/gateway.test.ts`.
2. Fallback adapter, test-payment table, selection, env schema (AC 4, 5). Test: `src/server/ports/payment-gateway-fallback.test.ts`.
3. Webhook route, deps wiring, CSP allowance (AC 6, 8). Test: `src/lib/security-headers.test.ts`.
4. Pay page, Checkout island and action, status page, test-checkout page, messages (AC 7, 9, 10). Test: `tests/e2e/77-pay-page.spec.ts`.
