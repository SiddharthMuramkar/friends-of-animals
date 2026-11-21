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
  guardianUserIds: [],
};

/** A 15-year-old with their own login, linked to PARENT. */
const teen: AffectedPerson = {
  ref: { type: "user", id: TEEN },
  userId: TEEN,
  minor: true,
  guardianUserIds: [PARENT],
};

/** A 9-year-old's profile that OTHER_PARENT manages; no login. */
const child: AffectedPerson = {
  ref: { type: "participant_profile", id: CHILD_PROFILE },
  userId: null,
  minor: true,
  guardianUserIds: [OTHER_PARENT],
};

describe("planBreachNotices", () => {
  it("tells the adult and both guardians, and never the teen", () => {
    const plan = planBreachNotices([adult, teen, child]);
    expect(plan.recipients).toEqual([
      { userId: ADULT, as: "principal", about: [adult.ref] },
      { userId: PARENT, as: "guardian", about: [teen.ref] },
      { userId: OTHER_PARENT, as: "guardian", about: [child.ref] },
    ]);
    expect(plan.recipients.map((r) => r.userId)).not.toContain(TEEN);
    expect(plan.unreachable).toEqual([]);
  });

  it("sends a parent of two affected children one notice about both", () => {
    const sibling: AffectedPerson = {
      ref: { type: "participant_profile", id: SECOND_CHILD_PROFILE },
      userId: null,
      minor: true,
      guardianUserIds: [PARENT],
    };
    expect(planBreachNotices([teen, sibling]).recipients).toEqual([
      { userId: PARENT, as: "guardian", about: [teen.ref, sibling.ref] },
    ]);
  });

  it("tells both guardians of a child who has two", () => {
    const shared: AffectedPerson = {
      ...child,
      guardianUserIds: [OTHER_PARENT, PARENT],
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
      guardianUserIds: [],
    };
    expect(planBreachNotices([teen, parentAccount]).recipients).toEqual([
      {
        userId: PARENT,
        as: "principal_and_guardian",
        about: [teen.ref, parentAccount.ref],
      },
    ]);
  });

  it("reports a child with no active guardian instead of telling the child", () => {
    const alone: AffectedPerson = { ...teen, guardianUserIds: [] };
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
      guardianUserIds: [OTHER_PARENT],
    };
    expect(planBreachNotices([profileOnly])).toEqual({
      recipients: [],
      unreachable: [{ ref: profileOnly.ref, reason: "no_account" }],
    });
  });

  it("counts a person listed twice once, and a guardian listed twice once", () => {
    const doubled: AffectedPerson = {
      ...child,
      guardianUserIds: [OTHER_PARENT, OTHER_PARENT],
    };
    expect(planBreachNotices([doubled, doubled, adult, adult])).toEqual({
      recipients: [
        { userId: ADULT, as: "principal", about: [adult.ref] },
        { userId: OTHER_PARENT, as: "guardian", about: [child.ref] },
      ],
      unreachable: [],
    });
  });

  it("plans nothing for nobody", () => {
    expect(planBreachNotices([])).toEqual({ recipients: [], unreachable: [] });
  });
});
