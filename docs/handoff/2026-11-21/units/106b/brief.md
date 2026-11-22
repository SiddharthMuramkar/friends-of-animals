# 106b: One-time donations with receipts, donate page (#106, M5, L, risk)

Branch `ticket/106-donate-page`, worktree `/root/foa-wt/106b` (not created in prep: no stand-alone core). Blockers: 106a (donations core), 77b (Razorpay adapter, fallback checkout, webhook route), and #65 (CSP registry) through 77b. Key X4 (`next.config.ts`, `src/lib/security-headers.ts`). Hotspots H37 (receipts, shared with 106a), H4 (`robots.ts`), H3 (`src/i18n/messages.ts`), H19 (`app-routes.ts`, admin nav), H32 (CSP registry).
Read first: `node_modules/next/dist/docs/01-app/02-guides/{content-security-policy,forms,server-actions,data-security}.md`, spec §1.7 traps 2–5, 7, 10, 15, and 77b's pay page and Checkout island on trunk.

## Scope
- **In (106b):** pages and edges on top of 106a. `/donate` gains a client form island (amount chips from `donations.presetAmountsMinor` + custom amount, donor type, wall opt-in + name, disclosure radio for corporate/CSR, adult and Indian-source declarations) whose server action calls `startDonation` and redirects. `/donate/checkout/[donationId]?t=` (dynamic; nonce CSP + Razorpay sources; 77b's Checkout island or the fallback). `/donate/thank-you?d=&t=` (status, receipt link, foreign-refund explanation). `/receipts/[token]` (A4 print page from the snapshot; expired → request form). `/receipts/request` (guest reissue). `/admin/donations` + `/admin/donations/[id]` (finance: list, detail, reissue). Use cases `getReceiptByToken`, `reissueReceiptLink`, `requestReceiptLinkByEmail`, `listDonations`, `getDonation`, `getDonationOutcome`. Event `receipt.link_reissued` → template `receipt_link`. Namespaces `donate` (extend), `donationCheckout`, `receipts`, `adminDonations`. `/receipts` in `robots.ts` disallow. Seam 2 spec.
- **Out:** 106a owns tables, capture, numbering, postings, the first receipt link and the minor rule. #110 donor wall and transparency; 110b the M5 journey; #107 the monthly option on the form.

## Acceptance checks
1. `getReceiptByToken({ token })` (visitor): valid → the snapshot view; after `clock.advance({ days: 7, seconds: 1 })` → `expired`; malformed or unknown → `not_found` (no lookup for malformed). **S1**
2. `reissueReceiptLink({ donationId })`: the donor who owns it (donor.user_id) → new token, `receipt_link` message to the donor; the old token stays expired. Finance → new link for any donation (issued_to `finance`, returned, not mailed). Another member and a visitor → refused. Cancelled receipt → `receipt_cancelled`. **S1**
3. `requestReceiptLinkByEmail({ email, receiptNumber })` (visitor): matching email on file → one `receipt_link` message to that address; non-matching or unknown number → nothing sent; both return the identical response. Rate limit per email/IP (reuse #113's helper if landed, else a counter on `receipt_link_request`; default 5/hour). **S1**
4. Snapshot frozen: change org facts and settings after issue → `getReceiptByToken` returns the same fields. **S1**
5. `listDonations` (filters: status, date range, donor type) / `getDonation` → finance passes; content_manager, competition_manager and member refused. No PD beyond what finance needs; disclosure respected in the wall preview. **S1**
6. `getDonationOutcome({ donationId, token })` → `captured` with a fresh donor link, `pending` (calls Payments' sync once, for previews without webhooks), `refund_pending`/`refunded` foreign with the reason, `failed`/`expired` with "try again". Wrong token → `not_found`. **S1**
7. `/donate` stays static (○ in the route table; `pnpm check:build` passes), the heading stays the LCP element, the island is a leaf `"use client"`, initial JS ≤ 170,000 B gz. Signed-in minor sees the guardian `ExplainState` (from `minor_must_ask_guardian`). **Build** + **S2**
8. CSP: only `/donate/checkout/*` adds Razorpay's script/frame/connect origins (from Razorpay's docs at build time) to #65's nonce CSP and `Permissions-Policy: payment=(self "https://checkout.razorpay.com")`; `/donate` and every other public page's headers are unchanged. **Vitest** `src/lib/security-headers.test.ts` (+ #65's CSP test).
9. `/receipts/[token]` and `/receipts/request`: `noindex`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; `/receipts` disallowed in `robots.ts` (`robots.test.ts`). DB-backed GETs call `await connection()`. **Vitest** + **S2**
10. Server actions: authenticate (or visitor), zod-validate, one use case, `can()` first in the use case; Origin check intact. **S1** via use cases
11. No visible literals; four namespaces registered in `NAMESPACES`; kid-safe copy not required (adults only) but banned-phrase test passes. **Vitest**
12. `tests/e2e/106-donate.spec.ts`: `/donate`, `/donate/thank-you` (seeded donation), `/receipts/<seeded token>`, expired receipt, `/receipts/request`, `/admin/donations` (+ detail) with `expectRendersAccessibly`, light and `.dark`; 320–412 px no horizontal scroll. **S2, written, Not run**
13. Lighthouse mobile ≥ 90 performance and accessibility on `/donate` and `/donate/thank-you`. No Lighthouse runner exists (`grep -ril lighthouse` empty, F23): blocked on the harness ticket, recorded under Not run + HR-28.

## Files
New: `src/server/modules/donations/{receipt-links.ts, request-receipt-link.ts, admin.ts, outcome.ts}` + tests; `src/app/donate/_components/donate-form.tsx` (client island), `src/app/donate/actions.ts`, `src/app/donate/_lib/donate-input.ts` (+ test: rupees string → paise bigint, zod schema); `src/app/donate/checkout/[donationId]/page.tsx` (+ `_components/checkout-launcher.tsx` reusing 77b's island); `src/app/donate/thank-you/page.tsx`; `src/app/receipts/[token]/{page.tsx,_components/receipt-sheet.tsx}`; `src/app/receipts/request/{page.tsx,actions.ts}`; `src/app/admin/donations/{page.tsx,[id]/page.tsx,[id]/actions.ts}`; `messages/en-IN/{donationCheckout,receipts,adminDonations}.json`; `tests/e2e/106-donate.spec.ts`.
Touch: `src/app/donate/page.tsx` (island slot below the hero; keep JSON-LD and the "can't" list), `messages/en-IN/donate.json`, `src/i18n/messages.ts`, `src/lib/security-headers.ts` + test / #65's CSP registry (X4, H32), `src/app/robots.ts` + test (H4), `src/lib/app-routes.ts` + admin nav (H19), #69 template `receipt_link`, `src/server/modules/donations/index.ts` (106a's module: add use cases).

## Design (codebase-design; compared in this context)
- **Receipts. A (chosen): render on request from 106a's frozen snapshot** at `/receipts/[token]`: hashed 32-byte token, HTML A4 page with print CSS ("Save as PDF" in the browser). No worker, no storage, no new secret; works on previews today. **B: worker-rendered PDF** in the private bucket + tokenised redirect to a short signed URL: needs the preview worker redeploy (R5-1), Gotenberg (HR-41) and #63 storage, and SigV4's 7-day presign ceiling. Rejected for this unit; a PDF button can follow behind #100's port.
- **Checkout placement. A (chosen): dynamic `/donate/checkout/[donationId]`** with nonce CSP and Razorpay sources on that route only (F6); `/donate` keeps the no-nonce static CSP and its LCP. **B: Checkout island on `/donate`** loosens the public static CSP and loads Razorpay's script on the LCP page. Rejected. **C: Razorpay Payment Links redirect** needs no CSP change but leaves 77b's fallback adapter and signature-verified return. Rejected.
- Guest access to checkout and thank-you: the `?t=` token from `startDonation` (106a stores `checkout_token_hash` on `donation`), compared by hash; never the donation id alone.
- Reissue is a new token per request; nothing ever extends an old link. Finance links are returned on screen, not mailed.

## Interface needs (106a unless noted)
```ts
as(actor).startDonation(i: { amountMinor: bigint; donorType: "individual" | "corporate" | "csr"; name: string; email: string;
  organisationName?: string; contactPerson?: string; showOnWall: boolean; wallName?: string; discloseOrganisation?: boolean;
  declaredAdult: true; declaredIndianSource: true }):
  Promise<{ ok: true; donationId: string; checkoutToken: string } | { ok: false; reason: "minor_must_ask_guardian" | "amount_out_of_range" | "disclosure_required" | "declaration_required" | "guests_not_allowed" }>;
as(actor).confirmDonationCheckout(i: { donationId: string; checkoutToken: string; paymentId: string; signature: string }): Promise<{ status: DonationStatus }>;
checkoutParamsFor(db: AppDb, donationId: string): Promise<CheckoutParams | null>; // 77a's params for the donation's open batch
// tables: receipt{ id, number, fy, seq, donationId, issuedAt, snapshot: ReceiptSnapshot, templateVersion, cancelledAt }
//         receipt_link{ id, receiptId, tokenHash, expiresAt, issuedTo: "donor" | "finance", createdByUserId, createdAt }
import { hashReceiptLinkToken, mintReceiptLinkToken, receiptLinkExpiresAt, receiptLinkState } from "@/server/modules/donations/domain/receipt-link"; // landed
import { parseReceiptNumber } from "@/server/modules/donations/domain/receipt-number"; // landed
// 77b: <CheckoutButton params={CheckoutParams} onReturn={action} />, fallback page /payments/test-checkout/[orderId]
// #65: registerCspAllowance({ routes: ["/donate/checkout/:path*"], scriptSrc, frameSrc, connectSrc }); nonce via headers()
// #59/#57: resolveActor() in actions; finance role behind the staff 2FA gate (#60)
```

## Residue
- HR-09: Razorpay test keys + webhook on previews/staging; until then previews use the fallback, stated in the PR.
- HR-50: donate form, thank-you, receipt and receipt-link copy. HR-47: receipt layout and wording. HR-14: `receipt_link` SMS off until DLT.
- HR-27: no CSP violations on staging after `M5 → main`. HR-28: real devices, iOS 16, Lighthouse ×3 (no runner here, F23). HR-15: live payments.

## Test plan
Seam 1 for every use case incl. authz; Vitest for `donate-input`, headers, robots, messages. Build gate proves `/donate` stays ○ and within budget. Seam 2 written, Not run (no Postgres server; previews fail at `pnpm db:migrate`). Lighthouse Not run (no runner).

## Slices
1. Receipt read, donor/finance reissue, guest request, frozen snapshot (AC 1–4). Test `src/server/modules/donations/receipt-links.test.ts`.
2. Finance list/detail and the thank-you outcome (AC 5, 6). Test `src/server/modules/donations/admin-and-outcome.test.ts`.
3. `/donate` island + action + `donate-input`, checkout route, CSP and Permissions-Policy (AC 7, 8, 10). Test `src/lib/security-headers.test.ts` + `src/app/donate/_lib/donate-input.test.ts`.
4. Thank-you, receipt, request and admin pages, robots, namespaces, Seam 2 spec (AC 9, 11, 12, 13). Test `tests/e2e/106-donate.spec.ts`.
