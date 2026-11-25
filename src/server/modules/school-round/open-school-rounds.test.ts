import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { schoolRound, schoolRoundTransition } from "@/server/db/schema";
import { emit } from "@/server/outbox/emit";
import { createHarness } from "@/test/harness";

import { anotherSchool, schoolInJudging } from "./testing";

// #89: when a competition enters school judging, every confirmed
// institution registration (one with at least one confirmed student) gets
// one open school round, even one whose students submitted nothing.

describe("opening school rounds", () => {
  it("opens one round per confirmed institution registration when the competition enters school judging", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 2, submit: [1] });

    const view = await h
      .as(school.coordinator.actor)
      .getSchoolRound(school.ref);

    expect(view).toMatchObject({
      ok: true,
      round: {
        status: "open",
        reference: school.reference,
        competition: { code: "PAWS27", status: "school_judging" },
        limits: { shortlistSize: 5, positions: 3 },
        panel: [],
        canEdit: true,
        finalised: null,
      },
    });
    const transitions = await h.db
      .select({
        from: schoolRoundTransition.fromStatus,
        to: schoolRoundTransition.toStatus,
        actorKind: schoolRoundTransition.actorKind,
        actorUserId: schoolRoundTransition.actorUserId,
      })
      .from(schoolRoundTransition);
    expect(transitions).toEqual([
      { from: null, to: "open", actorKind: "system", actorUserId: null },
    ]);
  });

  it("opens a round for a school whose confirmed students submitted nothing", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 1, submit: [] });

    const view = await h
      .as(school.coordinator.actor)
      .getSchoolRound(school.ref);

    expect(view).toMatchObject({
      ok: true,
      round: { status: "open", categories: [] },
    });
  });

  it("opens no round for an institution registration with no confirmed student", async () => {
    const h = await createHarness();
    let other: Awaited<ReturnType<typeof anotherSchool>> | undefined;
    const school = await schoolInJudging(h, {
      students: 1,
      submit: [],
      beforeJudging: async (built) => {
        other = await anotherSchool(h, built.competition.id);
      },
    });

    const rounds = await h.db
      .select({ registrationId: schoolRound.institutionRegistrationId })
      .from(schoolRound);
    expect(rounds).toEqual([{ registrationId: school.registrationId }]);
    expect(
      await h.as(other!.coordinator.actor).getSchoolRound(other!.ref)
    ).toEqual({ ok: false, error: "not_open" });
  });

  it("adds nothing when the event is delivered again", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 1, submit: [1] });

    await h.db.transaction((tx) =>
      emit(tx, h.clock, {
        type: "competition.school_judging_started",
        aggregate: { type: "competition", id: school.competition.id },
        payload: { competitionId: school.competition.id },
      })
    );
    await h.drain();

    const rounds = await h.db
      .select({ id: schoolRound.id })
      .from(schoolRound)
      .where(eq(schoolRound.competitionId, school.competition.id));
    expect(rounds).toHaveLength(1);
    expect(await h.db.select().from(schoolRoundTransition)).toHaveLength(1);
  });
});
