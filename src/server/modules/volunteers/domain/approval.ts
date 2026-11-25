// What a community manager's approval needs. The applicant makes the
// safeguarding declaration and accepts the code of conduct as consents on
// published documents (the consent module); approval records both, so each
// must be given, not withdrawn, and on the version published now. A
// document republished after the applicant accepted it has to be accepted
// again first.
//
// Pure: the use case loads the application's status, the applicant's
// current consent for each purpose and each purpose's current document,
// and passes them in. Step-up and the community manager's role are
// checked before this, by `can()`.

import {
  transitionVolunteerApplication,
  type VolunteerApplicationStatus,
} from "./application-status";

/** The applicant's latest consent for one purpose, folded from its events. */
export type ConsentState =
  | { state: "never" }
  | { state: "given"; documentId: string; consentEventId: string }
  | { state: "withdrawn"; documentId: string };

/** One declaration: what the applicant gave, and what is published now. */
export type DeclarationState = {
  consent: ConsentState;
  /** The purpose's latest published document, or null before the first. */
  currentDocumentId: string | null;
};

export type VolunteerApprovalRefusal =
  | "invalid_transition"
  | "safeguarding_declaration_unpublished"
  | "safeguarding_declaration_missing"
  | "safeguarding_declaration_outdated"
  | "code_of_conduct_unpublished"
  | "code_of_conduct_missing"
  | "code_of_conduct_outdated";

export type VolunteerApprovalDecision =
  | {
      ok: true;
      status: "approved";
      /** The consent events the application records. */
      safeguardingConsentId: string;
      conductConsentId: string;
    }
  | { ok: false; reason: VolunteerApprovalRefusal };

type DeclarationCheck =
  | { ok: true; consentEventId: string }
  | { ok: false; problem: "unpublished" | "missing" | "outdated" };

function checkDeclaration(declaration: DeclarationState): DeclarationCheck {
  const { consent, currentDocumentId } = declaration;
  if (currentDocumentId === null) return { ok: false, problem: "unpublished" };
  if (consent.state !== "given") return { ok: false, problem: "missing" };
  if (consent.documentId !== currentDocumentId) {
    return { ok: false, problem: "outdated" };
  }
  return { ok: true, consentEventId: consent.consentEventId };
}

/**
 * Decides whether a community manager may approve. Refusals come in a
 * fixed order: the application isn't waiting for them, then the
 * safeguarding declaration, then the code of conduct.
 */
export function decideVolunteerApproval(input: {
  status: VolunteerApplicationStatus;
  safeguardingDeclaration: DeclarationState;
  codeOfConduct: DeclarationState;
}): VolunteerApprovalDecision {
  const move = transitionVolunteerApplication(input.status, "approve");
  if (!move.ok) return { ok: false, reason: move.reason };
  const safeguarding = checkDeclaration(input.safeguardingDeclaration);
  if (!safeguarding.ok) {
    return {
      ok: false,
      reason: `safeguarding_declaration_${safeguarding.problem}`,
    };
  }
  const conduct = checkDeclaration(input.codeOfConduct);
  if (!conduct.ok) {
    return { ok: false, reason: `code_of_conduct_${conduct.problem}` };
  }
  return {
    ok: true,
    status: "approved",
    safeguardingConsentId: safeguarding.consentEventId,
    conductConsentId: conduct.consentEventId,
  };
}
