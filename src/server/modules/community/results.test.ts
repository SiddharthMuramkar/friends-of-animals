import { describe, expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { SEED_ACCOUNTS } from "../../seed/accounts";
import { SEED_GUARDIANS } from "../../seed/guardians";
import { SEED_RESULTS } from "../../seed/results";
import { staffActor } from "../volunteers/testing";

describe("the results engagement feed", () => {
  it("uses actual published results, keeps a minor's rungs separate, and rebuilds idempotently", async () => {
    const h = await createHarness();
    await h.seed.preview();
    await h.drain();
    const adult = h.as(await h.signIn(SEED_ACCOUNTS.members[0]));
    const guardian = h.as(await h.signIn(SEED_GUARDIANS.guardian));
    const teen = h.as(await h.signIn(SEED_GUARDIANS.teen));
    const childId = SEED_GUARDIANS.children.teen.profileId;
    const competitionId = SEED_RESULTS.competitionId;
    const resultKinds = (
      rows: { kind: string; competitionId: string | null }[]
    ) =>
      rows
        .filter((r) => r.competitionId === competitionId)
        .map((r) => r.kind)
        .sort((a, b) => String(a).localeCompare(String(b)));
    expect(resultKinds((await adult.getTimeline()).milestones)).toEqual([
      "foa_finalist",
      "participant",
    ]);
    const child = await guardian.getTimeline({ childId });
    expect(resultKinds(child.milestones)).toEqual([
      "foa_finalist",
      "participant",
    ]);
    expect(await teen.getTimeline()).toEqual(child);
    expect(resultKinds((await guardian.getTimeline()).milestones)).toEqual([]);
    expect(
      child.entries
        .filter((r) => r.competitionId === competitionId)
        .every((r) => r.competitionName === "Art for kindness")
    ).toBe(true);
    const manager = h.as(await staffActor(h, "community_manager"));
    await expect(
      manager.rebuildMilestones({ competitionId })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      guardian.rebuildMilestones({ competitionId })
    ).rejects.toMatchObject({ code: "forbidden" });
    const admin = h.as(await staffActor(h, "super_admin"));
    expect(await admin.rebuildMilestones({ competitionId })).toMatchObject({
      ok: true,
    });
    expect(await admin.rebuildMilestones({ competitionId })).toMatchObject({
      ok: true,
    });
    expect(await guardian.getTimeline({ childId })).toEqual(child);
  });
});

import { eq } from "drizzle-orm";
import { entry } from "../../db/schema";
import { scoringWorld } from "../judging/blind-testing";
import { signedInWith, managerOf } from "../judging/testing";
import { collectSubjectData } from "../privacy/requests/subject-data/collect";

it("records actual school positions, submitted participants and final awards from a real release exactly once", async () => {
  const h = await createHarness();
  const world = await scoringWorld(h);
  const competitionId = world.school.competition.id;
  const manager = h.as(await signedInWith(h, managerOf(competitionId)));
  for (const [actor, entryCode, score] of [
    [world.judge, world.code, 9],
    [world.otherJudge, world.otherCode, 6],
  ] as const) {
    const api = h.as(actor);
    const detail = await api.getBlindEntry({
      roundId: world.roundId,
      entryCode,
    });
    if (!detail.ok) throw Error(detail.error);
    expect(
      await api.saveScoreSheet({
        roundId: world.roundId,
        entryCode,
        baseVersion: detail.sheet.version,
        scores: Object.fromEntries(detail.criteria.map((c) => [c.id, score])),
      })
    ).toMatchObject({ ok: true });
  }
  h.clock.advance({ days: 20 });
  await h.drain();
  expect(
    await manager.lockJudgingRound({ roundId: world.roundId })
  ).toMatchObject({ ok: true });
  const publishAt = new Date(h.clock.now().getTime() + 60_000).toISOString();
  const prepared = await manager.prepareResultsRelease({
    competitionId,
    sourceRoundId: world.roundId,
    publishAt,
    deliveryNote: "FOA will contact recipients.",
  });
  if (!prepared.ok) throw Error(prepared.error);
  const payload = {
    competitionId,
    releaseId: prepared.releaseId,
    publishedAt: publishAt,
  };
  const worker = h.as({ kind: "system", process: "worker" });
  expect(await worker.recordPublishedEngagement(payload)).toMatchObject({
    ok: false,
    error: "not_published",
  });
  await expect(
    manager.recordPublishedEngagement(payload)
  ).rejects.toMatchObject({ code: "forbidden" });
  const reviewer = h.as(await signedInWith(h, managerOf(competitionId)));
  expect(
    await reviewer.approveResultsRelease({
      competitionId,
      releaseId: prepared.releaseId,
    })
  ).toMatchObject({ ok: true });
  h.clock.advance({ minutes: 1 });
  await h.drain();
  // Outbox consumer is the only producer before rebuilding.
  const exports = async (entryId: string) => {
    const [row] = await h.db
      .select({ id: entry.participantProfileId })
      .from(entry)
      .where(eq(entry.id, entryId));
    return (
      await collectSubjectData(h.deps, {
        scope: { userIds: [], profileIds: [row!.id] },
        subject: { kind: "participant_profile", id: row!.id },
        reference: "SCHOOL-COMMUNITY",
        generatedAt: h.clock.now(),
      })
    ).document.sections;
  };
  const first = await exports(world.entryId),
    second = await exports(world.otherEntryId),
    third = await exports(world.school.entryIds[3]!);
  expect(
    first.engagement_milestone
      ?.map((row) => row.kind)
      .sort((a, b) => String(a).localeCompare(String(b)))
  ).toEqual(["foa_finalist", "participant", "school_winner"]);
  expect(
    second.engagement_milestone
      ?.map((row) => row.kind)
      .sort((a, b) => String(a).localeCompare(String(b)))
  ).toEqual(["foa_finalist", "participant"]);
  expect(third.engagement_milestone?.map((row) => row.kind)).toEqual([
    "participant",
  ]);
  expect(first.timeline_entry).toHaveLength(3);
  expect(await worker.recordPublishedEngagement(payload)).toMatchObject({
    ok: true,
    facts: 6,
  });
  expect(
    await worker.recordPublishedEngagement({
      ...payload,
      publishedAt: "2000-01-01T00:00:00.000Z",
    })
  ).toMatchObject({ ok: false, error: "not_published" });
  expect((await exports(world.entryId)).engagement_milestone).toEqual(
    first.engagement_milestone
  );
  expect((await exports(world.entryId)).timeline_entry).toEqual(
    first.timeline_entry
  );
});

it("seeds member profile and guardian timeline idempotently", async () => {
  const h = await createHarness();
  await h.seed.preview();
  const adult = h.as(await h.signIn(SEED_ACCOUNTS.members[0]));
  const guardian = h.as(await h.signIn(SEED_GUARDIANS.guardian));
  const childId = SEED_GUARDIANS.children.young.profileId;
  const before = await adult.getTimeline();
  const child = await guardian.getTimeline({ childId });
  expect((await adult.getMyCommunity()).member).toMatchObject({
    displayName: "Asha Rao",
    status: "active",
  });
  expect(before.milestones.map((row) => row.kind)).toContain(
    "community_member"
  );
  expect(child.milestones.map((row) => row.kind)).toContain("community_member");
  await h.seed.preview();
  expect(await adult.getTimeline()).toEqual(before);
  expect(await guardian.getTimeline({ childId })).toEqual(child);
});

import { shortlistOnlySchool, createdEntry } from "../school-round/testing";
import { judgingRound, registration } from "../../db/schema";
import { uuidv7 } from "../../ids";
import { TIE_BREAK_RULE } from "../judging/domain/ranking";
it("counts confirmed shortlist-only students who took part in school judging without an online entry", async () => {
  const h = await createHarness();
  const school = await shortlistOnlySchool(h);
  const competitionId = school.competition.id;
  const coordinator = h.as(school.coordinator.actor);
  await coordinator.recordPanel({
    ...school.ref,
    members: [{ fullName: "Sample teacher", designation: "Art teacher" }],
  });
  expect(await coordinator.certifyConduct(school.ref)).toMatchObject({
    ok: true,
  });
  await createdEntry(h, school, 1, { position: 1 });
  await h.drain();
  expect(
    await coordinator.finaliseSchoolRound({
      ...school.ref,
      judgingAttested: true,
    })
  ).toMatchObject({ ok: true });
  await h.drain();
  h.clock.advance({ days: 20 });
  await h.drain();
  // A reasoned empty final lock is a valid final snapshot; final scoring is
  // not under test. School participation must not depend on any FOA award.
  const now = h.clock.now();
  const roundId = uuidv7(now);
  await h.db.insert(judgingRound).values({
    id: roundId,
    competitionId,
    name: "Final",
    nameKey: "final",
    status: "locked",
    lockedAt: now,
    lockOverrideReason: "No complete final entries",
    tieBreakRule: TIE_BREAK_RULE,
    createdAt: now,
    updatedAt: now,
  });
  const manager = h.as(await signedInWith(h, managerOf(competitionId)));
  const reviewer = h.as(await signedInWith(h, managerOf(competitionId)));
  const publishAt = new Date(now.getTime() + 60_000).toISOString();
  const prepared = await manager.prepareResultsRelease({
    competitionId,
    sourceRoundId: roundId,
    publishAt,
    deliveryNote: "No final awards.",
  });
  if (!prepared.ok) throw Error(prepared.error);
  expect(
    await reviewer.approveResultsRelease({
      competitionId,
      releaseId: prepared.releaseId,
    })
  ).toMatchObject({ ok: true });
  h.clock.advance({ minutes: 1 });
  await h.drain();
  // A confirmed school-only participant has no entry but has exportable private history.
  for (const [i, registrationId] of school.registrationIds.entries()) {
    const [row] = await h.db
      .select({ id: registration.participantProfileId })
      .from(registration)
      .where(eq(registration.id, registrationId));
    const exported = (
      await collectSubjectData(h.deps, {
        scope: { userIds: [], profileIds: [row!.id] },
        subject: { kind: "participant_profile", id: row!.id },
        reference: "SHORTLIST-COMMUNITY",
        generatedAt: h.clock.now(),
      })
    ).document.sections;
    expect(exported.engagement_milestone?.map((row) => row.kind)).toEqual(
      i === 0 ? ["participant", "school_winner"] : ["participant"]
    );
    if (i > 0) expect(exported.entry).toBeUndefined();
  }
});
