import { and, asc, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  competition,
  competitionTransitionBlock,
  entry,
  outbox,
  schoolRound,
  schoolRoundTransition,
} from "@/server/db/schema";
import { confirmedSchool } from "@/server/modules/institution-submissions/testing";
import { globalManager, signedInWith } from "@/server/modules/judging/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  emailOf,
  enterSchoolJudging,
  pastShortlistDeadline,
  readyRound,
  schoolInJudging,
  type RoundWorld,
} from "./testing";

// #90: at the shortlist deadline (the competition's school_round_closes
// key date) every round the school hasn't finished becomes overdue. It is
// never finalised automatically, and the school can still finalise it.
// The competition moves from school judging to FOA judging at the same
// instant, but only once every school round is finished: until then the
// move is refused and its managers are told, and it is made as soon as
// the last round finishes. The fake clock drives the deadline.

async function roundOf(h: Harness, world: RoundWorld) {
  const [row] = await h.db
    .select()
    .from(schoolRound)
    .where(eq(schoolRound.institutionRegistrationId, world.registrationId));
  return row!;
}

async function competitionStatus(h: Harness, competitionId: string) {
  const [row] = await h.db
    .select({ status: competition.status })
    .from(competition)
    .where(eq(competition.id, competitionId));
  return row?.status;
}

async function openBlocks(h: Harness, competitionId: string) {
  return h.db
    .select({
      to: competitionTransitionBlock.toStatus,
      reason: competitionTransitionBlock.reason,
      details: competitionTransitionBlock.details,
    })
    .from(competitionTransitionBlock)
    .where(
      and(
        eq(competitionTransitionBlock.competitionId, competitionId),
        isNull(competitionTransitionBlock.resolvedAt)
      )
    );
}

describe("the shortlist deadline", () => {
  it("makes an unfinished round overdue without finalising it, and holds the competition in school judging", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    const entriesBefore = await h.db
      .select({ id: entry.id, status: entry.status })
      .from(entry)
      .orderBy(asc(entry.id));

    await pastShortlistDeadline(h);

    const round = await roundOf(h, school);
    expect(round).toMatchObject({
      status: "overdue",
      finalisedAt: null,
      finalisedByUserId: null,
    });
    const moves = await h.db
      .select({
        from: schoolRoundTransition.fromStatus,
        to: schoolRoundTransition.toStatus,
        actorKind: schoolRoundTransition.actorKind,
      })
      .from(schoolRoundTransition)
      .where(eq(schoolRoundTransition.roundId, round.id))
      .orderBy(asc(schoolRoundTransition.at), asc(schoolRoundTransition.id));
    expect(moves.at(-1)).toEqual({
      from: "open",
      to: "overdue",
      actorKind: "system",
    });
    expect(
      await h.db
        .select({ id: entry.id, status: entry.status })
        .from(entry)
        .orderBy(asc(entry.id))
    ).toEqual(entriesBefore);
    expect(
      await h.db
        .select({ id: outbox.id })
        .from(outbox)
        .where(eq(outbox.eventType, "school_round.shortlist_finalised"))
    ).toEqual([]);

    expect(await competitionStatus(h, school.competition.id)).toBe(
      "school_judging"
    );
    expect(await openBlocks(h, school.competition.id)).toEqual([
      {
        to: "foa_judging",
        reason: "school_rounds_unfinished",
        details: { missing: 0, open: 0, overdue: 1 },
      },
    ]);
  });

  it("tells the coordinator the round is overdue, and the competition's managers why the competition waits", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    const manager = await signedInWith(h, globalManager);
    const before = h.email.sent.length;

    await pastShortlistDeadline(h);

    const sent = h.email.sent.slice(before);
    const coordinatorEmail = await emailOf(h, school.coordinator.userId);
    const toCoordinator = sent.filter((m) => m.to === coordinatorEmail);
    expect(toCoordinator.map((m) => m.subject)).toEqual([
      "Your school round for Paws on the Pavement is overdue",
    ]);
    expect(toCoordinator[0]!.text).toContain("Test School");
    expect(toCoordinator[0]!.text).toContain("still finalise");
    const managerEmail = await emailOf(h, manager.userId);
    const toManager = sent.filter((m) => m.to === managerEmail);
    expect(toManager).toHaveLength(1);
    expect(toManager[0]!.subject).toBe(
      "Paws on the Pavement can't move to FOA judging yet"
    );
    expect(toManager[0]!.text).toContain("1 school round is not finished yet");
  });

  it("leaves a finalised round alone and moves the competition on to FOA judging when every round is finished", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    await readyRound(h, school);
    await h
      .as(school.coordinator.actor)
      .finaliseSchoolRound({ ...school.ref, judgingAttested: true });
    await h.drain();

    await pastShortlistDeadline(h);

    expect((await roundOf(h, school)).status).toBe("finalised");
    expect(await competitionStatus(h, school.competition.id)).toBe(
      "foa_judging"
    );
    expect(await openBlocks(h, school.competition.id)).toEqual([]);
  });

  it("lets the school still change and finalise an overdue round, and then the competition moves on by itself", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    await pastShortlistDeadline(h);

    await readyRound(h, school);
    const result = await h
      .as(school.coordinator.actor)
      .finaliseSchoolRound({ ...school.ref, judgingAttested: true });
    expect(result).toMatchObject({ ok: true, shortlisted: 2 });
    await h.drain();

    expect((await roundOf(h, school)).status).toBe("finalised");
    expect(await competitionStatus(h, school.competition.id)).toBe(
      "foa_judging"
    );
    expect(await openBlocks(h, school.competition.id)).toEqual([]);
  });

  it("does nothing before the deadline", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    h.clock.advance({ days: 8 });
    await h.drain();

    expect((await roundOf(h, school)).status).toBe("open");
    expect(await competitionStatus(h, school.competition.id)).toBe(
      "school_judging"
    );
  });

  it("opens a round overdue when the competition reaches school judging only after the deadline", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);

    // The jobs run only once the clock is past both submissions closing
    // and the shortlist deadline.
    await enterSchoolJudging(h, school.competition.id, { days: 92 });

    const [round] = await h.db
      .select({ status: schoolRound.status })
      .from(schoolRound)
      .where(eq(schoolRound.institutionRegistrationId, school.registrationId));
    expect(round?.status).toBe("overdue");
    expect(await competitionStatus(h, school.competition.id)).toBe(
      "school_judging"
    );
    expect(await openBlocks(h, school.competition.id)).toEqual([
      {
        to: "foa_judging",
        reason: "school_rounds_unfinished",
        details: { missing: 0, open: 0, overdue: 1 },
      },
    ]);
  });
});
