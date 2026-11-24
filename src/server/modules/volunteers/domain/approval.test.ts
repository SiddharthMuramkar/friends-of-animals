import { describe, expect, it } from "vitest";

import type { VolunteerApplicationStatus } from "./application-status";
import { decideVolunteerApproval, type DeclarationState } from "./approval";

const SAFEGUARDING_V2 = "0190d2a0-0000-7000-8000-000000000002";
const SAFEGUARDING_V1 = "0190d2a0-0000-7000-8000-000000000001";
const CONDUCT_V3 = "0190d2a0-0000-7000-8000-000000000013";
const CONDUCT_V2 = "0190d2a0-0000-7000-8000-000000000012";

const given = (
  documentId: string,
  currentDocumentId: string,
  consentEventId: string
): DeclarationState => ({
  consent: { state: "given", documentId, consentEventId },
  currentDocumentId,
});

const safeguardingGiven = given(SAFEGUARDING_V2, SAFEGUARDING_V2, "evt-safe");
const conductGiven = given(CONDUCT_V3, CONDUCT_V3, "evt-conduct");

function decide(input: {
  status?: VolunteerApplicationStatus;
  safeguarding?: DeclarationState;
  conduct?: DeclarationState;
}) {
  return decideVolunteerApproval({
    status: input.status ?? "submitted",
    safeguardingDeclaration: input.safeguarding ?? safeguardingGiven,
    codeOfConduct: input.conduct ?? conductGiven,
  });
}

describe("decideVolunteerApproval", () => {
  it("approves a submitted application with both current declarations, naming the consents it records", () => {
    expect(decide({})).toEqual({
      ok: true,
      status: "approved",
      safeguardingConsentId: "evt-safe",
      conductConsentId: "evt-conduct",
    });
  });

  it("refuses an application that isn't waiting for a community manager", () => {
    for (const status of [
      "awaiting_guardian",
      "guardian_declined",
      "approved",
      "declined",
      "withdrawn",
    ] as const) {
      expect(decide({ status })).toEqual({
        ok: false,
        reason: "invalid_transition",
      });
    }
  });

  it("refuses without the safeguarding declaration", () => {
    expect(
      decide({
        safeguarding: {
          consent: { state: "never" },
          currentDocumentId: SAFEGUARDING_V2,
        },
      })
    ).toEqual({ ok: false, reason: "safeguarding_declaration_missing" });
  });

  it("refuses without the code-of-conduct acceptance", () => {
    expect(
      decide({
        conduct: { consent: { state: "never" }, currentDocumentId: CONDUCT_V3 },
      })
    ).toEqual({ ok: false, reason: "code_of_conduct_missing" });
  });

  it("treats a withdrawn declaration as missing", () => {
    expect(
      decide({
        safeguarding: {
          consent: { state: "withdrawn", documentId: SAFEGUARDING_V2 },
          currentDocumentId: SAFEGUARDING_V2,
        },
      })
    ).toEqual({ ok: false, reason: "safeguarding_declaration_missing" });
    expect(
      decide({
        conduct: {
          consent: { state: "withdrawn", documentId: CONDUCT_V3 },
          currentDocumentId: CONDUCT_V3,
        },
      })
    ).toEqual({ ok: false, reason: "code_of_conduct_missing" });
  });

  it("refuses a declaration given on an older version of the document", () => {
    expect(
      decide({
        safeguarding: given(SAFEGUARDING_V1, SAFEGUARDING_V2, "evt-old"),
      })
    ).toEqual({ ok: false, reason: "safeguarding_declaration_outdated" });
    expect(
      decide({ conduct: given(CONDUCT_V2, CONDUCT_V3, "evt-old") })
    ).toEqual({ ok: false, reason: "code_of_conduct_outdated" });
  });

  it("refuses while a document has no published version at all", () => {
    expect(
      decide({
        safeguarding: { consent: { state: "never" }, currentDocumentId: null },
      })
    ).toEqual({ ok: false, reason: "safeguarding_declaration_unpublished" });
    expect(
      decide({
        conduct: { consent: { state: "never" }, currentDocumentId: null },
      })
    ).toEqual({ ok: false, reason: "code_of_conduct_unpublished" });
  });

  it("refuses in a fixed order: status, then safeguarding, then conduct", () => {
    const missing: DeclarationState = {
      consent: { state: "never" },
      currentDocumentId: CONDUCT_V3,
    };
    expect(
      decide({
        status: "awaiting_guardian",
        safeguarding: missing,
        conduct: missing,
      })
    ).toEqual({ ok: false, reason: "invalid_transition" });
    expect(decide({ safeguarding: missing, conduct: missing })).toEqual({
      ok: false,
      reason: "safeguarding_declaration_missing",
    });
  });
});
