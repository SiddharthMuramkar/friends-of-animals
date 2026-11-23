import type { UseCaseContext } from "../../use-cases";
import { answerConsentLink, type AnswerConsentLinkInput } from "./answer-link";
import {
  listStudentConsents,
  type ListStudentConsentsInput,
} from "./dashboard";
import {
  sendConsentLinkCode,
  verifyConsentLinkCode,
  viewConsentLink,
  type LinkInput,
  type VerifyConsentLinkCodeInput,
  type ViewConsentLinkInput,
} from "./public-link";
import {
  revokeConsentLink,
  sendConsentLink,
  type RevokeConsentLinkInput,
  type SendConsentLinkInput,
} from "./send-link";

export const consentLinksUseCases = (ctx: UseCaseContext) => ({
  sendConsentLink: (input: SendConsentLinkInput) => sendConsentLink(ctx, input),
  revokeConsentLink: (input: RevokeConsentLinkInput) =>
    revokeConsentLink(ctx, input),
  answerConsentLink: (input: AnswerConsentLinkInput) =>
    answerConsentLink(ctx, input),
  sendConsentLinkCode: (input: LinkInput) => sendConsentLinkCode(ctx, input),
  verifyConsentLinkCode: (input: VerifyConsentLinkCodeInput) =>
    verifyConsentLinkCode(ctx, input),
  listStudentConsents: (input: ListStudentConsentsInput) =>
    listStudentConsents(ctx, input),
  viewConsentLink: (input: ViewConsentLinkInput) => viewConsentLink(ctx, input),
});
