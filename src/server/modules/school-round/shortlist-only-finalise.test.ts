import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  competition,
  entry,
  entryFile,
  entryTransition,
  outbox,
  schoolRound,
} from "@/server/db/schema";
import { managerOf, signedInWith } from "@/server/modules/judging/testing";
import { signedInVerifier } from "@/server/modules/verification/testing";
import { guardianEmail } from "@/server/modules/payments/testing";
import { createHarness, type Harness } from "@/test/harness";

import {
  createdEntry,
  pastShortlistDeadline,
  putShortlistedEntry,
  shortlistOnlySchool,
  type RoundWorld,
} from "./testing";

// #91: finalising a shortlist-only round. Every entry the coordinator
// created is shortlisted; it goes on to FOA once its upload is live and the
// round is finished, whichever comes second (owner decision 2026-11-19). A
// failed upload leaves it school_shortlisted until the coordinator uploads
// again. No entry is ever not_shortlisted: every other confirmed student's
// family hears by registration.

const PANEL = [{ fullName: "Lata Kulkarni", designation: "Art teacher" }];

async function readyToFinalise(h: Harness, world: RoundWorld) {
  const coordinator = h.as(world.coordinator.actor);
  await coordinator.recordPanel({ ...world.ref, members: PANEL });
  const certified = await coordinator.certifyConduct(world.ref);
  if (!certified.ok) throw new Error(JSON.stringify(certified));
}

const finalise = (h: Harness, world: RoundWorld) =>
  h
    .as(world.coordinator.actor)
    .finaliseSchoolRound({ ...world.ref, judgingAttested: true });

async function statusOf(h: Harness, entryId: string) {
  const [row] = await h.db
    .select({ status: entry.status, submittedAt: entry.submittedAt })
    .from(entry)
    .where(eq(entry.id, entryId));
  return row;
}

async function historyOf(h: Harness, entryId: string) {
  const rows = await h.db
    .select({ to: entryTransition.toStatus })
    .from(entryTransition)
    .where(eq(entryTransition.entryId, entryId))
    .orderBy(asc(entryTransition.sequence));
  return rows.map((row) => row.to);
}

async function sinceNow(h: Harness, run: () => Promise<unknown>) {
  const before = h.email.sent.length;
  await run();
  return h.email.sent.slice(before);
}

