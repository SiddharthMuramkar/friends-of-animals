import { describe, expect, it } from "vitest";

import { planThankYouLetters } from "./thank-you-letters";

describe("planThankYouLetters", () => {
  it("writes to an adult creator who entered on their own, and to no school", () => {
    expect(
      planThankYouLetters({
        creatorIsMinor: false,
        creatorLoginUserId: "creator",
        guardianUserIds: [],
        route: "individual",
        institutionId: "inst-1",
        schoolUserIds: ["principal"],
      })
    ).toEqual({
      letters: [{ kind: "creator", recipientUserIds: ["creator"] }],
      problems: [],
    });
  });

  it("writes to the guardians of a child entered by a school, and to the school, never to the child", () => {
    expect(
      planThankYouLetters({
        creatorIsMinor: true,
        creatorLoginUserId: null,
        guardianUserIds: ["mum", "dad", "mum"],
        route: "institution",
        institutionId: "inst-1",
        schoolUserIds: ["principal", "coordinator"],
      })
    ).toEqual({
      letters: [
        { kind: "guardian", recipientUserIds: ["mum", "dad"] },
        {
          kind: "school",
          institutionId: "inst-1",
          recipientUserIds: ["principal", "coordinator"],
        },
      ],
      problems: [],
    });
  });

  it("writes to the guardian, not to a teenager with their own login", () => {
    expect(
      planThankYouLetters({
        creatorIsMinor: true,
        creatorLoginUserId: "teen",
        guardianUserIds: ["guardian"],
        route: "individual",
        institutionId: null,
        schoolUserIds: [],
      })
    ).toEqual({
      letters: [{ kind: "guardian", recipientUserIds: ["guardian"] }],
      problems: [],
    });
  });

  it("writes to an adult creator entered by a school and to the school", () => {
    expect(
      planThankYouLetters({
        creatorIsMinor: false,
        creatorLoginUserId: "creator",
        guardianUserIds: [],
        route: "institution",
        institutionId: "inst-1",
        schoolUserIds: ["principal"],
      }).letters.map((letter) => letter.kind)
    ).toEqual(["creator", "school"]);
  });

  it("still plans a letter with nobody to send it to, and says who is missing", () => {
    expect(
      planThankYouLetters({
        creatorIsMinor: true,
        creatorLoginUserId: "teen",
        guardianUserIds: [],
        route: "institution",
        institutionId: "inst-1",
        schoolUserIds: [],
      })
    ).toEqual({
      letters: [
        { kind: "guardian", recipientUserIds: [] },
        { kind: "school", institutionId: "inst-1", recipientUserIds: [] },
      ],
      problems: ["guardian_missing", "school_contact_missing"],
    });
  });

  it("flags an adult creator with no login of their own", () => {
    expect(
      planThankYouLetters({
        creatorIsMinor: false,
        creatorLoginUserId: null,
        guardianUserIds: [],
        route: "individual",
        institutionId: null,
        schoolUserIds: [],
      })
    ).toEqual({
      letters: [{ kind: "creator", recipientUserIds: [] }],
      problems: ["creator_login_missing"],
    });
  });

  it("refuses a school entry without its institution", () => {
    expect(() =>
      planThankYouLetters({
        creatorIsMinor: false,
        creatorLoginUserId: "creator",
        guardianUserIds: [],
        route: "institution",
        institutionId: null,
        schoolUserIds: [],
      })
    ).toThrow(RangeError);
  });
});
