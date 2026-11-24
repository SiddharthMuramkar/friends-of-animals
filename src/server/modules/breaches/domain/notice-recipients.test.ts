import { describe, expect, it } from "vitest";

import { planBreachNotices, type AffectedPerson } from "./notice-recipients";

const ADULT = "0194f3a2-7c00-7000-8000-00000000000a";
const TEEN = "0194f3a2-7c00-7000-8000-00000000000b";
const PARENT = "0194f3a2-7c00-7000-8000-00000000000c";
const OTHER_PARENT = "0194f3a2-7c00-7000-8000-00000000000d";
const CHILD_PROFILE = "0194f3a2-7c00-7000-8000-0000000000e1";
const SECOND_CHILD_PROFILE = "0194f3a2-7c00-7000-8000-0000000000e2";

const adult: AffectedPerson = {
  ref: { type: "user", id: ADULT },
  userId: ADULT,
  minor: false,
  guardians: [],
};

/** A 15-year-old with their own login, linked to PARENT. */
const teen: AffectedPerson = {
  ref: { type: "user", id: TEEN },
  userId: TEEN,
  minor: true,
  guardians: [{ userId: PARENT, profileId: CHILD_PROFILE }],
};

/** A 9-year-old's profile that OTHER_PARENT manages; no login. */
const child: AffectedPerson = {
  ref: { type: "participant_profile", id: CHILD_PROFILE },
  userId: null,
  minor: true,
  guardians: [{ userId: OTHER_PARENT, profileId: CHILD_PROFILE }],
};

describe("planBreachNotices", () => {
  it("tells the adult and both guardians, and never the teen", () => {
    const plan = planBreachNotices([adult, teen, child]);
    expect(plan.recipients).toEqual([
      {
        userId: ADULT,
        as: "principal",
        about: [adult.ref],
        guardianProfileIds: [],
      },
      {
        userId: PARENT,
        as: "guardian",
        about: [teen.ref],
        guardianProfileIds: [CHILD_PROFILE],
      },
      {
        userId: OTHER_PARENT,
        as: "guardian",
        about: [child.ref],
        guardianProfileIds: [CHILD_PROFILE],
      },
    ]);
    expect(plan.recipients.map((r) => r.userId)).not.toContain(TEEN);
    expect(plan.unreachable).toEqual([]);
  });

  it("sends a parent of two affected children one notice about both", () => {
    const sibling: AffectedPerson = {
      ref: { type: "participant_profile", id: SECOND_CHILD_PROFILE },
      userId: null,
      minor: true,
      guardians: [{ userId: PARENT, profileId: SECOND_CHILD_PROFILE }],
    };
    expect(planBreachNotices([teen, sibling]).recipients).toEqual([
      {
        userId: PARENT,
        as: "guardian",
        about: [teen.ref, sibling.ref],
        guardianProfileIds: [CHILD_PROFILE, SECOND_CHILD_PROFILE],
      },
    ]);
  });

  it("tells both guardians of a child who has two", () => {
    const shared: AffectedPerson = {
      ...child,
      guardians: [
        { userId: OTHER_PARENT, profileId: CHILD_PROFILE },
        { userId: PARENT, profileId: CHILD_PROFILE },
      ],
    };
    expect(planBreachNotices([shared]).recipients.map((r) => r.userId)).toEqual(
      [PARENT, OTHER_PARENT]
    );
  });

  it("merges an affected adult who is also an affected child's guardian", () => {
    const parentAccount: AffectedPerson = {
      ref: { type: "user", id: PARENT },
      userId: PARENT,
      minor: false,
      guardians: [],
    };
    expect(planBreachNotices([teen, parentAccount]).recipients).toEqual([
      {
        userId: PARENT,
        as: "principal_and_guardian",
        about: [teen.ref, parentAccount.ref],
        guardianProfileIds: [CHILD_PROFILE],
      },
    ]);
  });

  it("reports a child with no active guardian instead of telling the child", () => {
    const alone: AffectedPerson = { ...teen, guardians: [] };
    expect(planBreachNotices([alone])).toEqual({
      recipients: [],
      unreachable: [{ ref: teen.ref, reason: "no_guardian" }],
    });
  });

  it("reports an adult without an account", () => {
    const profileOnly: AffectedPerson = {
      ref: { type: "participant_profile", id: CHILD_PROFILE },
      userId: null,
      minor: false,
      guardians: [{ userId: OTHER_PARENT, profileId: CHILD_PROFILE }],
    };
    expect(planBreachNotices([profileOnly])).toEqual({
      recipients: [],
      unreachable: [{ ref: profileOnly.ref, reason: "no_account" }],
    });
  });

  it("counts a person listed twice once, and a guardian listed twice once", () => {
    const doubled: AffectedPerson = {
      ...child,
      guardians: [...child.guardians, ...child.guardians],
    };
    expect(planBreachNotices([doubled, doubled, adult, adult])).toEqual({
      recipients: [
        {
          userId: ADULT,
          as: "principal",
          about: [adult.ref],
          guardianProfileIds: [],
        },
        {
          userId: OTHER_PARENT,
          as: "guardian",
          about: [child.ref],
          guardianProfileIds: [CHILD_PROFILE],
        },
      ],
      unreachable: [],
    });
  });

  it("plans nothing for nobody", () => {
    expect(planBreachNotices([])).toEqual({ recipients: [], unreachable: [] });
  });
});
