# Unit 131: Auction lots from consented artwork (#131, M8, L, risk)

Branch `ticket/131-auction-lots-from-consented-artwork`, worktree `/root/foa-wt/131`, base `foa/M0` (442dd99) for the head
start; the build pane rebases onto `foa/M8` once 103a has landed. Blocker 103a (transitively #59 #60 #61 #62 #63 #70 #73
#81 #82 #83 #93 #94 #97 #99 #102). No siblings: this unit is all of #131. #132 (bidding) and #133a/b (payment, delivery)
extend the module afterwards.

## Scope
In: the Auctions module (schema, state machine, use cases, jobs, consent-withdrawal consumer), lot creation from eligible
physical artwork, scheduling, open/close jobs, cancellation, unsold settlement with artwork-status restore, public
`/auctions` + `/auctions/[lotCode]`, admin `/admin/auctions`, `/admin/auctions/lots/new`, `/admin/auctions/lots/[lotId]`,
setting `auctions.enabled` (false), preview seed, Seam 2 spec.
Out: bids, current price, anti-sniping, bidder profile (#132); awaiting_payment/sold/relisted transitions, payment, the
`auctioned` artwork status write, delivery, letters (#133a/b). Their enum values exist now; their transitions stay refused.

## Acceptance criteria (seam)
1. `createLot` is refused, with a typed reason, for: no auction consent (none or withdrawn); a minor whose consent is the
   teen's own, the institution declaration, or a guardian who isn't verified; artwork status not in {verified,
   on_exhibition, retained} (received, discrepancy, returned…); an open discrepancy; an open return request; a competition
   with `auction_permitted = false`; an artwork already in an active lot. Seam 1 + pure `eligibility.test.ts`.
2. `createLot` on an eligible artwork (each of verified, on_exhibition, retained): lot `draft`, code matches
   `^LOT-\d{2}-[0-9A-HJKMNP-TV-Z]{5}$` (YY = IST year at creation), artwork → `auction_listed`,
   `artwork_status_before_listing` stored, custody event + audit row, outbox `auction.lot_created`. Seam 1.
3. Lot terms: base > 0 paise, reserve ≥ base (domain + DB CHECK), INR, opens < closes, opens in the future when created
   and again when scheduled. Seam 1 + pure `lot-terms.test.ts`.
4. A minor's credit is never more than first name + initial on any lot read model (public and admin), whatever their
   school/city opt-ins; adults get the #82 public credit. Property test over seeded names, Devanagari included. Seam 1.
5. Draining `consent.withdrawn` (purpose auction) for a subject cancels every lot of their artwork in draft, scheduled,
   open or closed and restores each artwork's pre-listing status; no other subject's lots change. Seam 1.
6. `cancelLot` (manager; draft/scheduled/open) and the unsold settlement (close job, no winning bid → closed → unsold)
   restore the pre-listing status, for each of verified, on_exhibition, retained. Seam 1.
7. Lot status transition table: every (status, command) pair; only the listed moves are allowed, #132/#133 moves refused.
   Pure `lot-status.test.ts`, plus Seam 1 refusals (cancel an unsold lot, schedule an open lot).
8. Authorization per use case: auction_manager allowed; competition_manager and member refused; visitor allowed only for
   `browseLots`/`getLot`; `openLot`/`closeLot`/consumers accept only the system worker. Seam 1.
9. `browseLots` lists scheduled + open lots only, and nothing while `auctions.enabled` is false; `getLot` returns null for
   draft/cancelled/unsold codes. Read-model JSON holds no original or private-derivative storage key (search every seeded
   key) and only `PublicAssetUrl`s of stamped files. Seam 1.
10. `scheduleLot` schedules `auction.lot.open` at opens_at and `auction.lot.close` at closes_at. Draining before the
    instant is a no-op; after it, open/closed. The close handler re-reads `closes_at` (#132 moves it). Jobs of a cancelled
    lot no-op. Seam 1 (fake clock + drain).
11. Preview seed: scheduled, open, unsold and cancelled lots with stamped images; `auctions.enabled` true in the
    non-production seed. Seam 1 seed test.
12. The five pages render accessibly (axe, light + `.dark`, 320–412 px no horizontal scroll); Lighthouse mobile ≥ 90
    perf + a11y on `/auctions` and one lot page (70b's runner). Seam 2 `tests/e2e/131-auction-lots.spec.ts` (Not run here).

## Files
Done in the head start (pure, new files): `src/server/modules/auctions/domain/{lot-status,eligibility,lot-terms,lot-code}.ts`
+ tests. Build adds (new): `modules/auctions/{policy,use-cases,create-lot,lifecycle,eligibility-facts,read-model,consumers,
schedules}.ts`, `src/server/db/schema/auctions.ts`, `src/server/seed/auctions.ts`, `src/app/auctions/**`,
`src/app/admin/auctions/**` (route group as it exists on M8), `messages/en-IN/{auctions,adminAuctions}.json`,
`tests/e2e/131-auction-lots.spec.ts`, migrations `131_artwork_auction_statuses` then `131_auction_lots`.
Hotspots: H1 schema barrel; H2 two migrations (enum values alone first); H3 `messages.ts`; H4 `routes.ts` + test, `nav.json`,
sitemap (list page only, never lot pages of minors); H6 seed index line; H7 `auctions.enabled`; H8 auctions policy table;
H9 outbox event union + consumers; H10 schedule names; **H15 physical-artwork enum + transition table + custody API
(serialize with #133b)**; H16 consent-withdrawal consumer registry; H19 admin nav link; X2 `src/proxy.ts` only if 103a's
`/gallery/[entryCode]` pattern used it (copy 103a's pattern for DB-backed public detail pages: cache tags `auctions`,
`auction:<lotCode>`, revalidated on every lot transition).
F2: `auction_listed`, `auctioned` are added to `physical_artwork_status` in `131_artwork_auction_statuses` and never named
in any DDL (no CHECK, default or index predicate); `artwork_status_before_listing` is typed `physical_artwork_status`.
`auction_lot_status` is a new type created in full (CREATE TYPE), so its partial unique index may name its values.

## Design (codebase-design, risk-flagged)
Question: who owns the artwork's custody status while it is in an auction?
- A. Lot owns custody: auction use cases `UPDATE physical_artwork SET status` themselves. Shallow: auctions must know #94's
  statuses, custody log, audit shape and transition table, and #133b repeats it. Fails the deletion test in reverse:
  custody rules leak into every caller. Rejected.
- B. **Artwork module owns every custody transition; the lot asks.** Two functions in the artwork module:
  `claimForAuction` and `releaseFromAuction` (signatures below). It checks its own transition table (adds
  listable → auction_listed and auction_listed → {verified, on_exhibition, retained}; #133b adds auction_listed →
  auctioned), writes the custody event and audit row, and keeps #94's retain job and return requests correct (they ignore
  `auction_listed`). Auctions keeps `artwork_status_before_listing` on the lot (spec column; shows "returns to" in admin,
  survives relisting) and passes it back on release. One transaction per use case, so listing and claim never diverge.
  **Chosen**: small interface, custody locality in one module, #133b reuses it.
- C. Event-driven: auctions emits `auction.lot_created`/`lot_ended`, artwork consumes them. Leaves a window where the
  artwork is listed and also exhibited/returned; restore is only visible after a drain. Rejected.
Inside auctions, the decision logic is pure and deep: `assessLotEligibility(facts)`, `decideLotTransition(from, command)`,
`validateLotTerms(terms, now)`, `lotCodeFormat(at)`. One query adapter (`eligibility-facts.ts`) gathers facts from the
artwork, consent, competition and lot tables for N artworks at once (feeds both `listEligibleArtwork` and `createLot`, no
N+1). Unsold settlement is a 131-owned consumer of `auction.lot_closed` (`settleClosedLot`): no bids exist yet, so it always
moves closed → unsold and releases the artwork; #133a adds the "bid ≥ reserve → awaiting_payment" branch there.
Defaults (reversible, recorded): `auctions.enabled` false hides public lots and refuses `scheduleLot`; drafting is allowed;
jobs run regardless. Terms are edited only in draft (a scheduled lot is cancelled and recreated). For an adult creator only
their own consent counts (a guardian's consent given while they were a minor does not). `suitable_for_auction` (#97) is
shown as a hint in `listEligibleArtwork`, not a gate (ticket doesn't gate on it). After a restore, an artwork whose return
window closed while listed stays at its pre-listing status (ticket text; #94's retain job is one-shot).

## Interface needs (what 131 codes against; build pane adapts names to what landed)
```ts
// #59 policy core (src/server/access/domain/policy.ts) + audit
const AUCTIONS_POLICY = { "auction.lot.manage": role("auction_manager"), "auction.lot.view-admin": role("auction_manager"),
  "auction.lot.browse": anyRule /* visitors too */, "auction.lot.run": system("worker") } satisfies Policy<string>;
auditLog.write(tx: AppDb, entry: { action: string; entityType: "auction_lot"; entityId: string; before: unknown; after: unknown }): Promise<void>;
// #60: staff 2FA is enforced by can()/the staff gate for auction_manager; nothing auction-specific.
// #61 outbox + jobs
emit(tx: AppDb, event: { type: "auction.lot_created" | "auction.lot_opened" | "auction.lot_closed" | "auction.lot_cancelled"; payload: { lotId: string; lotCode: string } }): Promise<void>;
scheduleAt(tx: AppDb, job: { name: "auction.lot.open" | "auction.lot.close"; runAt: Date; payload: { lotId: string }; singletonKey: string }): Promise<void>;
// harness: h.jobs.drain() runs due jobs and consumers at h.clock.now()
// #62 settings
settings.get(tx: AppDb, key: "auctions.enabled"): Promise<boolean>;
// #73 codes (on ticket/73 already)
withUniqueCode<T>(o: { format: CodeFormat; constraint: "auction_lot_lot_code_unique" }, attempt: (code: string) => Promise<T>): Promise<T>;
// #93/#94 physical artwork (H15)
type PhysicalArtworkStatus = "requested" | "dispatched" | "received" | "discrepancy" | "verified" | "on_exhibition" | "retained" | "returned" | "auction_listed" | "auctioned";
artworkCustody.claimForAuction(tx: AppDb, i: { artworkId: string; actorUserId: string; lotId: string }): Promise<{ statusBefore: "verified" | "on_exhibition" | "retained" }>;
artworkCustody.releaseFromAuction(tx: AppDb, i: { artworkId: string; restoreTo: "verified" | "on_exhibition" | "retained"; actorUserId: string | null; reason: "lot_cancelled" | "lot_unsold" | "consent_withdrawn" }): Promise<void>;
// tables read by eligibility-facts: physical_artwork(id, entry_id, competition_id, artwork_code, status),
// artwork_discrepancy(artwork_id, resolved_at), artwork_return_request(artwork_id, status)
// #70: competition.auction_permitted boolean. #81: participant DOB → isMinorAt(profile, at): boolean
// #82/#83 consent + credit
auctionConsentFor(tx: AppDb, i: { entryId: string; competitionId: string }): Promise<{ state: "none" } | { state: "given"; by: "creator" | "guardian" | "institution"; guardianVerified: boolean }>;
publicCredit(person: { givenName: string; familyName: string }, optIns: { school: string | null; city: string | null }): string;
// outbox event consumed: "consent.withdrawn" { subject: { type: "user" | "participant_profile"; id: string }; purpose: "auction" | …; competitionId: string | null; withdrawnAt: string }
// #97/#99: awardLabelFor(tx, entryId): Promise<string | null> (published outcome only); round_entry.suitable_for_auction
// #102/#103a: stampedImageFor(tx, entryId): Promise<StampedFile | null>; publicAssetUrl(file: StampedFile): PublicAssetUrl
```

## Residue
HR-63 (FOA + legal: whether minors' work is auctioned at all, creator share, copyright; flag `auctions.enabled` stays false
until the pilot artwork is verified). HR-65 (auction consent wording stating the creator share; lot-page terms copy).
G3/counsel: whether auction consent alone covers showing the image on public lot pages (default: yes, no separate
public-display consent). G1/#114: inventory rows for `auction_lot.story` (may hold a child's words) and
`cancelled_reason`, retention "confirm with counsel". HR-10/M8: redeploy `worker-preview` for the open/close handlers and
the consumers. Lighthouse ×3 on a real phone stays residue per §1.11.

## Test plan
Pure (done): transition table over 9 statuses × 6 commands; eligibility truth table incl. every reason and combinations;
terms (zero/negative base, reserve < base, equal reserve ok, bigint overflow, opens ≤ now, closes ≤ opens); lot code
format, IST year rollover at 18:30 UTC on 31 Dec, parse/normalise.
Seam 1: AC 1–11 as listed; seed builders `h.seed.auctionReadyArtwork({ status, minor, consent })` and `h.seed.lot({ status })`
(H6, built on 93/94/82 builders). Seam 2: visitor sees `/auctions` and a lot page from seed; admin creates a lot from an
eligible artwork; axe on all five pages; extend 103d's original-asset crawl to `/auctions/**`.

## Slices (ordered; each = one behaviour, one test file)
1. `createLot` + `listEligibleArtwork` with every refusal and the claim (AC 1, 2, 3, 8 for both): schema, two migrations,
   policy, facts adapter, artwork custody API, code. `modules/auctions/create-lot.test.ts`.
2. `scheduleLot`, open/close jobs, `cancelLot`, unsold settlement, restore (AC 6, 7, 10, 8). `modules/auctions/lifecycle.test.ts`.
3. Consent-withdrawal consumer (AC 5). `modules/auctions/consent-withdrawal.test.ts`.
4. `browseLots`/`getLot` read model, credit cap, flag, asset keys (AC 4, 9, 8). `modules/auctions/public-lots.test.ts`.
5. Pages, nav, messages, seed, Seam 2 spec (AC 11, 12). `src/server/seed/auctions.test.ts` + `tests/e2e/131-auction-lots.spec.ts`.

## Head start (pane foa-p131, 2026-11-21)
Pushed `ticket/131-auction-lots-from-consented-artwork` at 146b75d (base `foa/M0` 442dd99, no PR): pure
`src/server/modules/auctions/domain/{lot-status,eligibility,lot-terms,lot-code}.ts` + 121 unit tests. Typecheck, lint and
format pass. `pnpm check` hit 5 s PGlite timeouts only in the untouched `src/test/db.test.ts` at load 55–75; it passes
alone (twice). Build pane: rebase onto `foa/M8`; narrow `artworkStatus: string` to #93's `PhysicalArtworkStatus`; plug
`lotCodeFormat(now)` into #73's `withUniqueCode`; `LOT_STATUSES` feeds `pgEnum("auction_lot_status", …)` and
`ACTIVE_LOT_STATUSES` the partial unique index.
