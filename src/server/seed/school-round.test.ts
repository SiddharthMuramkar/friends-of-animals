import { describe, expect, it } from "vitest";

import {
  schoolRound,
  schoolRoundPanelMember,
  schoolRoundPick,
} from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_COORDINATORS } from "./coordinators";
import { SEED_INSTITUTIONS } from "./institutions";
import { SEED_OBJECTIVES } from "./objectives";
import { SEED_SCHOOL_ROUND } from "./school-round";

const ROUND = {
  institutionId: SEED_INSTITUTIONS.verified.id,
  reference: SEED_SCHOOL_ROUND.reference,
};

describe("the school round seed", () => {
  it("shows the seeded coordinator Kinder Skies' open round with a panel of two and picks with positions", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const coordinator = h.as(await h.signIn(SEED_COORDINATORS.coordinator));

    const competition = await h
      .as(h.visitor())
      .getPublishedCompetition({ slug: "kinder-skies" });
    expect(
      competition!.keyDates
        .find((date) => date.kind === "school_round_closes")!
        .at.getTime()
    ).toBeGreaterThan(h.clock.now().getTime());
    const view = await coordinator.getSchoolRound(ROUND);

    expect(view).toMatchObject({
      ok: true,
      round: {
        status: "open",
        competition: { code: "SKIES26", status: "school_judging" },
        panel: SEED_SCHOOL_ROUND.panel,
        conductCertified: false,
        blockers: [{ code: "conduct_not_certified" }],
        canEdit: true,
        entryCount: 3,
      },
    });
    if (!view.ok) return;
    const entries = view.round.categories.flatMap((category) =>
      category.entries.map(({ code, status, picked, position }) => ({
        code,
        status,
        picked,
        position,
      }))
    );
    expect(entries.toSorted((a, b) => a.code.localeCompare(b.code))).toEqual([
      {
        code: "SKIES26-E-5EEDS1",
        status: "submitted",
        picked: true,
        position: 1,
      },
      {
        code: "SKIES26-E-5EEDS2",
        status: "submitted",
        picked: true,
        position: null,
      },
      {
        code: "SKIES26-E-5EEDS3",
        status: "submitted",
        picked: false,
        position: null,
      },
    ]);
  });

  it("changes nothing when it runs again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const rows = async () => ({
      rounds: await h.db.select().from(schoolRound).orderBy(schoolRound.id),
      panel: await h.db
        .select()
        .from(schoolRoundPanelMember)
        .orderBy(schoolRoundPanelMember.id),
      picks: await h.db
        .select()
        .from(schoolRoundPick)
        .orderBy(schoolRoundPick.entryId),
    });
    const first = await rows();

    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await rows()).toEqual(first);
    expect(first.rounds).toHaveLength(3);
    expect(first.picks).toHaveLength(3);
    const objectiveRound = first.rounds.find(
      (row) => row.competitionId === SEED_OBJECTIVES.competitionId
    );
    expect(objectiveRound).toMatchObject({ status: "finalised" });
    expect(
      first.picks.find((row) => row.roundId === objectiveRound!.id)
    ).toMatchObject({ position: 1 });
  });
});
