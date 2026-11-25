import { asc, eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  entry,
  entryTransition,
  outbox,
  schoolRound,
  schoolRoundTransition,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { globalManager, signedInWith } from "@/server/modules/judging/testing";
import { createHarness, type Harness } from "@/test/harness";

import { JUDGING_STATEMENT_VERSION } from "./domain/judging-statement";
import {
  anotherSchool,
  categoryOf,
  schoolInJudging,
  type RoundWorld,
} from "./testing";

// #89: the coordinator attests the judging and finalises. Finalising needs
// a panel of at least one, the institution's conduct certification (#87)
// and the attestation. Under all-participants scope each picked entry goes
// school_shortlisted → submitted_to_foa with the file already uploaded;
// every other entry of the institution, whatever its status, becomes
// not_shortlisted. Only finalising emits school_round.shortlist_finalised.

const PANEL = [{ fullName: "Lata Kulkarni", designation: "Art teacher" }];

/** Panel recorded, conduct certified, students 1 (1st) and 2 picked. */
async function readyRound(h: Harness, world: RoundWorld) {
  const coordinator = h.as(world.coordinator.actor);
  await coordinator.recordPanel({ ...world.ref, members: PANEL });
  const certified = await coordinator.certifyConduct(world.ref);
  if (!certified.ok) throw new Error(JSON.stringify(certified));
  const categoryId = await categoryOf(h, world, "photography");
  const saved = await coordinator.saveShortlist({
    ...world.ref,
    categoryId,
    picks: [
      { entryId: world.entryIds[1]!, position: 1 },
      { entryId: world.entryIds[2]!, position: null },
    ],
  });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  return categoryId;
}

async function statusesOf(h: Harness, ids: string[]) {
  const rows = await h.db
    .select({ id: entry.id, status: entry.status })
    .from(entry)
    .where(inArray(entry.id, ids));
  return Object.fromEntries(rows.map((row) => [row.id, row.status]));
}

async function historyOf(h: Harness, entryId: string) {
  const rows = await h.db
    .select({ to: entryTransition.toStatus })
    .from(entryTransition)
    .where(eq(entryTransition.entryId, entryId))
    .orderBy(asc(entryTransition.sequence));
  return rows.map((row) => row.to);
}

const finalisedEvents = (h: Harness) =>
  h.db
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(eq(outbox.eventType, "school_round.shortlist_finalised"));

describe("finaliseSchoolRound", () => {
  it("names every blocker and changes nothing until the round is ready", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);

    const result = await h
      .as(school.coordinator.actor)
      .finaliseSchoolRound({ ...school.ref, judgingAttested: false });

    expect(result).toEqual({
      ok: false,
      error: "finalise_blocked",
      blockers: [
        { code: "panel_missing" },
        { code: "conduct_not_certified" },
        { code: "judging_not_attested" },
      ],
    });
    const [round] = await h.db.select().from(schoolRound);
    expect(round?.status).toBe("open");
    expect(await finalisedEvents(h)).toEqual([]);
  });

  it("shortlists the picks on to FOA, marks every other entry not shortlisted and records who attested and finalised", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, {
      students: 4,
      submit: [1, 2, 3],
      rejected: [4],
    });
    await readyRound(h, school);
    const at = h.clock.now();

    const result = await h
      .as(school.coordinator.actor)
      .finaliseSchoolRound({ ...school.ref, judgingAttested: true });

    expect(result).toEqual({
      ok: true,
      finalisedAt: at,
      shortlisted: 2,
      notShortlisted: 2,
    });
    const [e1, e2, e3, e4] = [1, 2, 3, 4].map((n) => school.entryIds[n]!);
    expect(await statusesOf(h, [e1, e2, e3, e4])).toEqual({
      [e1]: "submitted_to_foa",
      [e2]: "submitted_to_foa",
      [e3]: "not_shortlisted",
      [e4]: "not_shortlisted",
    });
    expect(await historyOf(h, e1)).toEqual([
      "processing",
      "submitted",
      "school_shortlisted",
      "submitted_to_foa",
    ]);
    expect(await historyOf(h, e4)).toEqual([
      "processing",
      "rejected",
      "not_shortlisted",
    ]);
    const [round] = await h.db.select().from(schoolRound);
    expect(round).toMatchObject({
      status: "finalised",
      finalisedByUserId: school.coordinator.userId,
      finalisedAt: at,
      judgingAttestedByUserId: school.coordinator.userId,
      judgingAttestedAt: at,
      judgingStatementVersion: JUDGING_STATEMENT_VERSION,
    });
    const transitions = await h.db
      .select({
        from: schoolRoundTransition.fromStatus,
        to: schoolRoundTransition.toStatus,
        actorUserId: schoolRoundTransition.actorUserId,
      })
      .from(schoolRoundTransition)
      .orderBy(asc(schoolRoundTransition.at), asc(schoolRoundTransition.id));
    expect(transitions).toEqual([
      { from: null, to: "open", actorUserId: null },
      { from: "open", to: "finalised", actorUserId: school.coordinator.userId },
    ]);
    expect(await finalisedEvents(h)).toEqual([
      {
        payload: {
          roundId: round!.id,
          competitionId: school.competition.id,
          institutionRegistrationId: school.registrationId,
        },
      },
    ]);
    const audit = await h.db
      .select({
        action: auditLog.action,
        actorUserId: auditLog.actorUserId,
        entityId: auditLog.entityId,
      })
      .from(auditLog)
      .where(eq(auditLog.action, "school_round.finalised"));
    expect(audit).toEqual([
      {
        action: "school_round.finalised",
        actorUserId: school.coordinator.userId,
        entityId: round!.id,
      },
    ]);
    expect(
      await h.as(school.coordinator.actor).getSchoolRound(school.ref)
    ).toMatchObject({
      round: {
        status: "finalised",
        canEdit: false,
        finalised: { at, statementVersion: JUDGING_STATEMENT_VERSION },
      },
    });
  });

  it("finalises a round whose confirmed students submitted nothing", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 1, submit: [] });
    const coordinator = h.as(school.coordinator.actor);
    await coordinator.recordPanel({ ...school.ref, members: PANEL });
    await coordinator.certifyConduct(school.ref);

    expect(
      await coordinator.finaliseSchoolRound({
        ...school.ref,
        judgingAttested: true,
      })
    ).toMatchObject({ ok: true, shortlisted: 0, notShortlisted: 0 });
  });

  it("emits the event only when finalising, and keeps the round as it is afterwards", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    const categoryId = await readyRound(h, school);
    expect(await finalisedEvents(h)).toEqual([]);
    const coordinator = h.as(school.coordinator.actor);
    await coordinator.finaliseSchoolRound({
      ...school.ref,
      judgingAttested: true,
    });

    expect(
      await coordinator.finaliseSchoolRound({
        ...school.ref,
        judgingAttested: true,
      })
    ).toEqual({ ok: false, error: "round_not_editable" });
    expect(
      await coordinator.recordPanel({ ...school.ref, members: PANEL })
    ).toEqual({ ok: false, error: "round_not_editable" });
    expect(
      await coordinator.saveShortlist({ ...school.ref, categoryId, picks: [] })
    ).toEqual({ ok: false, error: "round_not_editable" });
    expect(await finalisedEvents(h)).toHaveLength(1);
  });

  it("refuses another institution's coordinator, a participant and a competition manager", async () => {
    const h = await createHarness();
    let other: Awaited<ReturnType<typeof anotherSchool>> | undefined;
    const school = await schoolInJudging(h, {
      beforeJudging: async (built) => {
        other = await anotherSchool(h, built.competition.id);
      },
    });
    await readyRound(h, school);
    const participant = await h.signIn(await h.seed.member());
    const manager = await signedInWith(h, globalManager);

    for (const actor of [other!.coordinator.actor, participant, manager]) {
      await expect(
        h
          .as(actor)
          .finaliseSchoolRound({ ...school.ref, judgingAttested: true })
      ).rejects.toThrow(DomainError);
    }
    const [round] = await h.db.select().from(schoolRound);
    expect(round?.status).toBe("open");
  });
});
