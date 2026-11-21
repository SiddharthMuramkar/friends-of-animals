import { describe, expect, it } from "vitest";

import {
  planAnnouncementAudience,
  type AccountContact,
  type AudienceSnapshot,
  type DetailsContact,
  type Participant,
} from "./audience";

// 10:00 IST on 15 January 2027.
const AT = new Date("2027-01-15T04:30:00.000Z");
const ADULT_DOB = "2000-05-01";
const TEEN_DOB = "2011-03-10"; // 15, own login linked to a guardian
const CHILD_DOB = "2017-08-20"; // 9, guardian-managed, no login

const account = (
  userId: string,
  email: string | null,
  phone: string | null = null
): AccountContact => ({ kind: "account", userId, email, phone });

const details = (
  email: string | null,
  phone: string | null = null
): DetailsContact => ({ kind: "details", name: "A guardian", email, phone });

const participant = (
  id: string,
  dateOfBirth: string | null,
  self: Participant["self"],
  guardians: Participant["guardians"] = []
): Participant => ({ participantProfileId: id, dateOfBirth, self, guardians });

const empty: AudienceSnapshot = {
  individualRegistrations: [],
  institutionRegistrations: [],
};

function individuals(
  ...entries: [Participant, boolean?][]
): AudienceSnapshot["individualRegistrations"] {
  return entries.map(([p, confirmed = true], index) => ({
    registrationId: `reg-${index}`,
    confirmed,
    participant: p,
  }));
}

const keys = (snapshot: AudienceSnapshot) =>
  planAnnouncementAudience(snapshot, AT).recipients.map((r) => r.key);

