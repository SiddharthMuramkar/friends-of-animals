// Who gets a thank-you letter when a lot is sold (#133). The creator gets
// one, or, when the creator is a minor on the day of the sale, their
// guardians do; the child never receives it, even with a login of their
// own. When the artwork was entered through a school, the school gets one
// too. Each lot has at most one letter of each kind; a guardian letter is
// sent to every active linked guardian.
//
// A letter whose recipients are missing is still planned, so the auction
// manager sees it and can arrange delivery; `problems` says what is missing.
//
// Pure: whether the creator is a minor is worked out by the caller from the
// stored date of birth (#55: store DOB, never age). Loads under plain Node.

/** The `auction_letter_recipient_kind` enum. */
export const LETTER_RECIPIENT_KINDS = [
  "creator",
  "guardian",
  "school",
] as const;

export type LetterRecipientKind = (typeof LETTER_RECIPIENT_KINDS)[number];

export type LetterFacts = {
  /** Under 18 on the IST date of the sale. */
  creatorIsMinor: boolean;
  /** The creator's own login, if they have one. */
  creatorLoginUserId: string | null;
  /** Users with an active guardian link to the creator's profile. */
  guardianUserIds: readonly string[];
  /** How the artwork was entered. */
  route: "individual" | "institution";
  institutionId: string | null;
  /** The school's authorised person and institution admins. */
  schoolUserIds: readonly string[];
};

export type PlannedLetter =
  | { kind: "creator" | "guardian"; recipientUserIds: string[] }
  | { kind: "school"; institutionId: string; recipientUserIds: string[] };

export type LetterProblem =
  | "creator_login_missing"
  | "guardian_missing"
  | "school_contact_missing";

export type LetterPlan = {
  letters: PlannedLetter[];
  problems: LetterProblem[];
};

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

export function planThankYouLetters(facts: LetterFacts): LetterPlan {
  const letters: PlannedLetter[] = [];
  const problems: LetterProblem[] = [];

  if (facts.creatorIsMinor) {
    const guardians = unique(facts.guardianUserIds);
    letters.push({ kind: "guardian", recipientUserIds: guardians });
    if (guardians.length === 0) problems.push("guardian_missing");
  } else {
    const login = facts.creatorLoginUserId;
    letters.push({ kind: "creator", recipientUserIds: login ? [login] : [] });
    if (!login) problems.push("creator_login_missing");
  }

  if (facts.route === "institution") {
    if (!facts.institutionId) {
      throw new RangeError(
        "An entry made through a school names its institution"
      );
    }
    const school = unique(facts.schoolUserIds);
    letters.push({
      kind: "school",
      institutionId: facts.institutionId,
      recipientUserIds: school,
    });
    if (school.length === 0) problems.push("school_contact_missing");
  }

  return { letters, problems };
}
