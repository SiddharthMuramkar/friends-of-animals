// What a guardian consents to for a child, one purpose at a time, and what
// those consents allow. The use cases record each give and withdrawal as a
// consent event; these rules decide which document version a consent points
// at, which purposes a competition offers, what each public use needs, and
// when a minor's registration waits for consent. Changing a purpose's
// document or the use it unlocks is an edit to one table here.
//
// Pure: loads under plain Node (schema, seed), relative imports only.

export const GUARDIAN_PURPOSES = [
  "participation",
  "public_display",
  "display_school",
  "display_city",
  "social_media",
  "auction",
  "communications",
] as const;
export type GuardianPurpose = (typeof GUARDIAN_PURPOSES)[number];

/** A consent document version, as the consent event points at it. */
export type DocumentRef = { id: string; version: number };

/** The document purposes a competition attaches a version of. */
export type CompetitionDocumentPurpose =
  | "participation"
  | "public_display"
  | "social_media"
  | "auction";

/** What a competition says about consent, from its definition. */
export type CompetitionConsentSetup = {
  /** Entries may be shown in public: gallery, results, social media. */
  publicDisplayAllowed: boolean;
  /** Physical work may later be auctioned. */
  auctionAllowed: boolean;
  /** The version attached for each document purpose, if any. */
  attached: Partial<Record<CompetitionDocumentPurpose, DocumentRef>>;
};

type PurposeRule =
  | {
      scope: "competition";
      /** The attached document whose version the consent points at. */
      document: CompetitionDocumentPurpose;
      /** The competition setting that must allow the use. */
      needs: "nothing" | "publicDisplayAllowed" | "auctionAllowed";
    }
  | { scope: "global"; document: "communications" };

/**
 * One rule per purpose. School and city are options of the public credit,
 * so they point at the public display document.
 */
const PURPOSE_RULES: Record<GuardianPurpose, PurposeRule> = {
  participation: {
    scope: "competition",
    document: "participation",
    needs: "nothing",
  },
  public_display: {
    scope: "competition",
    document: "public_display",
    needs: "publicDisplayAllowed",
  },
  display_school: {
    scope: "competition",
    document: "public_display",
    needs: "publicDisplayAllowed",
  },
  display_city: {
    scope: "competition",
    document: "public_display",
    needs: "publicDisplayAllowed",
  },
  social_media: {
    scope: "competition",
    document: "social_media",
    needs: "publicDisplayAllowed",
  },
  auction: {
    scope: "competition",
    document: "auction",
    needs: "auctionAllowed",
  },
  communications: { scope: "global", document: "communications" },
};

export function guardianDocumentPurpose(purpose: GuardianPurpose) {
  return PURPOSE_RULES[purpose].document;
}

/**
 * The competition purposes a guardian can give for a child registered in
 * it, in catalogue order, each with the version they would agree to.
 */
export function offeredPurposes(
  setup: CompetitionConsentSetup
): { purpose: GuardianPurpose; document: DocumentRef }[] {
  return GUARDIAN_PURPOSES.flatMap((purpose) => {
    const rule = PURPOSE_RULES[purpose];
    if (rule.scope !== "competition") return [];
    if (rule.needs !== "nothing" && !setup[rule.needs]) return [];
    const document = setup.attached[rule.document];
    return document ? [{ purpose, document }] : [];
  });
}

export type ScopeRefusal = "competition_required" | "competition_not_allowed";

/**
 * Whether a give or withdraw names a competition when it should. Withdrawal
 * checks only this, so a consent stays withdrawable after a competition
 * stops offering its purpose.
 */
export function scopeRefusal(
  purpose: GuardianPurpose,
  competitionId: string | null
): ScopeRefusal | null {
  return refusalForScope(purpose, competitionId !== null);
}

function refusalForScope(
  purpose: GuardianPurpose,
  namesCompetition: boolean
): ScopeRefusal | null {
  const perCompetition = PURPOSE_RULES[purpose].scope === "competition";
  if (perCompetition && !namesCompetition) return "competition_required";
  if (!perCompetition && namesCompetition) return "competition_not_allowed";
  return null;
}