describe("planAnnouncementAudience", () => {
  it("sends to a confirmed adult individual participant themselves", () => {
    const snapshot = {
      ...empty,
      individualRegistrations: individuals([
        participant("p1", ADULT_DOB, account("u-adult", "adult@example.test")),
      ]),
    };

    const plan = planAnnouncementAudience(snapshot, AT);

    expect(plan.recipients).toEqual([
      {
        key: "user:u-adult",
        contact: account("u-adult", "adult@example.test"),
        roles: ["participant"],
      },
    ]);
  });

  it("sends a minor's copy to the guardian and never to the minor", () => {
    const snapshot = {
      ...empty,
      individualRegistrations: individuals([
        participant("teen", TEEN_DOB, account("u-teen", "teen@example.test"), [
          account("u-guardian", "guardian@example.test"),
        ]),
      ]),
    };

    const plan = planAnnouncementAudience(snapshot, AT);

    expect(plan.recipients.map((r) => [r.key, r.roles])).toEqual([
      ["user:u-guardian", ["guardian"]],
    ]);
    expect(JSON.stringify(plan)).not.toContain("u-teen");
    expect(JSON.stringify(plan)).not.toContain("teen@example.test");
  });

  it("sends to every guardian of a minor", () => {
    const snapshot = {
      ...empty,
      individualRegistrations: individuals([
        participant("child", CHILD_DOB, null, [
          account("u-mother", "mother@example.test"),
          account("u-father", "father@example.test"),
        ]),
      ]),
    };

    expect(keys(snapshot)).toEqual(["user:u-mother", "user:u-father"]);
  });

  it("reports a minor with no reachable guardian instead of messaging the minor", () => {
    const snapshot = {
      ...empty,
      individualRegistrations: individuals([
        participant("teen", TEEN_DOB, account("u-teen", "teen@example.test"), [
          details(null, null),
        ]),
      ]),
    };

    const plan = planAnnouncementAudience(snapshot, AT);

    expect(plan.recipients).toEqual([]);
    expect(plan.unreachable).toEqual([
      { participantProfileId: "teen", reason: "minor_without_guardian" },
    ]);
  });

  it("decides minority at the send instant", () => {
    const turns18Tomorrow = participant(
      "p",
      "2009-01-16",
      account("u-self", "self@example.test"),
      [account("u-guardian", "guardian@example.test")]
    );
    const snapshot = {
      ...empty,
      individualRegistrations: individuals([turns18Tomorrow]),
    };

    expect(keys(snapshot)).toEqual(["user:u-guardian"]);
    expect(
      planAnnouncementAudience(snapshot, new Date("2027-01-16T04:30:00Z"))
        .recipients[0]?.key
    ).toBe("user:u-self");
  });

  it("leaves out registrations that are not confirmed", () => {
    const snapshot = {
      ...empty,
      individualRegistrations: individuals(
        [participant("p1", ADULT_DOB, account("u-paid", "paid@example.test"))],
        [
          participant("p2", ADULT_DOB, account("u-pending", "p@example.test")),
          false,
        ]
      ),
    };

    expect(keys(snapshot)).toEqual(["user:u-paid"]);
  });

  describe("institution registrations", () => {
    const school = (
      overrides: Partial<AudienceSnapshot["institutionRegistrations"][number]>
    ): AudienceSnapshot["institutionRegistrations"][number] => ({
      institutionRegistrationId: "ir-1",
      confirmed: true,
      coordinators: [account("u-coord", "coord@example.test")],
      students: [],
      ...overrides,
    });

    it("sends to every coordinator of a confirmed institution registration", () => {
      const snapshot = {
        ...empty,
        institutionRegistrations: [
          school({
            coordinators: [
              account("u-coord", "coord@example.test"),
              account("u-coord-2", "coord2@example.test"),
            ],
          }),
        ],
      };

      const plan = planAnnouncementAudience(snapshot, AT);

      expect(plan.recipients.map((r) => [r.key, r.roles])).toEqual([
        ["user:u-coord", ["coordinator"]],
        ["user:u-coord-2", ["coordinator"]],
      ]);
    });

    it("sends to enrolled students' guardians, or to an adult student", () => {
      const snapshot = {
        ...empty,
        institutionRegistrations: [
          school({
            students: [
              {
                registrationId: "s1",
                enrolled: true,
                participant: participant(
                  "adult-student",
                  ADULT_DOB,
                  details("student@example.test"),
                  [details("parent-a@example.test")]
                ),
              },
              {
                registrationId: "s2",
                enrolled: true,
                participant: participant("minor-student", CHILD_DOB, null, [
                  details("parent-b@example.test", "+919800000002"),
                ]),
              },
            ],
          }),
        ],
      };

      expect(keys(snapshot)).toEqual([
        "user:u-coord",
        "email:student@example.test",
        "email:parent-b@example.test",
      ]);
    });

    it("leaves out unconfirmed institution registrations and withdrawn students", () => {
      const student = (id: string, enrolled: boolean) => ({
        registrationId: id,
        enrolled,
        participant: participant(id, ADULT_DOB, details(`${id}@example.test`)),
      });
      const snapshot = {
        ...empty,
        institutionRegistrations: [
          school({ confirmed: false, students: [student("a", true)] }),
          school({
            institutionRegistrationId: "ir-2",
            coordinators: [],
            students: [student("b", true), student("c", false)],
          }),
        ],
      };

      expect(keys(snapshot)).toEqual(["email:b@example.test"]);
    });
  });

  describe("one copy per person", () => {
    it("sends a guardian of two enrolled siblings one copy", () => {
      const parent = details("Parent@Example.test ", "+919800000001");
      const snapshot = {
        ...empty,
        institutionRegistrations: [
          {
            institutionRegistrationId: "ir-1",
            confirmed: true,
            coordinators: [],
            students: ["sib-1", "sib-2"].map((id) => ({
              registrationId: id,
              enrolled: true,
              participant: participant(id, CHILD_DOB, null, [parent]),
            })),
          },
        ],
      };

      expect(keys(snapshot)).toEqual(["email:parent@example.test"]);
    });

    it("merges a contact-only guardian into the account with the same email", () => {
      const snapshot: AudienceSnapshot = {
        individualRegistrations: individuals([
          participant(
            "teen",
            TEEN_DOB,
            account("u-teen", "teen@example.test"),
            [account("u-guardian", "guardian@example.test")]
          ),
        ]),
        institutionRegistrations: [
          {
            institutionRegistrationId: "ir-1",
            confirmed: true,
            coordinators: [],
            students: [
              {
                registrationId: "s1",
                enrolled: true,
                participant: participant("sibling", CHILD_DOB, null, [
                  details("GUARDIAN@example.test"),
                ]),
              },
            ],
          },
        ],
      };

      const plan = planAnnouncementAudience(snapshot, AT);

      expect(plan.recipients).toEqual([
        {
          key: "user:u-guardian",
          contact: account("u-guardian", "guardian@example.test"),
          roles: ["guardian"],
        },
      ]);
    });

    it("merges contact-only details that share a phone number", () => {
      const snapshot = {
        ...empty,
        institutionRegistrations: [
          {
            institutionRegistrationId: "ir-1",
            confirmed: true,
            coordinators: [],
            students: [
              {
                registrationId: "s1",
                enrolled: true,
                participant: participant("a", CHILD_DOB, null, [
                  details(null, "+919800000003"),
                ]),
              },
              {
                registrationId: "s2",
                enrolled: true,
                participant: participant("b", CHILD_DOB, null, [
                  details("parent@example.test", "+919800000003"),
                ]),
              },
            ],
          },
        ],
      };

      const plan = planAnnouncementAudience(snapshot, AT);

      expect(plan.recipients).toEqual([
        {
          key: "phone:+919800000003",
          contact: {
            kind: "details",
            name: "A guardian",
            email: "parent@example.test",
            phone: "+919800000003",
          },
          roles: ["guardian"],
        },
      ]);
    });

    it("lets an account absorb contact details found before it", () => {
      const snapshot: AudienceSnapshot = {
        individualRegistrations: [],
        institutionRegistrations: [
          {
            institutionRegistrationId: "ir-1",
            confirmed: true,
            coordinators: [],
            students: [
              {
                registrationId: "s1",
                enrolled: true,
                participant: participant("child", CHILD_DOB, null, [
                  details("teacher@example.test"),
                ]),
              },
            ],
          },
          {
            institutionRegistrationId: "ir-2",
            confirmed: true,
            coordinators: [account("u-teacher", "teacher@example.test")],
            students: [],
          },
        ],
      };

      const plan = planAnnouncementAudience(snapshot, AT);

      expect(plan.recipients).toEqual([
        {
          key: "user:u-teacher",
          contact: account("u-teacher", "teacher@example.test"),
          roles: ["guardian", "coordinator"],
        },
      ]);
    });

    it("keeps every role of someone who is both coordinator and guardian", () => {
      const snapshot: AudienceSnapshot = {
        individualRegistrations: individuals([
          participant("child", CHILD_DOB, null, [
            account("u-both", "both@example.test"),
          ]),
        ]),
        institutionRegistrations: [
          {
            institutionRegistrationId: "ir-1",
            confirmed: true,
            coordinators: [account("u-both", "both@example.test")],
            students: [],
          },
        ],
      };

      const plan = planAnnouncementAudience(snapshot, AT);

      expect(plan.recipients.map((r) => [r.key, r.roles])).toEqual([
        ["user:u-both", ["guardian", "coordinator"]],
      ]);
    });
  });

  it("falls back to the guardian for an adult with no contact of their own", () => {
    const snapshot = {
      ...empty,
      individualRegistrations: individuals(
        [participant("p", ADULT_DOB, null, [details("parent@example.test")])],
        [participant("q", ADULT_DOB, details(null, null))]
      ),
    };

    const plan = planAnnouncementAudience(snapshot, AT);

    expect(plan.recipients.map((r) => r.key)).toEqual([
      "email:parent@example.test",
    ]);
    expect(plan.unreachable).toEqual([
      { participantProfileId: "q", reason: "no_contact" },
    ]);
  });

  it("counts recipients by role for the send confirmation and the audit row", () => {
    const snapshot: AudienceSnapshot = {
      individualRegistrations: individuals(
        [participant("a", ADULT_DOB, account("u-a", "a@example.test"))],
        [participant("c", CHILD_DOB, null, [account("u-g", "g@example.test")])],
        [participant("t", TEEN_DOB, account("u-t", "t@example.test"))]
      ),
      institutionRegistrations: [
        {
          institutionRegistrationId: "ir-1",
          confirmed: true,
          coordinators: [account("u-co", "co@example.test")],
          students: [],
        },
      ],
    };

    expect(planAnnouncementAudience(snapshot, AT).counts).toEqual({
      recipients: 3,
      participants: 1,
      guardians: 1,
      coordinators: 1,
      unreachable: 1,
    });
  });

  it("gives the same plan for the same snapshot, so a retried fan-out reuses its keys", () => {
    const snapshot = {
      ...empty,
      individualRegistrations: individuals(
        [participant("a", ADULT_DOB, account("u-a", "a@example.test"))],
        [participant("c", CHILD_DOB, null, [details("g@example.test")])]
      ),
    };

    expect(planAnnouncementAudience(snapshot, AT)).toEqual(
      planAnnouncementAudience(snapshot, AT)
    );
  });
});
