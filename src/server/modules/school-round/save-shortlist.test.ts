import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { globalManager, signedInWith } from "@/server/modules/judging/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  anotherSchool,
  categoryOf,
  schoolInJudging,
  setShortlistLimits,
  type RoundWorld,
} from "./testing";

// #89: the coordinator picks a category's shortlist in one save: up to the
// competition's shortlist size (5 by default) of its `submitted` entries,
// each with an optional school position up to the competition's number of
// positions (3 by default). A save with any problem changes nothing and
// names every problem.

async function picksIn(h: Harness, world: RoundWorld, categoryId: string) {
  const view = await h.as(world.coordinator.actor).getSchoolRound(world.ref);
  if (!view.ok) throw new Error(view.error);
  return view.round.categories
    .find((category) => category.id === categoryId)!
    .entries.filter((each) => each.picked)
    .map(({ entryId, position }) => ({ entryId, position }));
}

describe("saveShortlist", () => {
  it("saves a category's picks with their positions, and saving again replaces them", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 3, submit: [1, 2, 3] });
    const categoryId = await categoryOf(h, school, "photography");
    const coordinator = h.as(school.coordinator.actor);
    const [e1, e2, e3] = [1, 2, 3].map((n) => school.entryIds[n]!);

    expect(
      await coordinator.saveShortlist({
        ...school.ref,
        categoryId,
        picks: [
          { entryId: e1, position: 1 },
          { entryId: e2, position: null },
        ],
      })
    ).toEqual({ ok: true });
    expect(await picksIn(h, school, categoryId)).toEqual([
      { entryId: e1, position: 1 },
      { entryId: e2, position: null },
    ]);

    await coordinator.saveShortlist({
      ...school.ref,
      categoryId,
      picks: [
        { entryId: e3, position: 1 },
        { entryId: e1, position: 2 },
      ],
    });
    expect(await picksIn(h, school, categoryId)).toEqual([
      { entryId: e1, position: 2 },
      { entryId: e3, position: 1 },
    ]);
  });

  it("refuses more picks than the shortlist size", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 3, submit: [1, 2, 3] });
    await setShortlistLimits(h, school.competition.id, { shortlistSize: 2 });
    const categoryId = await categoryOf(h, school, "photography");

    const result = await h.as(school.coordinator.actor).saveShortlist({
      ...school.ref,
      categoryId,
      picks: [1, 2, 3].map((n) => ({
        entryId: school.entryIds[n]!,
        position: null,
      })),
    });

    expect(result).toEqual({
      ok: false,
      error: "shortlist_invalid",
      problems: [{ code: "shortlist_full", limit: 2, count: 3 }],
    });
    expect(await picksIn(h, school, categoryId)).toEqual([]);
  });

  it("names every entry it can't pick and changes nothing", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, {
      students: 3,
      submit: [1, 2],
      rejected: [3],
      disciplines: { 2: "drawing" },
    });
    const categoryId = await categoryOf(h, school, "photography");
    const coordinator = h.as(school.coordinator.actor);
    await coordinator.saveShortlist({
      ...school.ref,
      categoryId,
      picks: [{ entryId: school.entryIds[1]!, position: 1 }],
    });
    const stranger = "01938a00-0000-7000-8000-00000000dead";

    const result = await coordinator.saveShortlist({
      ...school.ref,
      categoryId,
      picks: [
        { entryId: school.entryIds[3]!, position: null },
        { entryId: school.entryIds[2]!, position: null },
        { entryId: stranger, position: null },
        { entryId: school.entryIds[1]!, position: null },
        { entryId: school.entryIds[1]!, position: null },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: "shortlist_invalid",
      problems: [
        { code: "not_submitted", entryId: school.entryIds[3] },
        { code: "wrong_category", entryId: school.entryIds[2] },
        { code: "unknown_entry", entryId: stranger },
        { code: "duplicate_entry", entryId: school.entryIds[1] },
      ],
    });
    expect(await picksIn(h, school, categoryId)).toEqual([
      { entryId: school.entryIds[1], position: 1 },
    ]);
  });

  it("refuses a position beyond the competition's number or one already taken", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 3, submit: [1, 2, 3] });
    const categoryId = await categoryOf(h, school, "photography");
    const coordinator = h.as(school.coordinator.actor);
    const [e1, e2, e3] = [1, 2, 3].map((n) => school.entryIds[n]!);

    expect(
      await coordinator.saveShortlist({
        ...school.ref,
        categoryId,
        picks: [
          { entryId: e1, position: 4 },
          { entryId: e2, position: 1 },
          { entryId: e3, position: 1 },
        ],
      })
    ).toEqual({
      ok: false,
      error: "shortlist_invalid",
      problems: [
        { code: "position_out_of_range", entryId: e1, position: 4, limit: 3 },
        { code: "position_taken", entryId: e3, position: 1 },
      ],
    });

    await setShortlistLimits(h, school.competition.id, { positions: 2 });
    expect(
      await coordinator.saveShortlist({
        ...school.ref,
        categoryId,
        picks: [{ entryId: e1, position: 3 }],
      })
    ).toMatchObject({
      ok: false,
      problems: [{ code: "position_out_of_range", position: 3, limit: 2 }],
    });
    expect(await picksIn(h, school, categoryId)).toEqual([]);
  });

  it("answers unknown_category for a category with none of the round's entries", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 1, submit: [1] });

    expect(
      await h.as(school.coordinator.actor).saveShortlist({
        ...school.ref,
        categoryId: "01938a00-0000-7000-8000-00000000beef",
        picks: [],
      })
    ).toEqual({ ok: false, error: "unknown_category" });
  });

  it("refuses another institution's coordinator, a participant and a competition manager", async () => {
    const h = await createHarness();
    let other: Awaited<ReturnType<typeof anotherSchool>> | undefined;
    const school = await schoolInJudging(h, {
      beforeJudging: async (built) => {
        other = await anotherSchool(h, built.competition.id);
      },
    });
    const categoryId = await categoryOf(h, school, "photography");
    const participant = await h.signIn(await h.seed.member());
    const manager = await signedInWith(h, globalManager);
    const input = {
      ...school.ref,
      categoryId,
      picks: [{ entryId: school.entryIds[1]!, position: 1 }],
    };

    for (const actor of [other!.coordinator.actor, participant, manager]) {
      await expect(h.as(actor).saveShortlist(input)).rejects.toThrow(
        DomainError
      );
    }
    expect(await picksIn(h, school, categoryId)).toEqual([]);
  });
});