/** What a give request names, as the use case loaded it. */
export type GiveTarget =
  | { competition: CompetitionConsentSetup; childRegistered: boolean }
  | { competition: null; currentDocument: DocumentRef | null };

export type GiveRefusal =
  | ScopeRefusal
  | "not_registered"
  | "purpose_not_offered";

/**
 * The document version a guardian's consent to `purpose` points at: the one
 * attached to the competition, or for communications the current published
 * one. Refusals in order: scope, registration, offer.
 */
export function documentToGive(
  purpose: GuardianPurpose,
  target: GiveTarget
): { ok: true; document: DocumentRef } | { ok: false; reason: GiveRefusal } {
  const refuse = (reason: GiveRefusal) => ({ ok: false, reason }) as const;
  if (target.competition === null) {
    const scope = refusalForScope(purpose, false);
    if (scope) return refuse(scope);
    return target.currentDocument
      ? { ok: true, document: target.currentDocument }
      : refuse("purpose_not_offered");
  }
  const scope = refusalForScope(purpose, true);
  if (scope) return refuse(scope);
  if (!target.childRegistered) return refuse("not_registered");
  const offer = offeredPurposes(target.competition).find(
    (o) => o.purpose === purpose
  );
  return offer
    ? { ok: true, document: offer.document }
    : refuse("purpose_not_offered");
}

/** The places a participant's work and credit can be shown in public. */
export const PUBLIC_USES = [
  "gallery",
  "results",
  "social_media",
  "auction",
] as const;
export type PublicUse = (typeof PUBLIC_USES)[number];

const PUBLICATION_PURPOSES = [
  "public_display",
  "social_media",
  "auction",
] as const;
export type PublicationPurpose = (typeof PUBLICATION_PURPOSES)[number];

export function isPublicationPurpose(
  purpose: string
): purpose is PublicationPurpose {
  return PUBLICATION_PURPOSES.some((choice) => choice === purpose);
}

/**
 * The consent each use needs. School and city follow the guardian's
 * field-by-field opt-ins everywhere except a minor's auction credit, which
 * stays at first name and initial.
 */
const PUBLIC_USE_RULES: Record<
  PublicUse,
  { purpose: PublicationPurpose; capsMinorCredit: boolean }
> = {
  gallery: { purpose: "public_display", capsMinorCredit: false },
  results: { purpose: "public_display", capsMinorCredit: false },
  social_media: { purpose: "social_media", capsMinorCredit: false },
  auction: { purpose: "auction", capsMinorCredit: true },
};

export function publicationPurposeFor(use: PublicUse): PublicationPurpose {
  return PUBLIC_USE_RULES[use].purpose;
}

export type PublicUsePermission =
  | { allowed: false }
  | { allowed: true; showSchool: boolean; showCity: boolean };

/** What the given purposes allow for one public use of this person's work. */
export function publicUseOf(
  given: ReadonlySet<GuardianPurpose>,
  use: PublicUse,
  person: { minor: boolean }
): PublicUsePermission {
  const rule = PUBLIC_USE_RULES[use];
  if (!given.has(rule.purpose)) return { allowed: false };
  const fields = !(rule.capsMinorCredit && person.minor);
  return {
    allowed: true,
    showSchool: fields && given.has("display_school"),
    showCity: fields && given.has("display_city"),
  };
}

export type RegistrationHold =
  | "awaiting_guardian"
  | "participation_consent_required";

/**
 * Why a minor's registration can't move on to payment and confirmation
 * yet, or null when it can. An adult's registration is never held here.
 * The guardian is checked first: until they are verified, nobody can give
 * participation consent that counts.
 */
export function minorRegistrationHold(facts: {
  minor: boolean;
  guardianVerified: boolean;
  /** Participation given on the competition's attached version. */
  participationGiven: boolean;
}): RegistrationHold | null {
  if (!facts.minor) return null;
  if (!facts.guardianVerified) return "awaiting_guardian";
  if (!facts.participationGiven) return "participation_consent_required";
  return null;
}
