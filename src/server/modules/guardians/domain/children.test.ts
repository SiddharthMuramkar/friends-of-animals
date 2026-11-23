import { describe, expect, it } from "vitest";

import {
  childKindForAge,
  decideAddChild,
  decideTeenAcceptance,
  decideTeenInvite,
} from "./children";

describe("childKindForAge", () => {
  it("keeps a child under 13 on a guardian-managed profile with no login", () => {
    expect(childKindForAge(0)).toBe("managed");
    expect(childKindForAge(9)).toBe("managed");
    expect(childKindForAge(12)).toBe("managed");
  });

  it("gives a 13- to 17-year-old an own login linked to the guardian", () => {
    expect(childKindForAge(13)).toBe("linked");
    expect(childKindForAge(15)).toBe("linked");
    expect(childKindForAge(17)).toBe("linked");
  });

  it("treats 18 and over as an adult, who is nobody's child here", () => {
    expect(childKindForAge(18)).toBe("adult");
    expect(childKindForAge(40)).toBe("adult");
  });
});

describe("decideAddChild", () => {
  it("adds a 9-year-old as managed and a 15-year-old as linked for a verified guardian", () => {
    expect(decideAddChild({ guardianVerified: true, ageYears: 9 })).toEqual({
      ok: true,
      kind: "managed",
    });
    expect(decideAddChild({ guardianVerified: true, ageYears: 15 })).toEqual({
      ok: true,
      kind: "linked",
    });
  });

  it("refuses every child until the guardian has verified by code", () => {
    expect(decideAddChild({ guardianVerified: false, ageYears: 9 })).toEqual({
      ok: false,
      reason: "guardian_not_verified",
    });
    expect(decideAddChild({ guardianVerified: false, ageYears: null })).toEqual(
      { ok: false, reason: "guardian_not_verified" }
    );
  });

  it("refuses a date of birth that could not be read", () => {
    expect(decideAddChild({ guardianVerified: true, ageYears: null })).toEqual({
      ok: false,
      reason: "dob_invalid",
    });
  });

  it("refuses an adult, who registers themselves", () => {
    expect(decideAddChild({ guardianVerified: true, ageYears: 18 })).toEqual({
      ok: false,
      reason: "adult",
    });
  });
});

describe("decideTeenInvite", () => {
  const teen = {
    ageYears: 15,
    childHasLogin: false,
    inviteeIsAGuardian: false,
  };

  it("lets a guardian invite a 13- to 17-year-old without a login", () => {
    expect(decideTeenInvite(teen)).toEqual({ ok: true });
    expect(decideTeenInvite({ ...teen, ageYears: 13 })).toEqual({ ok: true });
    expect(decideTeenInvite({ ...teen, ageYears: 17 })).toEqual({ ok: true });
  });

  it("never gives a child under 13 a login", () => {
    expect(decideTeenInvite({ ...teen, ageYears: 12 })).toEqual({
      ok: false,
      reason: "under_13",
    });
  });

  it("refuses a child who has turned 18", () => {
    expect(decideTeenInvite({ ...teen, ageYears: 18 })).toEqual({
      ok: false,
      reason: "adult",
    });
  });

  it("refuses a second login for a child who already has one", () => {
    expect(decideTeenInvite({ ...teen, childHasLogin: true })).toEqual({
      ok: false,
      reason: "child_has_login",
    });
  });

  it("refuses an address that belongs to one of the child's guardians", () => {
    expect(decideTeenInvite({ ...teen, inviteeIsAGuardian: true })).toEqual({
      ok: false,
      reason: "invitee_is_guardian",
    });
  });

  it("gives the age reason first when several apply", () => {
    expect(
      decideTeenInvite({
        ageYears: 9,
        childHasLogin: true,
        inviteeIsAGuardian: true,
      })
    ).toEqual({ ok: false, reason: "under_13" });
  });
});

