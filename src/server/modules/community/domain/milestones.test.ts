import { describe, expect, it } from "vitest";

import {
  MILESTONE_KINDS,
  MilestoneScopeError,
  milestoneForCertificateType,
  milestoneIdentity,
  milestoneSourceKey,
  type MilestoneKind,
} from "./milestones";
import type { Subject } from "./subject";

const PROFILE: Subject = {
  kind: "profile",
  profileId: "0190a000-0000-7000-8000-000000000001",
};
const USER: Subject = {
  kind: "user",
  userId: "0190a000-0000-7000-8000-000000000002",
};
const COMPETITION = "0190a000-0000-7000-8000-0000000000c1";

describe("engagement ladder", () => {
  it("declares every rung up front, in ladder order", () => {
    expect([...MILESTONE_KINDS]).toEqual([
      "participant",
      "school_winner",
      "foa_finalist",
      "community_member",
      "volunteer",
      "ambassador",
    ]);
  });
});

describe("milestoneIdentity", () => {
  it.each<MilestoneKind>(["participant", "school_winner", "foa_finalist"])(
    "records %s once per competition",
    (kind) => {
      expect(
        milestoneIdentity({
          subject: PROFILE,
          kind,
          competitionId: COMPETITION,
        })
      ).toEqual({ subject: PROFILE, kind, competitionId: COMPETITION });
      expect(() =>
        milestoneIdentity({ subject: PROFILE, kind, competitionId: null })
      ).toThrow(MilestoneScopeError);
    }
  );

  it.each<MilestoneKind>(["community_member", "volunteer", "ambassador"])(
    "records %s once per person, with no competition",
    (kind) => {
      expect(
        milestoneIdentity({ subject: USER, kind, competitionId: null })
      ).toEqual({ subject: USER, kind, competitionId: null });
      expect(() =>
        milestoneIdentity({ subject: USER, kind, competitionId: COMPETITION })
      ).toThrow(MilestoneScopeError);
    }
  );
});

describe("milestoneSourceKey", () => {
  it("names the milestone, not the event that produced it", () => {
    // The live consumer and the backfill both reach this milestone; one key
    // means one timeline entry however often either runs.
    const fromConsumer = milestoneSourceKey({
      subject: PROFILE,
      kind: "school_winner",
      competitionId: COMPETITION,
    });
    const fromBackfill = milestoneSourceKey({
      subject: { ...PROFILE },
      kind: "school_winner",
      competitionId: COMPETITION,
    });
    expect(fromConsumer).toBe(fromBackfill);
    expect(fromConsumer).toBe(
      "milestone:school_winner:profile:0190a000-0000-7000-8000-000000000001:0190a000-0000-7000-8000-0000000000c1"
    );
  });

  it("keeps people, kinds and competitions apart", () => {
    const keys = [
      milestoneSourceKey({
        subject: PROFILE,
        kind: "participant",
        competitionId: COMPETITION,
      }),
      milestoneSourceKey({
        subject: PROFILE,
        kind: "foa_finalist",
        competitionId: COMPETITION,
      }),
      milestoneSourceKey({
        subject: PROFILE,
        kind: "participant",
        competitionId: "0190a000-0000-7000-8000-0000000000c2",
      }),
      milestoneSourceKey({
        subject: USER,
        kind: "community_member",
        competitionId: null,
      }),
      milestoneSourceKey({
        subject: {
          kind: "profile",
          profileId: "0190a000-0000-7000-8000-000000000002",
        },
        kind: "community_member",
        competitionId: null,
      }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[3]).toBe(
      "milestone:community_member:user:0190a000-0000-7000-8000-000000000002:-"
    );
  });

  it("refuses an identity whose scope is wrong", () => {
    expect(() =>
      milestoneSourceKey({
        subject: PROFILE,
        kind: "participant",
        competitionId: null,
      })
    ).toThrow(MilestoneScopeError);
  });
});

describe("milestoneForCertificateType", () => {
  it.each([
    ["participation", "participant"],
    ["school_merit", "school_winner"],
    ["finalist", "foa_finalist"],
    ["runner_up", "foa_finalist"],
    ["winner", "foa_finalist"],
  ] as const)("a %s certificate is the %s rung", (type, kind) => {
    expect(milestoneForCertificateType(type)).toBe(kind);
  });

  it.each(["volunteer_service", "special_mention", ""])(
    "a %j certificate is no results rung",
    (type) => {
      expect(milestoneForCertificateType(type)).toBeNull();
    }
  );
});
