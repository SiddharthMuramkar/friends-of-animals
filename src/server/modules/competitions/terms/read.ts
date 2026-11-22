// Reading a competition's terms (#72).
//
//   getCompetitionTermsForEdit({ competitionId }) → a competition manager
//   publicCompetitionTerms(db, competition)      → the public read model (#70)
//   getRegistrationTerms(db, competitionId)      → registration (#75, #77, #78)
//
// Loads under plain Node: relative imports only.

import { z } from "zod";

import { authorize } from "../../../access/can";
import type { AppDb } from "../../../db/app-db";
import { invalidInput, type InvalidInput } from "../../../input";
import { awardPlan, type RoundAwardPlan } from "../domain/award-schemes";
import {
  ATTACHABLE_PURPOSES,
  attachmentState,
  documentVersionPath,
  isRequiredForRegistration,
  type AttachablePurpose,
  type AttachmentState,
} from "../domain/consent-attachments";
import {
  feeEditAllowed,
  feeView,
  offeredRoutes,
  FEE_CURRENCY,
  PARTICIPATION_ROUTES,
  type FeeLine,
  type ParticipationRoute,
} from "../domain/fees";
import type { Participation } from "../domain/vocabulary";
import type { TermsContext } from "./fees";
import { competitionResource } from "./policy";
import {
  findCompetition,
  latestDocuments,
  pinnedDocuments,
  storedAwards,
  storedFees,
  type CompetitionForTerms,
  type DocumentRef,
} from "./repository";

/** One attachable purpose on the edit screen. */
export type DocumentForEdit = {
  purpose: AttachablePurpose;
  /** Registrants must agree to it. */
  required: boolean;
  state: AttachmentState;
  pinned: DocumentRef | null;
  /** The latest published version, to attach or move to. */
  latest: DocumentRef | null;
};

export type CompetitionTermsForEdit = {
  competition: CompetitionForTerms;
  fees: {
    /** False once registration has opened. */
    editable: boolean;
    currency: typeof FEE_CURRENCY;
    lines: FeeLine[];
  };
  awards: RoundAwardPlan[];
  documents: DocumentForEdit[];
};

export type GetCompetitionTermsForEditResult =
  | { ok: true; terms: CompetitionTermsForEdit }
  | InvalidInput
  | { ok: false; error: "not_found" };

const editInput = z.object({ competitionId: z.uuid() });

/** Everything the fees, awards and documents screens show and edit. */
export async function getCompetitionTermsForEdit(
  ctx: TermsContext,
  input: { competitionId: string }
): Promise<GetCompetitionTermsForEditResult> {
  await authorize(
    ctx,
    "competition.view_terms",
    competitionResource(input.competitionId)
  );
  const valid = editInput.safeParse(input);
  if (!valid.success) return invalidInput(valid.error);
  const { competitionId } = valid.data;
  const found = await findCompetition(ctx.db, competitionId);
  if (!found) return { ok: false, error: "not_found" };

  const [fees, awards, pinned, latest] = await Promise.all([
    storedFees(ctx.db, competitionId),
    storedAwards(ctx.db, competitionId),
    pinnedDocuments(ctx.db, competitionId),
    latestDocuments(ctx.db),
  ]);
  return {
    ok: true,
    terms: {
      competition: found,
      fees: {
        editable: feeEditAllowed(found.status),
        currency: FEE_CURRENCY,
        lines: feeView(found.participation, fees),
      },
      awards: awardPlan(found.participation, awards),
      documents: ATTACHABLE_PURPOSES.map((purpose) => {
        const pin =
          pinned.find((document) => document.purpose === purpose) ?? null;
        const newest = latest.get(purpose) ?? null;
        return {
          purpose,
          required: isRequiredForRegistration(purpose),
          state: attachmentState(pin, newest),
          pinned: pin && { id: pin.id, version: pin.version, title: pin.title },
          latest: newest,
        };
      }),
    },
  };
}

/** A competition's terms as the public detail page shows them. */
export type PublicCompetitionTerms = {
  /** Per offered route: free, an amount in paise, or not set yet. */
  fees: FeeLine[];
  /** Per round it runs: the scheme, its bands and each band's prize. */
  awards: RoundAwardPlan[];
  /** The pinned versions, linked to that exact text. */
  documents: {
    purpose: AttachablePurpose;
    title: string;
    version: number;
    href: string;
  }[];
};

/**
 * The terms part of the public read model. The caller has already
 * decided the competition is public (published or later).
 */
export async function publicCompetitionTerms(
  db: AppDb,
  competition: { id: string; participation: Participation | null }
): Promise<PublicCompetitionTerms> {
  const [fees, awards, pinned] = await Promise.all([
    storedFees(db, competition.id),
    storedAwards(db, competition.id),
    pinnedDocuments(db, competition.id),
  ]);
  return {
    fees: feeView(competition.participation, fees),
    awards: awardPlan(competition.participation, awards),
    documents: pinned.map(({ purpose, title, version }) => ({
      purpose,
      title,
      version,
      href: documentVersionPath(purpose, version),
    })),
  };
}

/** What registering for a competition costs and asks people to agree to. */
export type RegistrationTerms = {
  /**
   * The fee per route, or null when the competition doesn't offer the
   * route or its fee isn't set yet: registration on it must refuse with
   * `fee_not_set` (publishing doesn't wait for fees).
   */
  fees: Record<
    ParticipationRoute,
    { amountMinor: bigint; currency: typeof FEE_CURRENCY } | null
  >;
  /** The pinned versions; consent is given to exactly these. */
  documents: readonly {
    purpose: AttachablePurpose;
    documentId: string;
    version: number;
    required: boolean;
  }[];
};

/**
 * The fees and documents registration snapshots (#75, #77, #78), or null
 * when there is no such competition. Not a use case: the registration use
 * case has already authorised its caller, and passes its transaction.
 */
export async function getRegistrationTerms(
  db: AppDb,
  competitionId: string
): Promise<RegistrationTerms | null> {
  const found = await findCompetition(db, competitionId);
  if (!found) return null;
  // One after the other: `db` may be the caller's transaction.
  const fees = await storedFees(db, competitionId);
  const pinned = await pinnedDocuments(db, competitionId);
  const offered = offeredRoutes(found.participation);
  return {
    fees: Object.fromEntries(
      PARTICIPATION_ROUTES.map((route) => {
        const amountMinor = fees[route];
        return [
          route,
          offered.includes(route) && amountMinor !== undefined
            ? { amountMinor, currency: FEE_CURRENCY }
            : null,
        ];
      })
    ) as RegistrationTerms["fees"],
    documents: pinned.map((document) => ({
      purpose: document.purpose,
      documentId: document.id,
      version: document.version,
      required: isRequiredForRegistration(document.purpose),
    })),
  };
}
