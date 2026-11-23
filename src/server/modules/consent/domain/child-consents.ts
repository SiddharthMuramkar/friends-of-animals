// What a guardian sees of one child's consents: for each competition the
// child is registered in, every competition purpose with whether the
// competition offers it, the version giving it would agree to, its state
// and whether that state counts; the credit each public use would show as
// those consents stand; and the child's communications consent.
//
// A consent counts only while it is given on the version the guardian
// would agree to now (the competition's attached one, or for
// communications the current one). Consent given on an older version, or
// to a purpose the competition no longer offers, shows as given but allows
// nothing until the guardian gives it again.
//
// Pure: loads under plain Node, relative imports only.

import type { ConsentState } from "./consent-state";
import {
  GUARDIAN_PURPOSES,
  offeredPurposes,
  PUBLIC_USES,
  type CompetitionConsentSetup,
  type DocumentRef,
  type GuardianPurpose,
  type PublicUse,
} from "./guardian-purposes";
import {
  resolvePublicCredit,
  type CreditPerson,
  type PublicCredit,
} from "./public-credit";

export type PurposeState = ConsentState;

/** The state of one purpose: per competition, or null for communications. */
export type ConsentStates = (
  competitionId: string | null,
  purpose: GuardianPurpose
) => PurposeState;

export type CompetitionPurposeView = {
  purpose: GuardianPurpose;
  offered: boolean;
  /** What giving it now agrees to; null when it isn't offered. */
  document: DocumentRef | null;
  state: PurposeState;
  /** Given on `document`: it allows what it is for. */
  counts: boolean;
};

export type CompetitionConsentsView = {
  id: string;
  title: string;
  purposes: CompetitionPurposeView[];
  /** The credit each public use would show now; null where none. */
  creditPreview: Record<PublicUse, PublicCredit | null>;
};

export type CommunicationsView = {
  /** The current version; null until staff publish one. */
  document: DocumentRef | null;
  state: PurposeState;
  counts: boolean;
};

export type ChildConsentsView = {
  competitions: CompetitionConsentsView[];
  communications: CommunicationsView;
};

/** The child as the credit names them. */
export type CreditDetails = Omit<CreditPerson, "minor">;

function counts(state: PurposeState, document: DocumentRef | null): boolean {
  return (
    document !== null &&
    state.status === "given" &&
    state.documentId === document.id
  );
}

export function childConsentsView(input: {
  child: CreditDetails;
  competitions: readonly {
    id: string;
    title: string;
    setup: CompetitionConsentSetup;
    /** Under 18 when they registered, so their credit stays a child's. */
    minor: boolean;
  }[];
  states: ConsentStates;
  communicationsDocument: DocumentRef | null;
}): ChildConsentsView {
  const { child, states } = input;
  const competitions = input.competitions.map((competition) => {
    const offered = offeredPurposes(competition.setup);
    const purposes = GUARDIAN_PURPOSES.flatMap(
      (purpose): CompetitionPurposeView[] => {
        if (purpose === "communications") return [];
        const offer = offered.find((each) => each.purpose === purpose);
        const document = offer?.document ?? null;
        const state = states(competition.id, purpose);
        return [
          {
            purpose,
            offered: offer !== undefined,
            document,
            state,
            counts: counts(state, document),
          },
        ];
      }
    );
    const given = new Set(
      purposes.filter((each) => each.counts).map((each) => each.purpose)
    );
    const person: CreditPerson = { ...child, minor: competition.minor };
    const creditPreview = Object.fromEntries(
      PUBLIC_USES.map((use) => [use, resolvePublicCredit(person, use, given)])
    ) as Record<PublicUse, PublicCredit | null>;
    return {
      id: competition.id,
      title: competition.title,
      purposes,
      creditPreview,
    };
  });
  const state = states(null, "communications");
  return {
    competitions,
    communications: {
      document: input.communicationsDocument,
      state,
      counts: counts(state, input.communicationsDocument),
    },
  };
}
