import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { managerOf, seedCompetition, signedInWith } from "./testing";

describe("FOA judging rounds", () => {
  it("creates, opens and cancels a round, pinning the published rubric", async () => {
    const h = await createHarness();
    const competition = await seedCompetition(h, { disciplines: ["drawing"] });
    const manager = await signedInWith(h, managerOf(competition.id));
    const as = h.as(manager);
    const input = { competitionId: competition.id, name: "National final" };
    expect(await as.createJudgingRound(input)).toMatchObject({
      ok: false,
      error: "rubric_missing",
      missing: ["drawing"],
    });
    const draft = await as.createRubricDraft({
      competitionId: competition.id,
      discipline: "drawing",
    });
    if (!draft.ok) throw new Error(draft.error);
    expect(await as.publishRubric({ rubricId: draft.rubric.id })).toMatchObject(
      { ok: true }
    );
    const made = await as.createJudgingRound(input);
    if (!made.ok) throw new Error(made.error);
    const roundId = made.roundId;
    expect(await as.getJudgingRound({ roundId })).toMatchObject({
      ok: true,
      round: {
        status: "draft",
        level: "national",
        judgesPhysical: true,
        awardScheme: "ranked_123",
      },
      pins: [{ rubricId: draft.rubric.id }],
    });
    expect(
      await as.createJudgingRound({ ...input, name: "national  final" })
    ).toMatchObject({ ok: false, error: "name_taken" });
    expect(
      await as.updateJudgingRound({
        roundId,
        name: "National round",
        level: "state",
        judgesPhysical: false,
      })
    ).toMatchObject({ ok: true });
    const revision = await as.startRubricRevision({
      rubricId: draft.rubric.id,
    });
    if (!revision.ok) throw new Error(revision.error);
    expect(
      await as.publishRubric({ rubricId: revision.rubric.id })
    ).toMatchObject({ ok: true });
    expect(await as.openJudgingRound({ roundId })).toMatchObject({ ok: true });
    expect(await as.getJudgingRound({ roundId })).toMatchObject({
      ok: true,
      pins: [{ rubricId: revision.rubric.id }],
    });
    const later = await as.startRubricRevision({
      rubricId: revision.rubric.id,
    });
    if (!later.ok) throw new Error(later.error);
    expect(await as.publishRubric({ rubricId: later.rubric.id })).toMatchObject(
      { ok: true }
    );
    expect(await as.getJudgingRound({ roundId })).toMatchObject({
      ok: true,
      pins: [{ rubricId: revision.rubric.id }],
    });
    expect(await as.openJudgingRound({ roundId })).toMatchObject({
      ok: false,
      error: "round_transition_not_allowed",
    });
    expect(
      await as.updateJudgingRound({ roundId, name: "Renamed" })
    ).toMatchObject({ ok: false, error: "round_not_editable" });
    expect(
      await as.listJudgingRounds({ competitionId: competition.id })
    ).toMatchObject({ ok: true, rounds: [{ id: roundId, status: "open" }] });
    expect(
      await as.cancelJudgingRound({ roundId, reason: "No longer running" })
    ).toMatchObject({ ok: true });
    expect(
      await as.cancelJudgingRound({ roundId, reason: "Again" })
    ).toMatchObject({ ok: false, error: "round_transition_not_allowed" });
    const member = h.as(await signedInWith(h));
    for (const call of [
      () => member.createJudgingRound(input),
      () => member.getJudgingRound({ roundId }),
      () => member.listJudgingRounds({ competitionId: competition.id }),
      () => member.updateJudgingRound({ roundId, name: "No" }),
      () => member.openJudgingRound({ roundId }),
      () => member.cancelJudgingRound({ roundId, reason: "No" }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});
