import { describe, expect, it } from "vitest";

import {
  COMMUNITY_MEMBER_STATUSES,
  canTransitionMembership,
  decideJoin,
  decideLeave,
  memberProfileSchema,
  type CommunityMemberStatus,
} from "./membership";

// The expected machine, written out by hand.
const ALLOWED: readonly (readonly [
  CommunityMemberStatus | null,
  CommunityMemberStatus,
])[] = [
  [null, "active"],
  ["active", "left"],
  ["left", "active"],
];

const PAIRS = ([null, "active", "left"] as const).flatMap((from) =>
  (["active", "left"] as const).map((to) => ({
    from,
    to,
    allowed: ALLOWED.some(([f, t]) => f === from && t === to),
  }))
);

describe("membership status machine", () => {
  it("declares every status up front", () => {
    expect([...COMMUNITY_MEMBER_STATUSES]).toEqual(["active", "left"]);
  });

  it.each(PAIRS)("$from -> $to allowed: $allowed", ({ from, to, allowed }) => {
    expect(canTransitionMembership(from, to)).toBe(allowed);
  });
});

describe("decideJoin", () => {
  it("lets a signed-in person join for themselves", () => {
    expect(decideJoin({ target: "self" }, null)).toEqual({
      ok: true,
      from: null,
    });
  });

  it("lets someone who left join again", () => {
    expect(decideJoin({ target: "self" }, "left")).toEqual({
      ok: true,
      from: "left",
    });
  });

  it("refuses an active member", () => {
    expect(decideJoin({ target: "self" }, "active")).toEqual({
      ok: false,
      reason: "already_member",
    });
  });

  it("lets a guardian join a linked child who has no login", () => {
    expect(
      decideJoin(
        { target: "child", linkedGuardian: true, childHasOwnLogin: false },
        null
      )
    ).toEqual({ ok: true, from: null });
  });

  it("leaves a child with an own login to join themselves", () => {
    expect(
      decideJoin(
        { target: "child", linkedGuardian: true, childHasOwnLogin: true },
        null
      )
    ).toEqual({ ok: false, reason: "child_joins_themselves" });
  });

  it("refuses anyone who isn't the child's guardian, before anything else", () => {
    for (const childHasOwnLogin of [false, true]) {
      for (const current of [null, "active", "left"] as const) {
        expect(
          decideJoin(
            { target: "child", linkedGuardian: false, childHasOwnLogin },
            current
          )
        ).toEqual({ ok: false, reason: "not_guardian" });
      }
    }
  });

  it("refuses a child who is already a member", () => {
    expect(
      decideJoin(
        { target: "child", linkedGuardian: true, childHasOwnLogin: false },
        "active"
      )
    ).toEqual({ ok: false, reason: "already_member" });
  });
});

describe("decideLeave", () => {
  it("lets an active member leave", () => {
    expect(decideLeave("active")).toEqual({ ok: true });
  });

  it.each([null, "left"] as const)("refuses %s", (current) => {
    expect(decideLeave(current)).toEqual({ ok: false, reason: "not_member" });
  });
});

describe("memberProfileSchema", () => {
  it("trims the name and turns a blank about into null", () => {
    expect(
      memberProfileSchema.parse({ displayName: "  Asha K. ", about: "   " })
    ).toEqual({ displayName: "Asha K.", about: null });
    expect(memberProfileSchema.parse({ displayName: "Asha K." })).toEqual({
      displayName: "Asha K.",
      about: null,
    });
  });

  it("keeps an about of up to 280 characters, counting each emoji once", () => {
    const about = `${"a".repeat(278)}🐶🐱`;
    expect(memberProfileSchema.parse({ displayName: "Ravi", about })).toEqual({
      displayName: "Ravi",
      about,
    });
  });

  it.each([
    [
      "an about over 280 characters",
      { displayName: "Ravi", about: "a".repeat(281) },
    ],
    ["a one-letter name", { displayName: " R " }],
    ["a name over 60 characters", { displayName: "R".repeat(61) }],
    ["a name with a line break", { displayName: "Ra\nvi" }],
    [
      "an about with a control character",
      { displayName: "Ravi", about: "hi\u0007" },
    ],
    ["an unknown field", { displayName: "Ravi", phone: "9800000000" }],
  ])("refuses %s", (_, input) => {
    expect(memberProfileSchema.safeParse(input).success).toBe(false);
  });

  it("allows line breaks in the about", () => {
    expect(
      memberProfileSchema.parse({
        displayName: "Ravi",
        about: "Line one\nLine two",
      }).about
    ).toBe("Line one\nLine two");
  });
});
