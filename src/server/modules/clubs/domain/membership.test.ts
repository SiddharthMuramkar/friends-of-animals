import { describe, expect, it } from "vitest";

import { CLUB_STATUSES } from "./status";
import { affiliationAt, decideJoin, decideLeave } from "./membership";

const SCHOOL = "0193b000-0000-7000-8000-00000000000a";
const OTHER_SCHOOL = "0193b000-0000-7000-8000-00000000000b";

const none = { teacherOf: new Set<string>(), studentOf: new Set<string>() };

describe("a person's place at an institution", () => {
  it("is teacher for a coordinator or admin there", () => {
    expect(
      affiliationAt(SCHOOL, { ...none, teacherOf: new Set([SCHOOL]) })
    ).toBe("teacher");
  });

  it("is student for someone enrolled through it", () => {
    expect(
      affiliationAt(SCHOOL, { ...none, studentOf: new Set([SCHOOL]) })
    ).toBe("student");
  });

  it("is teacher when they are both", () => {
    expect(
      affiliationAt(SCHOOL, {
        teacherOf: new Set([SCHOOL]),
        studentOf: new Set([SCHOOL]),
      })
    ).toBe("teacher");
  });

  it("is nothing at another institution", () => {
    expect(
      affiliationAt(SCHOOL, {
        teacherOf: new Set([OTHER_SCHOOL]),
        studentOf: new Set([OTHER_SCHOOL]),
      })
    ).toBeNull();
    expect(affiliationAt(SCHOOL, none)).toBeNull();
  });
});

describe("joining a club", () => {
  it("is open to a student or teacher of its institution while it is approved", () => {
    for (const role of ["student", "teacher"] as const) {
      expect(
        decideJoin({ clubStatus: "approved", role, alreadyMember: false })
      ).toEqual({ ok: true });
    }
  });

  it.each(CLUB_STATUSES.filter((status) => status !== "approved"))(
    "is closed while the club is %s",
    (clubStatus) => {
      expect(
        decideJoin({ clubStatus, role: "student", alreadyMember: false })
      ).toEqual({ ok: false, error: "club_not_open" });
    }
  );

  it("is refused to someone from another institution", () => {
    expect(
      decideJoin({ clubStatus: "approved", role: null, alreadyMember: false })
    ).toEqual({ ok: false, error: "not_at_institution" });
  });

  it("is refused to a current member", () => {
    expect(
      decideJoin({
        clubStatus: "approved",
        role: "student",
        alreadyMember: true,
      })
    ).toEqual({ ok: false, error: "already_member" });
  });
});

describe("leaving a club", () => {
  it("is allowed to a current member, whatever the club's status", () => {
    expect(decideLeave({ alreadyMember: true })).toEqual({ ok: true });
  });

  it("is refused to someone who isn't a member", () => {
    expect(decideLeave({ alreadyMember: false })).toEqual({
      ok: false,
      error: "not_member",
    });
  });
});
