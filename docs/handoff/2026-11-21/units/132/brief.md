# Brief 132: bidding with outbid alerts and anti-sniping (#132, M8)

Branch `ticket/132-bidding-with-outbid-alerts-and` · worktree `/root/foa-wt/132` · cut from `foa/M0` 442dd99 (rebase onto `foa/M8` at build) · size L · risk (money, concurrency, adult gate, PD) · key **X8** (`.github/workflows/ci.yml`) · blockers **131** (lots, close job) and **114** (inventory coverage test); through them 59a, 61a, 62, 69, 75, 78, 81a. No siblings: unit 132 is the whole issue.
**Head start on the branch:** the pure bidding core in `src/server/modules/auctions/domain/` (see "Pure core" below). Keep it; build on it.

## Scope
**In:** `auction_bid` and `bidder_profile` tables plus the bidding columns on #131's `auction_lot`; use cases `saveBidderProfile`, `placeBid`, `getLotState`, `listMyBids`; the anti-sniping extension and the close-job reschedule; the `auction.outbid` message (email + in-app) through #69's routes; three settings; the bid panel island on `/auctions/[lotCode]` with polling; `GET /api/auctions/[lotCode]/state`; `/dashboard/bids` and `/dashboard/bidder-profile`; inventory rows; seed; a real-Postgres concurrency suite plus a `postgres` service job in `ci.yml` (X8).
**Out:** lot creation, scheduling, open/close outcomes, cancellation and the public lot pages themselves (**#131**); winner payment, delivery, letters (**#133a/b**); proxy/auto bids, reserve disclosure, bid retraction, staff bid removal, SMS (no DLT template asked for), shill-bid detection beyond "staff on the lot can't bid".

## Acceptance criteria as testable checks
1. **Increment** (S1 + pure). With current ₹1,000 and increment ₹100, `placeBid({ lotId, amountPaise: 109_900n })` → `{ ok:false, reason:"bid_too_low", minimumPaise:110_000n }`; ₹1,100 is accepted. First bid below base → `bid_below_base`; a first bid at exactly base is accepted. Nothing is written on refusal.
2. **Two simultaneous bids can't both win** (pure + S1 + real PG). Pure: two ₹1,100 bids decided from the same snapshot, applied in order → one accepted, the other `bid_too_low`. S1: `Promise.all` of two `placeBid` → exactly one `auction_bid` row, `current_bid_paise` = the accepted amount. **Real PG** (`src/server/modules/auctions/bidding.pg-test.ts`, `pnpm test:pg`): 20 bids from 20 connections at the same amount → 1 stored; 20 ascending bids raced → `current_bid_paise = max(accepted)`, `bid_count = rows`, every stored bid ≥ its predecessor + increment.
3. **Late bid extends the close** (S1, fake clock). Window 5 min: a bid at `closes_at − 5 min + 1 s` sets `closes_at` to old + 5 min, `extension_count` +1, emits `auction.lot_extended`. A bid at exactly `closes_at − 5 min` doesn't extend. `clock.advance` past the original close → `placeBid` still accepted, `getLotState` says open; drain the close job at the original time → it reschedules (lot stays `open`); advance past the new close and drain → #131 closes it. A bid at or after `closes_at` → `lot_closed`.
4. **Outbid message** (S1). A outbids nobody; B outbids A → after `h.drain()`, A has exactly one `auction.outbid` email and inbox item naming the lot and the new minimum; B gets none. A raising their own leading bid sends nothing.
5. **Minors can't bid** (S1). A signed-in teen (81a linked login, guardian link active) → `placeBid` and `saveBidderProfile` both `minor`; a profile with a declared DOB under 18 (IST date of `clock.now()`) → `minor`; a user whose participant profile DOB is under 18 → `minor`, even with an adult declared DOB. Adult without a bidder profile → `bidder_profile_required`; profile on old terms version → `terms_not_accepted`.
6. **Authorization, every new use case** (S1). `placeBid`: adult member allowed; visitor `forbidden`; minor refused (5); a user holding `auction_manager` (global or on this lot's competition) `forbidden`. `saveBidderProfile`/`listMyBids`: signed-in user allowed, visitor `forbidden`. `getLotState`: visitor allowed for an `open`/`scheduled`/`closed` lot, `not_found` for `draft`/`cancelled`.
7. **Public state is pseudonymous** (S1 + pure). `getLotState` JSON contains no user id, name, email or phone (assert by deep-scanning for every seeded bidder's id/name/email); bidders appear as numbers 1…n in first-bid order; the viewer sees only their own number and `leading`.
8. **Inventory** (S1, #114's coverage test). Entries for `bidder_profile.{full_name,date_of_birth,phone}`, `auction_bid.bidder_user_id`, `auction_lot.current_bidder_user_id`; every other new column on `NON_PERSONAL`. `pnpm test` stays green with #114's coverage test.
9. **axe** (S2, written, **Not run**). `tests/e2e/132-bidding.spec.ts`: adult A bids, adult B outbids, A's inbox shows the outbid item (seeded, see HR-10), seeded teen sees "adults only"; `expectRendersAccessibly` light + dark on `/auctions/[lotCode]` (bid panel states: sign in, profile needed, can bid, refused), `/dashboard/bids`, `/dashboard/bidder-profile`; no horizontal scroll at 320 px.
10. **Close to live** (S1 + S2). `/api/auctions/[lotCode]/state` sends `Cache-Control: no-store`, an `ETag` of `version`, and 304 on `If-None-Match`; the island polls every `auctions.pollIntervalSeconds` (5) while the tab is visible and the lot is open. Lot page stays ◐ (`check:build`), JS budget unchanged within 170 kB.

## Files
- **Exists (head start):** `src/server/modules/auctions/domain/{bid-rules,anti-sniping,bidder-eligibility,bidder-numbers,bid-amount}.ts` + tests.
- **New:** `src/server/db/schema/auction-bids.ts` (`auction_bid`: id uuidv7, lot_id FK, bidder_user_id FK, amount_paise bigint, placed_at, `unique(lot_id, amount_paise)`, index `(lot_id, placed_at desc)`, `(bidder_user_id, placed_at desc)`; `bidder_profile`: user_id PK FK, full_name enc, date_of_birth enc, phone enc, terms_accepted_version, declared_at, updated_at); migration `--name 132_bidding` adding to `auction_lot`: `current_bid_paise bigint null`, `current_bidder_user_id uuid null FK`, `bid_count int default 0`, `original_closes_at timestamptz` (backfill = closes_at in a `--custom 132_pre_backfill` only if #131 rows can exist; previews start empty), `extension_count int default 0`, `version int default 0`, CHECK `current_bid_paise >= base_price_paise`. No enum values added (F2: #131 defines the full status enum).
- `src/server/modules/auctions/bidding/{place-bid,bidder-profile,lot-state,my-bids,use-cases,events,policy}.ts` + Seam 1 tests; `src/server/seed/auction-bids.ts`; `src/app/api/auctions/[lotCode]/state/route.ts`; `src/app/auctions/[lotCode]/_components/{bid-panel.tsx,bid-panel-island.tsx}` + `_lib/poll.ts` (+ test); `src/app/dashboard/{bids,bidder-profile}/**`; `messages/en-IN/auctionBidding.json` (own namespace, not #131's `auctions`, §1.10); `vitest.pg.config.ts` (new file, includes `src/**/*.pg-test.ts`; default config's `*.test.ts` never matches it, so no skip); `tests/e2e/132-bidding.spec.ts`.
- **Hotspots (append one line/entry each):** schema barrel (H1); `seed/index.ts` (after #131's seeder, H6); `app.ts` (`biddingUseCases`); #59 policy table (`auction.bid.place`, `auction.bidder_profile.save`, `auction.lot.state`, `auction.bids.mine`, H8); #62 catalogue (3 keys, H7); #61 event union + handler registry (`auction.bid_placed`, `auction.outbid`, `auction.lot_extended`, H9); #69 route + template seed (`auction.outbid`), audience resolver if `payload.userId` isn't generic; #131's close handler (reschedule branch, H10) and cancellation path (message bidders); #131's `/auctions/[lotCode]/page.tsx` (one Suspense + `<BidPanel>`); #114 inventory + `NON_PERSONAL` (H5); `src/i18n/messages.ts` (H3); `app-routes.ts` + dashboard nav (H19); `package.json` (`test:pg`); **`.github/workflows/ci.yml` (X8)**: one `pg-concurrency` job with a `postgres:18` service running `pnpm db:migrate` then `pnpm test:pg`.

## Design (codebase-design; three interfaces compared, chosen = a)
- **(a) Row lock (chosen).** `placeBid` = `authorize` → eligibility → one transaction: `SELECT … FROM auction_lot WHERE id = $1 FOR UPDATE` → pure `decideBid(snapshot, bid, rules, now)` → insert bid, update lot from `decision.next`, `version+1`, `emit()` events. Every bid is decided against the committed latest state, so the interleave test passes by construction and the real-PG suite proves it. Row locks are transaction-scoped, so it's safe through PgBouncer transaction mode (§1.9 forbids session state, not row locks). Contention is one charity lot's bidders: negligible.
- **(b) Optimistic CAS on `version`** + bounded retry: same pure core, no lock wait, but a retry loop plus a "gave up" error that leaks to users at the moment it matters most (the last minute). More interface (retry budget), no benefit at this load.
- **(c) Append-only log + `unique(lot_id, amount)` + `SERIALIZABLE` retry:** the unique index alone doesn't stop ₹1,100 and ₹1,150 both landing on a ₹1,000 snapshot (1,150 < 1,100 + 100), so it leans fully on SSI retries (40001) and a derived "current" read on every poll. Rejected; its unique index is kept in (a) as a belt-and-braces constraint.
- **Depth:** the whole rule set (open window, base, increment, self-raise, outbid target, anti-sniping) sits behind one pure `decideBid` that returns the next lot snapshot; the use case is lock → decide → write. Tests hit the rules without a DB.
- **Anti-sniping rule:** a bid with `closes_at − window < placed_at < closes_at` sets `closes_at = closes_at + window` (the ticket's "extends the closing time by the configured window", which outranks issues-M8's `placed_at + window` reading). Window 0 = off. No cap on extensions (each needs a higher bid, so it ends). One function (`closeAfterBid`): reversible; flagged in HR-66.
- **Close job:** #131 emits a delayed outbox event at `closes_at`. Its handler calls `closeDue(lot.closesAt, now)`: `reschedule` → `emit(..., { availableAt: closesAt })` again, else #131's close. So `placeBid` never touches the queue; a stale job is a no-op reschedule.
- **Live refresh: polling, not SSE.** SSE would hold a function per viewer and still poll the DB (no `LISTEN` through PgBouncer). The island fetches `/state` with `If-None-Match`; 304 when nothing changed. Pauses on `visibilitychange`.
- **Minor gate:** eligibility is pure (`decideBidderEligibility`): minor if *any* known age (declared bidder DOB, participant profiles the user logs into or owns as self) is under 18, or the user has an active guardian link. Ages come from #78's `ageAt` on the IST calendar; DOB stored, never age.
- **Defaults (reversible):** whole-rupee bids; increment ₹100; window 5 min (0–30); poll 5 s (2–60); self-raise allowed and silent; staff with `auction_manager` can't bid.

## Interface needs from blockers (code against these; adapt names at rebase)
```ts
// 131: schema/auctions.ts
auctionLot: { id; lotCode; competitionId; status: AuctionLotStatus; basePricePaise: bigint; reservePricePaise: bigint;
  opensAt: Date; closesAt: Date; currency: "INR" }   // 132 adds the bidding columns above
type AuctionLotStatus = "draft"|"scheduled"|"open"|"closed"|"awaiting_payment"|"sold"|"unsold"|"relisted"|"cancelled";
closeLotHandler(deps: Deps, event: { lotId: string }): Promise<void>;  // 132 inserts the closeDue() branch first
findLotByCode(db: AppDb, lotCode: string): Promise<AuctionLot | null>;
// 59a
authorize(ctx, action: "auction.bid.place"|"auction.bidder_profile.save"|"auction.lot.state"|"auction.bids.mine",
  resource?: { type: "auction_lot"; id: string; scopes: Scope[] }): Promise<{ role: Role | null }>; // throws DomainError("forbidden")
// 61a
emit(tx: AppDb, clock: Clock, event: DomainEvent, options?: { availableAt?: Date }): Promise<void>;
type DomainEvent = ... | { type: "auction.outbid"; aggregate: { type: "auction_lot"; id }; payload: { lotId; bidId; userId } }
  | { type: "auction.bid_placed" | "auction.lot_extended"; aggregate: { type: "auction_lot"; id }; payload: { lotId; bidId } };
h.drain(): Promise<DrainReport>;
// 62
integerSetting({ default, min, max, unit }); readSetting(db, "auctions.minIncrementPaise" | "auctions.antiSnipingWindowMinutes" | "auctions.pollIntervalSeconds"): Promise<number>;
// 69: route row { eventType: "auction.outbid", audience: "event_user", templateKey: "auction.outbid", channels: ["email","in_app"] }
//     audience resolver registry: register("event_user", (event) => [event.payload.userId]) if not already generic
// 58/75: encryptedText(): PgCustomColumn<string>
// 78 / 81a
ageAt(dateOfBirth: CalendarDate, at: Date): number; parseDateOfBirth(text: string, at: Date): CalendarDate | null;
participantProfile: { id; ownerKind; ownerUserId; loginUserId; dob /* encrypted */ };
hasActiveGuardianLink(db: AppDb, loginUserId: string): Promise<boolean>; // guardian_link active for a profile this user logs into
// 114: INVENTORY.push({ table, column, category, purpose, subject: { kind: "user", via }, retention: { policy, defaultDays, basis, toConfirm: "counsel" }, action }); NON_PERSONAL
// 57b: h.signIn(user) → user Actor; session actor in route handlers: getRequestActor(): Promise<Actor>
```

## Residue
- **HR-65:** terms of sale (bid is binding, reserve undisclosed, FOA may cancel) shown before the first bid; the version string gates bidding. Ships as a placeholder draft.
- **HR-66:** increment ₹100, anti-sniping 5 min and its rule (`closes_at + window`, no cap), poll 5 s, self-raise allowed.
- **HR-63:** `auctions.enabled` stays off; bidding is unreachable until FOA turns it on.
- **HR-31:** retention, to confirm: bidder profile 1 year after last bid; losing bids 1 year after close; winning bid + profile follow the 8-year financial floor (#133).
- **HR-05:** reuses the field-encryption keys; nothing new. **HR-10:** previews show seeded outbid items until `worker-preview` runs M8's dispatcher.
- **HR-01/HR-02:** Seam 2 on previews needs the secrets; run locally on port 3100. **HR-28:** real devices for the bid panel.
- Not run here: `pnpm test:pg` (no Postgres server); it runs in CI's `pg-concurrency` job.

## Test plan
- Pure (**landed in prep**): `bid-rules`, `anti-sniping`, `bidder-eligibility`, `bidder-numbers`, `bid-amount` tests.
- Seam 1 (`createHarness()`, fake clock, drain): ACs 1–8, 10 (route handler logic via `getLotState` + a pure `etagFor`).
- Real PG (`pnpm test:pg`, CI job, `DATABASE_URL` to the service): AC 2's 20-connection races. Not run locally.
- Seam 2 (written, Not run): AC 9. Gates: `pnpm check`; build with empty DB vars + `check:build` (lot page ◐, budget held); clean tree.

## Slices (L → 5, each one test file, in order)
1. **Bid on an open lot** (AC 1, 6 place, 2-S1): schema + migration + `placeBid` row lock + settings keys. `src/server/modules/auctions/bidding/place-bid.test.ts`.
2. **Adults only** (AC 5, 6 profile): `bidder_profile`, `saveBidderProfile`, eligibility wiring, inventory rows (AC 8). `.../bidding/bidder-profile.test.ts`.
3. **Anti-sniping and the close job** (AC 3): extension, `auction.lot_extended`, `closeDue` branch in #131's handler. `.../bidding/anti-sniping.test.ts`.
4. **Outbid message and my bids** (AC 4, 6 mine): events, #69 route/template seed, `listMyBids`, cancellation messages bidders. `.../bidding/outbid.test.ts`.
5. **Live state, pages, seed, CI** (AC 7, 9, 10, 2-PG): `getLotState`, `/state` route, island, dashboard pages, seed, `vitest.pg.config.ts` + `ci.yml` job, Seam 2. `.../bidding/lot-state.test.ts` + `bidding.pg-test.ts` + `tests/e2e/132-bidding.spec.ts`.
