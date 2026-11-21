import { describe, expect, it } from "vitest";

import { planBackfill, tallyInvitations } from "./backfill";
import { INVITATION_TRIGGERS, invitationKey } from "./triggers";

describe("invitationKey", () => {
  it("makes one key per participant per competition for results", () => {
    expect(
      invitationKey({
        trigger: "results_published",
        profileId: "profile-1",
        competitionId: "competition-a",
      })
    ).toBe("results_published:competition-a:profile-1");
  });

  it("makes one key per person for the backfill, whichever competition it names", () => {
    const key = (competitionId: string) =>
      invitationKey({
        trigger: "pilot_backfill",
        profileId: "profile-1",
        competitionId,
      });
    expect(key("competition-a")).toBe("pilot_backfill:profile-1");
    expect(key("competition-b")).toBe(key("competition-a"));
  });

  it("lists the two triggers", () => {
    expect(INVITATION_TRIGGERS).toEqual([
      "results_published",
      "pilot_backfill",
    ]);
  });
});

describe("planBackfill", () => {
  const jan = new Date("2026-01-20T06:30:00.000Z");
  const mar = new Date("2026-03-10T06:30:00.000Z");

  it("invites each person once, naming the latest competition they took part in", () => {
    expect(
      planBackfill(
        [
          { profileId: "p1", competitionId: "c-jan", publishedAt: jan },
          { profileId: "p1", competitionId: "c-mar", publishedAt: mar },
          { profileId: "p1", competitionId: "c-mar", publishedAt: mar },
          { profileId: "p2", competitionId: "c-jan", publishedAt: jan },
        ],
        new Set()
      )
    ).toEqual({
      invite: [
        { profileId: "p1", competitionId: "c-mar" },
        { profileId: "p2", competitionId: "c-jan" },
      ],
      counts: { people: 2, alreadyInvited: 0 },
    });
  });

  it("leaves out anyone already invited, by results or an earlier backfill", () => {
    expect(
      planBackfill(
        [
          { profileId: "p1", competitionId: "c-jan", publishedAt: jan },
          { profileId: "p2", competitionId: "c-jan", publishedAt: jan },
          { profileId: "p3", competitionId: "c-mar", publishedAt: mar },
        ],
        new Set(["p1", "p3"])
      )
    ).toEqual({
      invite: [{ profileId: "p2", competitionId: "c-jan" }],
      counts: { people: 3, alreadyInvited: 2 },
    });
  });

  it("plans nothing on a second run once everyone is invited", () => {
    expect(
      planBackfill(
        [{ profileId: "p1", competitionId: "c-jan", publishedAt: jan }],
        new Set(["p1"])
      )
    ).toEqual({ invite: [], counts: { people: 1, alreadyInvited: 1 } });
  });

  it("breaks a tie between competitions published at the same instant by id", () => {
    expect(
      planBackfill(
        [
          { profileId: "p1", competitionId: "c-b", publishedAt: jan },
          { profileId: "p1", competitionId: "c-a", publishedAt: jan },
        ],
        new Set()
      ).invite
    ).toEqual([{ profileId: "p1", competitionId: "c-b" }]);
  });

  it("lists invitations by profile id, whatever order the candidates came in", () => {
    expect(
      planBackfill(
        [
          { profileId: "p3", competitionId: "c-jan", publishedAt: jan },
          { profileId: "p1", competitionId: "c-jan", publishedAt: jan },
          { profileId: "p2", competitionId: "c-jan", publishedAt: jan },
        ],
        new Set()
      ).invite.map((invite) => invite.profileId)
    ).toEqual(["p1", "p2", "p3"]);
  });
});

describe("tallyInvitations", () => {
  it("counts what happened to each planned person, with ids and numbers only", () => {
    expect(
      tallyInvitations(
        [
          { ok: true },
          { ok: true },
          { ok: false, reason: "no_consent" },
          { ok: false, reason: "no_consent" },
          { ok: false, reason: "no_guardian" },
          { ok: false, reason: "no_login" },
          { ok: false, reason: "already_invited" },
        ],
        { alreadyInvited: 4 }
      )
    ).toEqual({
      invited: 2,
      alreadyInvited: 5,
      skipped: { noConsent: 2, noGuardian: 1, noLogin: 1 },
    });
  });

  it("counts an empty run as zeros", () => {
    expect(tallyInvitations([], { alreadyInvited: 0 })).toEqual({
      invited: 0,
      alreadyInvited: 0,
      skipped: { noConsent: 0, noGuardian: 0, noLogin: 0 },
    });
  });
});