describe("finalising a shortlist-only round", () => {
  it("still needs the panel, the conduct certification and the attestation", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h);

    expect(
      await h
        .as(school.coordinator.actor)
        .finaliseSchoolRound({ ...school.ref, judgingAttested: false })
    ).toEqual({
      ok: false,
      error: "finalise_blocked",
      blockers: [
        { code: "panel_missing" },
        { code: "conduct_not_certified" },
        { code: "judging_not_attested" },
      ],
    });
  });

  it("sends entries with a live upload to FOA at once and the rest when their upload goes live", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h, { students: 3 });
    const live = await createdEntry(h, school, 1, { position: 1 });
    await h.drain();
    const waiting = await createdEntry(h, school, 2);
    await readyToFinalise(h, school);

    expect(await finalise(h, school)).toMatchObject({
      ok: true,
      shortlisted: 2,
      notShortlisted: 1,
    });
    expect(await statusOf(h, live.entryId)).toEqual({
      status: "submitted_to_foa",
      submittedAt: h.clock.now(),
    });
    expect(await statusOf(h, waiting.entryId)).toMatchObject({
      status: "school_shortlisted",
    });
    expect(
      await h.db.select().from(entry).where(eq(entry.status, "not_shortlisted"))
    ).toEqual([]);

    await h.drain();
    expect(await statusOf(h, waiting.entryId)).toMatchObject({
      status: "submitted_to_foa",
    });
    expect(await historyOf(h, waiting.entryId)).toEqual([
      "school_shortlisted",
      "submitted_to_foa",
    ]);
    // Delivering the upload's events again moves nothing twice.
    await h.db.update(outbox).set({ availableAt: h.clock.now() });
    await h.drain();
    expect(await historyOf(h, waiting.entryId)).toEqual([
      "school_shortlisted",
      "submitted_to_foa",
    ]);
  });

  it("keeps an entry whose upload failed shortlisted until the coordinator uploads again", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h, { students: 1 });
    h.media.failNext(1, "media_decode_failed");
    const failed = await createdEntry(h, school, 1);
    await h.drain();
    expect(
      await h.db
        .select({ status: entryFile.status })
        .from(entryFile)
        .where(eq(entryFile.entryId, failed.entryId))
    ).toEqual([{ status: "failed" }]);
    await readyToFinalise(h, school);
    await finalise(h, school);
    await h.drain();
    expect(await statusOf(h, failed.entryId)).toMatchObject({
      status: "school_shortlisted",
    });

    const again = await h
      .as(school.coordinator.actor)
      .completeShortlistedEntry(await putShortlistedEntry(h, school, 1));
    expect(again).toMatchObject({ ok: true, entryCode: failed.code });
    await h.drain();

    expect(await statusOf(h, failed.entryId)).toMatchObject({
      status: "submitted_to_foa",
    });
    const view = await h
      .as(school.coordinator.actor)
      .getSchoolRound(school.ref);
    if (!view.ok) throw new Error(view.error);
    expect(view.round.students[0]?.entry).toMatchObject({
      status: "submitted_to_foa",
      upload: "live",
    });
  });

  it("tells shortlisted families by entry and every other confirmed student's family by registration, once", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h, { students: 3 });
    await createdEntry(h, school, 1);
    await h.drain();
    await readyToFinalise(h, school);
    await finalise(h, school);

    const sent = await sinceNow(h, () => h.drain());

    expect(sent.map((message) => message.to).sort()).toEqual([
      guardianEmail(1),
      guardianEmail(2),
      guardianEmail(3),
    ]);
    expect(h.email.lastTo(guardianEmail(1))!.subject).toMatch(
      /^Entry PAWS27-E-\w+ shortlisted for FOA judging$/
    );
    const notShortlisted = h.email.lastTo(guardianEmail(2))!;
    expect(notShortlisted.subject).toBe(
      "School judging finished for Paws on the Pavement"
    );
    expect(notShortlisted.text).toContain("Student B Rao");
    expect(notShortlisted.text).toContain("Test School");
    expect(notShortlisted.text).not.toMatch(/PAWS27-E-/);
    expect(await sinceNow(h, () => h.drain())).toEqual([]);
    expect(
      await h
        .as(school.coordinator.actor)
        .listSchoolRoundOutcomes({ registrationId: school.registrationIds[1]! })
    ).toMatchObject({
      ok: true,
      roundStatus: "finalised",
      outcomes: [
        {
          registrationId: school.registrationIds[1],
          entryId: null,
          entryCode: null,
          outcome: "not_shortlisted",
          position: null,
        },
      ],
    });
    const [round] = await h.db.select().from(schoolRound);
    expect(round?.familiesNotifiedAt).not.toBeNull();
  });

  it("refuses saving a shortlist by hand: creating an entry picks it", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h);
    const { entryId } = await createdEntry(h, school, 1);
    const view = await h
      .as(school.coordinator.actor)
      .getSchoolRound(school.ref);
    if (!view.ok) throw new Error(view.error);

    expect(
      await h.as(school.coordinator.actor).saveShortlist({
        ...school.ref,
        categoryId: view.round.categories[0]!.id,
        picks: [{ entryId, position: null }],
      })
    ).toEqual({ ok: false, error: "shortlist_only" });
  });
});

