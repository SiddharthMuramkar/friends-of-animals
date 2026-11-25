import { describe, expect, it } from "vitest";

import {
  privacyRequestAuditSchema,
  privacyRequestAuditSnapshot,
} from "./audit";

const request = {
  id: "0190a000-0000-7000-8000-0000000000aa",
  reference: "PR-27-8H3TZQ",
  type: "correction" as const,
  status: "in_progress" as const,
  relation: "guardian" as const,
  subjectKind: "participant_profile" as const,
  subjectId: "0190a000-0000-7000-8000-0000000000bb",
  requestedByUserId: "0190a000-0000-7000-8000-0000000000cc",
  assignedToUserId: "0190a000-0000-7000-8000-0000000000dd",
  correctionDetails: "My daughter's surname is spelt Kulkarni, not Kulkarny",
  resolutionNote: null,
  rejectionReason: null,
};

describe("privacyRequestAuditSnapshot", () => {
  it("keeps the lifecycle fields and drops every free-text field", () => {
    const snapshot = privacyRequestAuditSnapshot(request, { notes: 2 });
    expect(snapshot).toEqual({
      type: "correction",
      status: "in_progress",
      relation: "guardian",
      subjectKind: "participant_profile",
      assignedToUserId: "0190a000-0000-7000-8000-0000000000dd",
      notes: 2,
    });
    expect(JSON.stringify(snapshot)).not.toMatch(/Kulkarn/);
  });

  it("passes its own schema", () => {
    expect(() =>
      privacyRequestAuditSchema.parse(privacyRequestAuditSnapshot(request))
    ).not.toThrow();
  });
});

describe("privacyRequestAuditSchema", () => {
  it("rejects any key it doesn't name, so free text can't slip in", () => {
    for (const extra of [
      { reason: "Duplicate request" },
      { body: "Called the parent" },
      { email: "asha@example.test" },
      { subjectId: request.subjectId },
    ]) {
      expect(
        privacyRequestAuditSchema.safeParse({
          type: "access",
          status: "submitted",
          relation: "self",
          subjectKind: "user",
          assignedToUserId: null,
          ...extra,
        }).success
      ).toBe(false);
    }
  });

  it("only takes a uuid as the assignee", () => {
    expect(
      privacyRequestAuditSchema.safeParse({
        type: "access",
        status: "in_progress",
        relation: "self",
        subjectKind: "user",
        assignedToUserId: "Asha Rao",
      }).success
    ).toBe(false);
  });
});