describe("decideTeenAcceptance", () => {
  const now = new Date("2027-01-15T04:30:00.000Z");
  const ready = {
    invitation: {
      status: "pending" as const,
      expiresAt: new Date("2027-01-22T04:30:00.000Z"),
    },
    now,
    accepter: {
      isTheInvitedContact: true,
      isAGuardianOfChild: false,
      isAGuardian: false,
      holdsOtherRole: false,
      ownProfile: "none" as "none" | "adult" | "minor",
      linkedToAnotherChild: false,
    },
    child: { ageYears: 15, hasLogin: false },
  };

  it("links the invited teen's own login to the child", () => {
    expect(decideTeenAcceptance(ready)).toEqual({ ok: true });
  });

  it("does not say whether an unknown token ever existed", () => {
    expect(decideTeenAcceptance({ ...ready, invitation: null })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("refuses an invitation already used or withdrawn", () => {
    const used = { ...ready.invitation, status: "accepted" as const };
    const withdrawn = { ...ready.invitation, status: "revoked" as const };
    expect(decideTeenAcceptance({ ...ready, invitation: used })).toEqual({
      ok: false,
      reason: "already_used",
    });
    expect(decideTeenAcceptance({ ...ready, invitation: withdrawn })).toEqual({
      ok: false,
      reason: "withdrawn",
    });
  });

  it("refuses an invitation from its expiry instant on", () => {
    const atExpiry = new Date("2027-01-22T04:30:00.000Z");
    const justBefore = new Date("2027-01-22T04:29:59.999Z");
    expect(decideTeenAcceptance({ ...ready, now: atExpiry })).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(decideTeenAcceptance({ ...ready, now: justBefore })).toEqual({
      ok: true,
    });
  });

  it("refuses the guardian accepting their own invitation", () => {
    const accepter = {
      ...ready.accepter,
      isTheInvitedContact: false,
      isAGuardianOfChild: true,
      isAGuardian: true,
    };
    expect(decideTeenAcceptance({ ...ready, accepter })).toEqual({
      ok: false,
      reason: "guardian_cannot_accept",
    });
  });

  it("refuses someone signed in with a different address", () => {
    const accepter = { ...ready.accepter, isTheInvitedContact: false };
    expect(decideTeenAcceptance({ ...ready, accepter })).toEqual({
      ok: false,
      reason: "contact_mismatch",
    });
  });

  it("refuses a guardian's account, even one that is no guardian of this child", () => {
    const accepter = { ...ready.accepter, isAGuardian: true };
    expect(decideTeenAcceptance({ ...ready, accepter })).toEqual({
      ok: false,
      reason: "accepter_is_guardian",
    });
  });

  it("refuses an account that registered itself as an adult (#78)", () => {
    const accepter = { ...ready.accepter, ownProfile: "adult" as const };
    expect(decideTeenAcceptance({ ...ready, accepter })).toEqual({
      ok: false,
      reason: "accepter_is_adult",
    });
  });

  it("refuses a teen with a profile of their own, held for a guardian they asked (#81)", () => {
    const accepter = { ...ready.accepter, ownProfile: "minor" as const };
    expect(decideTeenAcceptance({ ...ready, accepter })).toEqual({
      ok: false,
      reason: "accepter_has_own_profile",
    });
  });

  it("refuses an account holding a staff, school or judge role", () => {
    const accepter = { ...ready.accepter, holdsOtherRole: true };
    expect(decideTeenAcceptance({ ...ready, accepter })).toEqual({
      ok: false,
      reason: "accepter_has_role",
    });
  });

  it("tells an adult signed in with another address about the address first", () => {
    const accepter = {
      ...ready.accepter,
      isTheInvitedContact: false,
      ownProfile: "adult" as const,
    };
    expect(decideTeenAcceptance({ ...ready, accepter })).toEqual({
      ok: false,
      reason: "contact_mismatch",
    });
  });

  it("tells a guardian signed in with another address about the address first", () => {
    const accepter = {
      ...ready.accepter,
      isTheInvitedContact: false,
      isAGuardian: true,
    };
    expect(decideTeenAcceptance({ ...ready, accepter })).toEqual({
      ok: false,
      reason: "contact_mismatch",
    });
  });

  it("refuses a login already linked to another child", () => {
    const accepter = { ...ready.accepter, linkedToAnotherChild: true };
    expect(decideTeenAcceptance({ ...ready, accepter })).toEqual({
      ok: false,
      reason: "already_linked",
    });
  });

  it("refuses when the child got a login some other way meanwhile", () => {
    const child = { ...ready.child, hasLogin: true };
    expect(decideTeenAcceptance({ ...ready, child })).toEqual({
      ok: false,
      reason: "child_has_login",
    });
  });

  it("refuses when the child is no longer 13 to 17 on the day of accepting", () => {
    expect(
      decideTeenAcceptance({
        ...ready,
        child: { ageYears: 18, hasLogin: false },
      })
    ).toEqual({ ok: false, reason: "adult" });
    expect(
      decideTeenAcceptance({
        ...ready,
        child: { ageYears: 12, hasLogin: false },
      })
    ).toEqual({ ok: false, reason: "under_13" });
  });

  it("checks the invitation before who is accepting it", () => {
    expect(
      decideTeenAcceptance({
        ...ready,
        now: new Date("2027-02-01T00:00:00.000Z"),
        accepter: {
          isTheInvitedContact: false,
          isAGuardianOfChild: true,
          isAGuardian: true,
          holdsOtherRole: true,
          ownProfile: "adult",
          linkedToAnotherChild: true,
        },
      })
    ).toEqual({ ok: false, reason: "expired" });
  });
});
