// Which physical artwork may become an auction lot (#131). Pure: one query
// gathers the facts about each artwork from the artwork, consent,
// competition and lot tables, and this decides. `listEligibleArtwork` shows
// the reasons; `createLot` refuses with them.
//
// Auction consent for a minor counts only when a verified guardian gave
// it: never the teen's own, never an institution's declaration. For an
// adult, only their own consent counts, so a guardian's consent given while
// they were a minor does not carry over.
//
// Loads under plain Node: no "server-only", no `@/` imports.

/** Physical artwork statuses a lot may be created from. */
export const LISTABLE_ARTWORK_STATUSES = [
  "verified",
  "on_exhibition",
  "retained",
] as const;

export type ListableArtworkStatus = (typeof LISTABLE_ARTWORK_STATUSES)[number];

/** The current auction consent for the artwork's entry and competition. */
export type AuctionConsentFact =
  /** Never given, or withdrawn. */
  | { state: "none" }
  | {
      state: "given";
      /** Who gave it: the creator, their guardian, or their institution. */
      by: "creator" | "guardian" | "institution";
      /** Whether that guardian's identity is verified. */
      guardianVerified: boolean;
    };

/** What `assessLotEligibility` needs to know about one artwork. */
export type ArtworkAuctionFacts = {
  /** Any `physical_artwork_status` value. */
  artworkStatus: string;
  openDiscrepancy: boolean;
  openReturnRequest: boolean;
  /** The competition's `auction_permitted` flag. */
  competitionAllowsAuction: boolean;
  /** Under 18 now, from the stored date of birth. */
  creatorIsMinor: boolean;
  auctionConsent: AuctionConsentFact;
  /** Already held by a draft, scheduled, open or other active lot. */
  inActiveLot: boolean;
};

/** Why an artwork may not become a lot, in the order they are reported. */
export const INELIGIBLE_REASONS = [
  "artwork_not_listable",
  "open_discrepancy",
  "return_requested",
  "already_listed",
  "competition_not_auctionable",
  "auction_consent_missing",
  "guardian_consent_required",
  "guardian_not_verified",
] as const;

export type IneligibleReason = (typeof INELIGIBLE_REASONS)[number];

export type LotEligibility =
  | { eligible: true }
  | { eligible: false; reasons: IneligibleReason[] };

function isListable(status: string): status is ListableArtworkStatus {
  return (LISTABLE_ARTWORK_STATUSES as readonly string[]).includes(status);
}

function consentProblem(facts: ArtworkAuctionFacts): IneligibleReason | null {
  const consent = facts.auctionConsent;
  if (consent.state === "none") return "auction_consent_missing";
  if (!facts.creatorIsMinor) {
    return consent.by === "creator" ? null : "auction_consent_missing";
  }
  if (consent.by !== "guardian") return "guardian_consent_required";
  return consent.guardianVerified ? null : "guardian_not_verified";
}

/** Whether the artwork may become a lot, and every reason it may not. */
export function assessLotEligibility(
  facts: ArtworkAuctionFacts
): LotEligibility {
  const found = new Set<IneligibleReason>();
  if (!isListable(facts.artworkStatus)) found.add("artwork_not_listable");
  if (facts.openDiscrepancy) found.add("open_discrepancy");
  if (facts.openReturnRequest) found.add("return_requested");
  if (facts.inActiveLot) found.add("already_listed");
  if (!facts.competitionAllowsAuction) found.add("competition_not_auctionable");
  const consent = consentProblem(facts);
  if (consent) found.add(consent);
  const reasons = INELIGIBLE_REASONS.filter((reason) => found.has(reason));
  return reasons.length === 0
    ? { eligible: true }
    : { eligible: false, reasons };
}
