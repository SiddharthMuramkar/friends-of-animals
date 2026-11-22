import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { completeFields, signInManager, signInWith } from "./testing";

describe("listCompetitionsForAdmin", () => {
  it("lists every competition for a global manager, the latest change first", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const first = await h.as(manager).createCompetition(completeFields());
    h.clock.advance({ minutes: 5 });
    const second = await h
      .as(manager)
      .createCompetition({ code: "WATER27", name: "A Bowl of Water" });
    if (!first.ok || !second.ok) throw new Error("not created");
    h.clock.advance({ minutes: 5 });
    await h
      .as(manager)
      .publishCompetition({ competitionId: first.competition.id });

    expect(await h.as(manager).listCompetitionsForAdmin()).toEqual([
      {
        id: first.competition.id,
        code: "NEIGH27",
        slug: "neighbours-on-my-street",
        name: "Neighbours on My Street",
        status: "published",
        publishedAt: h.clock.now(),
        updatedAt: h.clock.now(),
      },
      {
        id: second.competition.id,
        code: "WATER27",
        slug: "a-bowl-of-water",
        name: "A Bowl of Water",
        status: "draft",
        publishedAt: null,
        updatedAt: new Date(h.clock.now().getTime() - 5 * 60 * 1000),
      },
    ]);
  });

  it("lists only the competitions a scoped manager's grants cover", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const mine = await h.as(manager).createCompetition(completeFields());
    await h
      .as(manager)
      .createCompetition({ code: "WATER27", name: "A Bowl of Water" });
    if (!mine.ok) throw new Error(mine.error);
    const scoped = await signInManager(h, {
      type: "competition",
      id: mine.competition.id,
    });

    expect(
      (await h.as(scoped).listCompetitionsForAdmin()).map((c) => c.code)
    ).toEqual(["NEIGH27"]);
  });

  it.each([
    ["a content manager", "content_manager"],
    ["a super admin", "super_admin"],
    ["a member", null],
    ["a visitor", "visitor"],
  ] as const)("refuses %s", async (_who, kind) => {
    const h = await createHarness();
    const actor = kind === "visitor" ? h.visitor() : await signInWith(h, kind);

    await expect(h.as(actor).listCompetitionsForAdmin()).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
