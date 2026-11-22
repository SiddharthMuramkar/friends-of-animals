// A competition's terms (#72): fees per participation route, an award
// scheme per planned round, and the consent document versions it pins.
// Its use cases join `as(actor)` through `competitionTermsUseCases`;
// the public read model (#70) and registration (#75, #77, #78) read
// through `publicCompetitionTerms` and `getRegistrationTerms`.

import type { UseCaseContext } from "../../../use-cases";
import { setRoundAwards, type SetRoundAwardsInput } from "./awards";
import {
  attachConsentDocument,
  detachConsentDocument,
  type ConsentDocumentChangeInput,
} from "./documents";
import { getCompetitionDocumentVersion } from "./document-version";
import { setCompetitionFees, type SetCompetitionFeesInput } from "./fees";
import { getCompetitionTermsForEdit } from "./read";

export type {
  AttachConsentDocumentResult,
  ConsentDocumentChangeInput,
  DetachConsentDocumentResult,
} from "./documents";
export type { CompetitionDocumentVersion } from "./document-version";
export type { SetCompetitionFeesInput, SetCompetitionFeesResult } from "./fees";
export type { SetRoundAwardsInput, SetRoundAwardsResult } from "./awards";
export type {
  CompetitionTermsForEdit,
  DocumentForEdit,
  GetCompetitionTermsForEditResult,
  PublicCompetitionTerms,
  RegistrationTerms,
} from "./read";
export { getRegistrationTerms, publicCompetitionTerms } from "./read";
export { COMPETITION_TERMS_POLICY } from "./policy";

export const competitionTermsUseCases = (ctx: UseCaseContext) => ({
  getCompetitionTermsForEdit: (input: { competitionId: string }) =>
    getCompetitionTermsForEdit(ctx, input),
  setCompetitionFees: (input: SetCompetitionFeesInput) =>
    setCompetitionFees(ctx, input),
  setRoundAwards: (input: SetRoundAwardsInput) => setRoundAwards(ctx, input),
  attachConsentDocument: (input: ConsentDocumentChangeInput) =>
    attachConsentDocument(ctx, input),
  detachConsentDocument: (input: ConsentDocumentChangeInput) =>
    detachConsentDocument(ctx, input),
  getCompetitionDocumentVersion: (input: {
    purpose: string;
    version: number;
  }) => getCompetitionDocumentVersion(ctx, input),
});
