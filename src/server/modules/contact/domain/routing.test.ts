import { describe, expect, it } from "vitest";

import {
  CONTACT_TEAMS,
  CONTACT_TOPICS,
  DEFAULT_CONTACT_ROUTING,
  inboxAccess,
  mayHandle,
  teamForTopic,
} from "./routing";

const global = { type: "global" } as const;

describe("contact topics and routing", () => {
  it("has the seven topics the contact page lists, in its order", () => {
    expect(CONTACT_TOPICS).toEqual([
      "GENERAL",
      "SCHOOLS",
      "NGOS",
      "ADOPTION",
      "VOLUNTEERING",
      "DONATIONS",
      "MEDIA",
    ]);
  });

  it("routes every topic to a team", () => {
    for (const topic of CONTACT_TOPICS) {
      expect(CONTACT_TEAMS).toContain(teamForTopic(topic));
    }
    expect(Object.keys(DEFAULT_CONTACT_ROUTING).sort()).toEqual(
      [...CONTACT_TOPICS].sort()
    );
  });

  it("uses FOA's default teams until FOA confirms them", () => {
    expect(DEFAULT_CONTACT_ROUTING).toEqual({
      GENERAL: "staff_admin",
      SCHOOLS: "competition_manager",
      NGOS: "community_manager",
      ADOPTION: "adoption_coordinator",
      VOLUNTEERING: "community_manager",
      DONATIONS: "finance",
      MEDIA: "content_manager",
    });
  });

  it("follows another routing when given one", () => {
    expect(
      teamForTopic("MEDIA", { ...DEFAULT_CONTACT_ROUTING, MEDIA: "finance" })
    ).toBe("finance");
  });

  it("only routes to staff, never to a member-facing role", () => {
    for (const team of CONTACT_TEAMS) {
      expect(["member", "participant", "guardian", "judge"]).not.toContain(
        team
      );
    }
  });
});

describe("who sees which contact messages", () => {
  it("shows staff admins and super admins every team", () => {
    expect(inboxAccess([{ role: "staff_admin", scope: global }])).toEqual({
      kind: "all",
    });
    expect(inboxAccess([{ role: "super_admin", scope: global }])).toEqual({
      kind: "all",
    });
  });

  it("shows a team member only their teams", () => {
    const access = inboxAccess([
      { role: "member", scope: global },
      { role: "finance", scope: global },
      { role: "content_manager", scope: global },
    ]);
    expect(access).toEqual({
      kind: "teams",
      teams: ["finance", "content_manager"],
    });
    expect(mayHandle(access, "finance")).toBe(true);
    expect(mayHandle(access, "community_manager")).toBe(false);
  });

  it("counts only global grants", () => {
    const scoped = {
      role: "adoption_coordinator",
      scope: {
        type: "organisation",
        id: "0194c5a0-0000-7000-8000-00000000000a",
      },
    };
    const scopedAdmin = {
      role: "staff_admin",
      scope: {
        type: "institution",
        id: "0194c5a0-0000-7000-8000-00000000000b",
      },
    };
    expect(inboxAccess([scoped])).toEqual({ kind: "none" });
    expect(inboxAccess([scopedAdmin])).toEqual({ kind: "none" });
  });

  it("lists each team once", () => {
    expect(
      inboxAccess([
        { role: "finance", scope: global },
        { role: "finance", scope: global },
      ])
    ).toEqual({ kind: "teams", teams: ["finance"] });
  });

  it("shows members and people without roles nothing", () => {
    const none = inboxAccess([{ role: "member", scope: global }]);
    expect(none).toEqual({ kind: "none" });
    expect(inboxAccess([])).toEqual({ kind: "none" });
    for (const team of CONTACT_TEAMS) expect(mayHandle(none, team)).toBe(false);
  });

  it("lets everyone with all access handle any team", () => {
    for (const team of CONTACT_TEAMS) {
      expect(mayHandle({ kind: "all" }, team)).toBe(true);
    }
  });
});
