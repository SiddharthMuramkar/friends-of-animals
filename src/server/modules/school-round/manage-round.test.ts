import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, entry } from "@/server/db/schema";
import { managerOf, signedInWith } from "@/server/modules/judging/testing";
import { createHarness } from "@/test/harness";

import { pastShortlistDeadline, readyRound, schoolInJudging } from "./testing";

describe("manager corrections to school rounds", () => {
  it("closes an overdue round with a reason and applies its saved shortlist", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    await readyRound(h, school);
    const view = await h
      .as(school.coordinator.actor)
      .getSchoolRound(school.ref);
    if (!view.ok) throw new Error(view.error);
    const ref = {
      competitionId: school.competition.id,
      roundId: view.round.id,
    };
    const manager = h.as(await signedInWith(h, managerOf(ref.competitionId)));
    await expect(
      h.as(school.coordinator.actor).closeSchoolRoundOnBehalf({
        ...ref,
        reason: "School asked for assistance",
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await manager.closeSchoolRoundOnBehalf({
        ...ref,
        reason: "School asked for assistance",
      })
    ).toMatchObject({ ok: false, error: "round_not_overdue" });
    await pastShortlistDeadline(h);
    expect(
      await manager.closeSchoolRoundOnBehalf({ ...ref, reason: "   " })
    ).toMatchObject({ ok: false, error: "invalid_input" });
    expect(
      await manager.closeSchoolRoundOnBehalf({
        ...ref,
        reason: "School asked for assistance",
      })
    ).toMatchObject({ ok: true, shortlisted: 2 });
    await h.drain();
    expect(
      await h.as(school.coordinator.actor).getSchoolRound(school.ref)
    ).toMatchObject({
      ok: true,
      round: {
        status: "closed_on_behalf",
        canEdit: false,
        closed: { reason: "School asked for assistance" },
      },
    });
    const [audit] = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "school_round.closed_on_behalf"));
    expect(audit?.after).toMatchObject({
      reason: "School asked for assistance",
    });
  });

  it("reopens a finalised round before verification, returning entries to their previous statuses", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 3, submit: [1, 2, 3] });
    await readyRound(h, school);
    const coordinator = h.as(school.coordinator.actor);
    const view = await coordinator.getSchoolRound(school.ref);
    if (!view.ok) throw new Error(view.error);
    const ref = {
      competitionId: school.competition.id,
      roundId: view.round.id,
    };
    const manager = h.as(await signedInWith(h, managerOf(ref.competitionId)));
    await coordinator.finaliseSchoolRound({
      ...school.ref,
      judgingAttested: true,
    });
    await h.drain();
    await expect(coordinator.reopenSchoolRound(ref)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await manager.reopenSchoolRound(ref)).toMatchObject({
      ok: true,
      status: "open",
    });
    expect(
      await coordinator.listSchoolRoundOutcomes({
        institutionRegistrationId: school.registrationId,
      })
    ).toMatchObject({
      ok: true,
      roundStatus: "open",
      outcomes: Array.from({ length: 3 }, () => ({
        outcome: "pending",
        position: null,
      })),
    });
    expect(await coordinator.getSchoolRound(school.ref)).toMatchObject({
      ok: true,
      round: { canEdit: true, finalised: null },
    });
    const rows = await h.db.select({ status: entry.status }).from(entry);
    expect(rows.map((r) => r.status)).toEqual([
      "submitted",
      "submitted",
      "submitted",
    ]);
    await coordinator.finaliseSchoolRound({
      ...school.ref,
      judgingAttested: true,
    });
    await h.db
      .update(entry)
      .set({ status: "foa_verified" })
      .where(eq(entry.id, school.entryIds[1]!));
    expect(await manager.reopenSchoolRound(ref)).toMatchObject({
      ok: false,
      error: "reopen_blocked",
      blockers: [{ code: "entry_verified", entryId: school.entryIds[1] }],
    });
  });
});

describe("manager round corrections and family outcomes", () => {
  it("tells families only about changed outcomes or positions after a reopened round is finalised again", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 3, submit: [1, 2, 3] });
    const categoryId = await readyRound(h, school);
    const coordinator = h.as(school.coordinator.actor);
    const view = await coordinator.getSchoolRound(school.ref);
    if (!view.ok) throw new Error(view.error);
    const ref = {
      competitionId: school.competition.id,
      roundId: view.round.id,
    };
    const manager = h.as(await signedInWith(h, managerOf(ref.competitionId)));
    expect(
      await coordinator.finaliseSchoolRound({
        ...school.ref,
        judgingAttested: true,
      })
    ).toMatchObject({ ok: true });
    await h.drain();
    expect(await manager.reopenSchoolRound(ref)).toMatchObject({ ok: true });
    expect(
      await coordinator.saveShortlist({
        ...school.ref,
        categoryId,
        picks: [
          { entryId: school.entryIds[1]!, position: 2 },
          { entryId: school.entryIds[2]!, position: null },
        ],
      })
    ).toMatchObject({ ok: true });
    const before = h.email.sent.length;
    expect(
      await coordinator.finaliseSchoolRound({
        ...school.ref,
        judgingAttested: true,
      })
    ).toMatchObject({ ok: true });
    await h.drain();
    expect(h.email.sent.slice(before).map((message) => message.to)).toEqual([
      "guardian-1@example.test",
    ]);
    expect(h.email.sent.at(-1)?.text).toContain("placed it 2nd");
  });

  it("refuses reopening after its competition reaches FOA judging even before verification", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    await readyRound(h, school);
    const coordinator = h.as(school.coordinator.actor);
    const view = await coordinator.getSchoolRound(school.ref);
    if (!view.ok) throw new Error(view.error);
    const ref = {
      competitionId: school.competition.id,
      roundId: view.round.id,
    };
    const manager = h.as(await signedInWith(h, managerOf(ref.competitionId)));
    await coordinator.finaliseSchoolRound({
      ...school.ref,
      judgingAttested: true,
    });
    await pastShortlistDeadline(h);
    expect(await manager.reopenSchoolRound(ref)).toMatchObject({
      ok: false,
      error: "reopen_blocked",
      blockers: [{ code: "competition_not_in_judging" }],
    });
    expect(await manager.listSchoolRoundsForManager(ref)).toMatchObject({
      ok: true,
      rounds: [{ id: ref.roundId, canReopen: false }],
    });
  });

  it("lists rounds for the competition manager but not for the coordinator or another competition's manager", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h);
    const input = { competitionId: school.competition.id };
    const manager = h.as(await signedInWith(h, managerOf(input.competitionId)));
    expect(await manager.listSchoolRoundsForManager(input)).toMatchObject({
      ok: true,
      rounds: [{ institutionName: "Test School", status: "open" }],
    });
    await expect(
      h.as(school.coordinator.actor).listSchoolRoundsForManager(input)
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