describe("shortlist-only round management and FOA correction", () => {
  it("closes an overdue shortlist-only round, promotes its live picks, and lets pending picks retry after FOA judging starts", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h, { students: 3 });
    const live = await createdEntry(h, school, 1, { position: 1 });
    await h.drain();
    h.media.failNext(1, "media_decode_failed");
    const failed = await createdEntry(h, school, 2);
    await h.drain();
    const coordinator = h.as(school.coordinator.actor);
    const view = await coordinator.getSchoolRound(school.ref);
    if (!view.ok) throw new Error(view.error);
    const ref = {
      competitionId: school.competition.id,
      roundId: view.round.id,
    };
    const manager = h.as(await signedInWith(h, managerOf(ref.competitionId)));
    await pastShortlistDeadline(h);
    expect(
      await manager.closeSchoolRoundOnBehalf({
        ...ref,
        reason: "School requested FOA assistance",
      })
    ).toMatchObject({ ok: true, shortlisted: 2, notShortlisted: 1 });
    expect(await statusOf(h, live.entryId)).toMatchObject({
      status: "submitted_to_foa",
    });
    expect(await statusOf(h, failed.entryId)).toMatchObject({
      status: "school_shortlisted",
    });
    await h.drain();
    expect(
      (
        await h.db
          .select({ status: competition.status })
          .from(competition)
          .where(eq(competition.id, ref.competitionId))
      )[0]?.status
    ).toBe("foa_judging");
    expect(h.email.lastTo(guardianEmail(3))?.subject).toBe(
      "School judging finished for Paws on the Pavement"
    );
    expect(
      await coordinator.completeShortlistedEntry(
        await putShortlistedEntry(h, school, 2)
      )
    ).toMatchObject({ ok: true, entryCode: failed.code });
    await h.drain();
    expect(await statusOf(h, failed.entryId)).toMatchObject({
      status: "submitted_to_foa",
    });
  });

  it("reopens before the deadline, preserves created picks, and tells only registrations whose outcome changes", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h, { students: 3 });
    const picked = await createdEntry(h, school, 1, { position: 1 });
    await h.drain();
    await readyToFinalise(h, school);
    const coordinator = h.as(school.coordinator.actor);
    const view = await coordinator.getSchoolRound(school.ref);
    if (!view.ok) throw new Error(view.error);
    const ref = {
      competitionId: school.competition.id,
      roundId: view.round.id,
    };
    const manager = h.as(await signedInWith(h, managerOf(ref.competitionId)));
    expect(await finalise(h, school)).toMatchObject({ ok: true });
    await h.drain();
    expect(await manager.reopenSchoolRound(ref)).toMatchObject({
      ok: true,
      status: "open",
    });
    expect(await statusOf(h, picked.entryId)).toMatchObject({
      status: "school_shortlisted",
    });
    expect(await coordinator.getSchoolRound(school.ref)).toMatchObject({
      ok: true,
      round: {
        students: expect.arrayContaining([
          expect.objectContaining({
            registrationId: school.registrationIds[0],
            entry: expect.objectContaining({ position: 1 }),
          }),
        ]),
      },
    });
    const second = await createdEntry(h, school, 2);
    await h.drain();
    const before = h.email.sent.length;
    expect(await finalise(h, school)).toMatchObject({
      ok: true,
      shortlisted: 2,
      notShortlisted: 1,
    });
    await h.drain();
    expect(h.email.sent.slice(before).map((m) => m.to)).toEqual([
      guardianEmail(2),
    ]);
    expect(await statusOf(h, picked.entryId)).toMatchObject({
      status: "submitted_to_foa",
    });
    expect(await statusOf(h, second.entryId)).toMatchObject({
      status: "submitted_to_foa",
    });
  });

  it("lets a coordinator correct a sent-back shortlist-only entry through the ordinary correction path", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h, { students: 1 });
    const picked = await createdEntry(h, school, 1);
    await h.drain();
    await readyToFinalise(h, school);
    await finalise(h, school);
    await h.drain();
    const verifier = h.as(await signedInVerifier(h));
    expect(
      await verifier.sendBackEntry({
        entryId: picked.entryId,
        reason: { code: "other", text: "Please clarify the title" },
      })
    ).toMatchObject({ ok: true, status: "sent_back" });
    const coordinator = h.as(school.coordinator.actor);
    expect(
      await coordinator.listInstitutionSubmissions(school.ref)
    ).toMatchObject({
      ok: true,
      rows: [{ status: "sent_back", action: "replace", hold: null }],
    });
    expect(
      await coordinator.resubmitEntry({
        entryId: picked.entryId,
        title: "Corrected title",
        description: "Description of the work",
      })
    ).toMatchObject({ ok: true, status: "submitted_to_foa" });
  });
});
