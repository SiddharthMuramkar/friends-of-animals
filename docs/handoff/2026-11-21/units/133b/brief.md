# Brief 133b: auction delivery tracking and thank-you letters (#133, M8)

Branch `ticket/133-letters` · worktree `/root/foa-wt/133b` · cut from `foa/M0` 442dd99 (rebase onto `foa/M8` at build) · size M · risk ($ K F2, PD) · no key · H15 (artwork custody enum + transitions: serialize with #131) · blocker **133a**; through it 132, 131, 94, 100a, 81a, 73, 69, 63a, 61a. Sibling **133a** owns offers, payment, capture and the ledger.
**Head start on the branch:** pure core in `src/server/modules/auctions/domain/{delivery-status,delivery-address,thank-you-letters}.ts` + tests. Keep it; build on it.

## Scope
**In:** consumer of 133a's `auction.lot_sold`: artwork `auction_listed → auctioned` through #131/#94's custody API, one `auction_delivery` row, the letters plan. `auction_delivery` (lot_id unique, buyer_user_id, recipient_name/address/phone encrypted, status enum `auction_delivery_status`: awaiting_address, pending_dispatch, dispatched, delivered, receipt_confirmed; courier_name, tracking_number, dispatched_at, delivered_at, receipt_confirmed_at, confirmed_by_user_id, receipt_note). `auction_thank_you_letter` (id, lot_id, recipient_kind enum creator | guardian | school, participant_profile_id, institution_id null, file_asset_id null until rendered, rendered_at, sent_at; unique (lot_id, recipient_kind)). Use cases below, letter PDFs via #100's `PdfRenderer` port into private storage (#63), delivery by message with a signed link, pages, inventory, seed, Seam 2 spec.
**Out:** payment, offers, relist, ledger (**133a**); courier integrations or label printing; returns of a delivered artwork; letters to the buyer (only creator / guardian / school per the ticket); stating the sale price in letters (HR-66 default no).

## Acceptance criteria as testable checks
1. **Sale hands over to fulfilment** (S1, drain). Draining `auction.lot_sold` → artwork `auctioned` (custody event + audit, system actor); one `auction_delivery` in `awaiting_address` for the buyer; buyer gets "tell us where to send it" (email + inbox). Replaying the event → still one delivery row, one custody event, no second message.
2. **Address capture** (S1 + pure). Buyer `saveDeliveryAddress({ lotId, recipientName, line1, line2?, city, state, pincode, phone })` → `pending_dispatch`. Raw SQL on `auction_delivery` contains neither the address line, the pincode nor the phone. Field errors (pincode not 6 digits or starting 0, unknown state, blank line1/city, phone not an Indian mobile via #58's normaliser) write nothing. Editable until dispatch, then `address_locked`.
3. **Tracked to confirmed receipt** (pure table + S1). Manager `dispatchDelivery({ courierName, trackingNumber })` → `dispatched` (dispatched_at = clock; buyer message with tracking); `updateTracking` while dispatched; `markDelivered` → `delivered`; buyer `confirmReceipt` from dispatched or delivered → `receipt_confirmed` (confirmed_by = buyer); manager `recordReceipt({ note })` from delivered only → `receipt_confirmed` (confirmed_by = manager, note 10–500 chars). Every other (status, command) pair → `transition_not_allowed`, nothing written. One audit row per move.
4. **Letters go to the right people** (pure + S1). Minor = under 18 on the IST date of `soldAt` (#78 `ageAt`, DOB stored, never age).
   a) Adult creator, individual route → one `creator` letter to the creator's own login; no school letter.
   b) Under-13 creator (no login), institution route → one `guardian` letter, delivered to every active linked guardian; one `school` letter to the institution's authorised person(s); the child gets nothing.
   c) 13–17 creator with their own login → `guardian` letter only; the teen's login gets no letter or message.
   d) Adult creator, institution route → `creator` + `school`.
   e) Minor with no active guardian link (institution-registered) → no `guardian` letter, a `school` letter, and an in-app task for auction managers to arrange it (`letter_recipient_missing` on the lot's admin page).
5. **Letter files** (S1). Each letter is rendered through `FakePdfRenderer` (the HTML holds the creator's display name, artwork title, competition name, lot code and the sale date; never the price or the buyer), stored private with purpose `auction_letter`, `rendered_at` then `sent_at` set; `getThankYouLetterLink({ letterId })` returns a short-lived signed URL to its recipients (creator, each linked guardian, school admins) and auction managers; another member and finance → `forbidden`. Replaying the event or the render job keeps one letter per kind.
6. **Render failure retries** (S1). Fake renderer `failNext(1)` → the outbox retries, then exactly one file and one message per recipient.
7. **Authorization, every new use case** (S1). `saveDeliveryAddress`, `confirmReceipt`, `getMyDelivery`: the buyer allowed, another member `not_found`, visitor `forbidden`. `dispatchDelivery`, `updateTracking`, `markDelivered`, `recordReceipt`, `listDeliveries`, `getDelivery` (decrypted address): auction_manager allowed; finance, competition_manager, member `forbidden`. Consumers accept only the system worker.
8. **Inventory** (Vitest, #114's coverage test). Rows for `auction_delivery.{buyer_user_id, recipient_name, address, phone, tracking_number, receipt_note, confirmed_by_user_id}` and `auction_thank_you_letter.{participant_profile_id, file_asset_id}`; every other new column on `NON_PERSONAL`. Retention to confirm (HR-31).
9. **Seed** (S1). Preview seed: one delivery per status for 133a's seeded sold lots, with letters rendered by the fake into seeded private files; twice = same rows.
10. **axe** (S2, written, **Not run**). `tests/e2e/133-auction-delivery.spec.ts`: seeded buyer adds an address and confirms receipt on `/dashboard/bids`; manager dispatches on `/admin/auctions/lots/[lotId]/delivery`; `expectRendersAccessibly` light + dark on those two and `/admin/auctions/deliveries`; no horizontal scroll at 320 px.

## Files
- **Exists (head start):** `src/server/modules/auctions/domain/{delivery-status,delivery-address,thank-you-letters}.ts` + tests.
- **New:** `src/server/db/schema/auction-fulfilment.ts`; migrations `133_pre_file_purpose_auction_letter` (`--custom`, `ALTER TYPE file_asset_purpose ADD VALUE 'auction_letter'`, nothing in DDL names it: the F2 flag) then `133_auction_fulfilment` (new enums created whole); `src/server/modules/auctions/fulfilment/{on-lot-sold,delivery,letters,render-letter,letter-html,letter-link,policy,use-cases}.ts` + Seam 1 tests; `src/server/seed/auction-fulfilment.ts`; `src/app/admin/auctions/deliveries/page.tsx`, `src/app/admin/auctions/lots/[lotId]/delivery/{page.tsx,actions.ts}`; `src/app/auction-letters/[letterId]/route.ts` (authorize → 302 to the signed URL, `no-store`); `messages/en-IN/auctionDelivery.json` (own namespace; letter copy lives here too); `tests/e2e/133-auction-delivery.spec.ts`.
- **Hotspots:** H15 #94/#131 custody (`auction_listed → auctioned` row + `markAuctioned`); #132/133a `/dashboard/bids` (delivery panel in the won section); #131 admin lot page (link to delivery); H21 `file_asset_purpose`; schema/seed barrels; `app.ts`; #59 policy (H8); #61 handlers (H9: `auction.fulfilment.on_sold`, `auction.letter.render`); #69 routes + templates (address request, dispatched, letter ready ×3 audiences); #114 inventory; `messages.ts`; admin nav (H19).

## Design (codebase-design; risk-flagged, alternatives compared)
- **Letters, rendering path.** (a) **Outbox consumer renders through the `PdfRenderer` port (chosen).** `auction.lot_sold` → plan rows (pure `planThankYouLetters`) → one `auction.letter.render` delivery per letter: render HTML (pure `letter-html.ts`, copy from `auctionDelivery`), `pdf.render`, `storeGeneratedFile`, then emit `auction.thank_you_letter_ready` so #69 messages each recipient with `/auction-letters/[id]`. Same path as #100's certificates; retries come from #61. (b) Render on request from a frozen snapshot (F5's receipt pattern): no worker or Gotenberg on previews, but the spec's `file_asset_id` and the PDF port go unused and every download re-renders. Kept as the fallback if #100's port isn't on `M8`. (c) Render inside the sale transaction: HTTP inside a DB transaction. Rejected.
- **Delivery state.** Own table + pure `decideDeliveryTransition` (chosen) vs more `auction_lot_status` values (F2 again, and fulfilment would bloat the lot machine). Address is encrypted per column (#58), never logged.
- **Recipient resolution** is pure (`planThankYouLetters(facts)`); one facts loader gathers creator profile, DOB, login, guardians and the institution for the lot. A minor's letter is addressed to the guardian (full child name is fine in a private letter to the guardian); the school letter uses the #82 public credit rule (first name + initial for a minor).
- **Defaults (reversible):** letters at sale, not at receipt; no price (HR-66); courier free text ("Collected in person" allowed); no auto-confirm of receipt; manager may record receipt on the buyer's behalf with a note.

## Interface needs from blockers (code against these; adapt names at rebase)
```ts
// 133a: event { type: "auction.lot_sold"; aggregate: { type: "auction_lot"; id }; payload: { lotId; offerId; buyerUserId; amountPaise: string; soldAt: string } }
// 131/94 custody (H15)
artworkCustody.markAuctioned(tx: AppDb, i: { artworkId: string; lotId: string; actorUserId: null }): Promise<void>; // adds auction_listed → auctioned
lotSaleFacts(tx: AppDb, lotId: string): Promise<{ lotCode; artworkId; entryId; competitionId; competitionName; artworkTitle; buyerUserId; soldAt: Date }>;
// 75b/78/81a: creator of an entry
creatorFacts(tx: AppDb, entryId: string): Promise<{ participantProfileId; givenName; familyName; dateOfBirth: CalendarDate; loginUserId: string | null; route: "individual" | "institution"; institutionId: string | null }>;
activeGuardianUserIds(tx: AppDb, participantProfileId: string): Promise<string[]>; ageAt(dob: CalendarDate, at: Date): number;
// 73: institutionAdminUserIds(tx: AppDb, institutionId: string): Promise<string[]>  (authorised person + institution_admin grants)
// 82: publicCredit(person, optIns): string
// 100a: Deps.pdf: PdfRenderer { render(i: { html: string; filename: string }): Promise<Uint8Array> }; h.pdf: FakePdfRenderer { rendered; failNext(n) }
// 63a: storeGeneratedFile(tx, ctx, { purpose: "auction_letter"; bytes; contentType: "application/pdf"; filename }): Promise<{ fileAssetId }>;
//      signedDownloadUrl(ctx, fileAssetId, { ttlSeconds: 300 }): Promise<string>
// 58: encryptedText(); normaliseIndianPhone(raw): string | null
// 59a: authorize(ctx, action, resource?); recordAudit(tx, ctx, {...}); 61a: emit(tx, clock, event); h.drain()
// 69: audiences "event_user", "user_ids" (explicit list in payload) or "guardian_of_participant" + "institution_admins"
```

## Residue
- **HR-65:** thank-you letter wording (placeholder draft, `placeholder()` where a FOA fact is needed). **HR-66:** no price in the letter; letters at sale.
- **HR-31:** buyer address retention (default: 1 year after receipt confirmed; financial floor if tied to the sale record), to confirm. **HR-05:** reuses the field keys.
- **HR-41:** Gotenberg 9 for real PDFs; **HR-10:** previews render letters only after `worker-preview` runs M8 (seeded letters cover the demo). **HR-06/HR-13:** private bucket for letter files. **HR-01/02, HR-28.**

## Test plan
- Pure (**landed in prep**): `delivery-status`, `delivery-address`, `thank-you-letters` tests.
- Seam 1 (`createHarness()`, fake clock, FakePdfRenderer, fake storage, drain): ACs 1–9; raw SQL for encryption.
- Seam 2 (written, Not run): AC 10. Gates: `pnpm check`; build with empty DB vars + `check:build`; clean tree.

## Slices (M → 1)
1. **Sold lot to confirmed receipt, with letters** (ACs 1–10): schema, migrations, consumer, delivery use cases, letters, pages, seed, inventory, Seam 2. `src/server/modules/auctions/fulfilment/fulfilment.test.ts` (+ `tests/e2e/133-auction-delivery.spec.ts`).
