import { describe, expect, it } from "vitest";

import {
  ACTION_TARGETS,
  decideTakeAction,
  INVITATION_ACTIONS,
  offeredActions,
  type InvitationAction,
} from "./actions";

const RULES = { volunteerMinAgeYears: 14 };

describe("offeredActions", () => {
  it("offers an adult at a verified institution every action, in page order", () => {
    expect(
      offeredActions(
        { ageYears: 21, studiesAtVerifiedInstitution: true },
        RULES
      )
    ).toEqual([
      "join_community",
      "volunteer",
      "start_club",
      "join_campaigns",
      "attend_events",
    ]);
  });

  it("hides starting a club unless the person studies at a verified institution", () => {
    expect(
      offeredActions(
        { ageYears: 21, studiesAtVerifiedInstitution: false },
        RULES
      )
    ).toEqual([
      "join_community",
      "volunteer",
      "join_campaigns",
      "attend_events",
    ]);
  });

  it("hides volunteering below the volunteer minimum age, and offers it from that birthday", () => {
    const at = (ageYears: number) =>
      offeredActions({ ageYears, studiesAtVerifiedInstitution: false }, RULES);
    expect(at(13)).not.toContain("volunteer");
    expect(at(14)).toContain("volunteer");
  });

  it("follows the volunteer minimum age setting", () => {
    expect(
      offeredActions(
        { ageYears: 15, studiesAtVerifiedInstitution: false },
        { volunteerMinAgeYears: 16 }
      )
    ).not.toContain("volunteer");
  });

  it("hides starting a club for a child under 13, who has no login to apply with", () => {
    expect(
      offeredActions(
        { ageYears: 12, studiesAtVerifiedInstitution: true },
        RULES
      )
    ).toEqual(["join_community", "join_campaigns", "attend_events"]);
    expect(
      offeredActions(
        { ageYears: 13, studiesAtVerifiedInstitution: true },
        RULES
      )
    ).toContain("start_club");
  });

  it("offers only the actions open to everyone when the age is unknown", () => {
    expect(
      offeredActions(
        { ageYears: null, studiesAtVerifiedInstitution: true },
        RULES
      )
    ).toEqual(["join_community", "join_campaigns", "attend_events"]);
  });
});

describe("ACTION_TARGETS", () => {
  it("sends each action to the page where it continues", () => {
    expect(ACTION_TARGETS).toEqual({
      join_community: "/dashboard/community",
      volunteer: "/volunteer",
      start_club: "/clubs/apply",
      join_campaigns: "/events",
      attend_events: "/events",
    });
  });

  it("has a target for every action and nothing else", () => {
    expect(Object.keys(ACTION_TARGETS).toSorted()).toEqual(
      [...INVITATION_ACTIONS].toSorted()
    );
  });
});

describe("decideTakeAction", () => {
  const offered: readonly InvitationAction[] = [
    "join_community",
    "join_campaigns",
    "attend_events",
  ];

  it("records an offered action the first time", () => {
    expect(
      decideTakeAction({ offered, taken: [], action: "attend_events" })
    ).toEqual({ kind: "record", firstAction: true });
  });

  it("records a second, different action without counting it as the first", () => {
    expect(
      decideTakeAction({
        offered,
        taken: ["attend_events"],
        action: "join_campaigns",
      })
    ).toEqual({ kind: "record", firstAction: false });
  });

  it("changes nothing when the action was already taken", () => {
    expect(
      decideTakeAction({
        offered,
        taken: ["attend_events"],
        action: "attend_events",
      })
    ).toEqual({ kind: "unchanged" });
  });

  it("refuses an action this invitation does not offer", () => {
    expect(
      decideTakeAction({ offered, taken: [], action: "volunteer" })
    ).toEqual({ kind: "reject", code: "action_not_offered" });
  });
});
