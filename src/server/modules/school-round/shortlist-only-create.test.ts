import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  competition,
  entry,
  entryFile,
  entryTransition,
  schoolRoundDeclaration,
  schoolRoundPick,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { confirmedAdult, submitImage } from "@/server/modules/entries/testing";
import { confirmedSchool } from "@/server/modules/institution-submissions/testing";
import { globalManager, signedInWith } from "@/server/modules/judging/testing";
import { createHarness, type Harness } from "@/test/harness";

import { SHORTLIST_ONLY_DECLARATIONS_VERSION } from "./domain/shortlist-only";
import {
  ALL_DECLARATIONS,
  anotherSchool,
  createdEntry,
  putShortlistedEntry,
  schoolInJudging,
  setShortlistLimits,
  shortlistOnlySchool,
} from "./testing";

// #91: under the shortlist-only scope students upload nothing. In the open
// school round the coordinator creates an entry for each shortlisted
// student: a photo or scan of the work with its title, description, school
// position and the declarations. The entry is born school-shortlisted with
// its Entry ID and its pick; its upload goes through the usual checks.

const FILE = { name: "kites.jpg", type: "image/jpeg", size: 1000 };

async function shortlistOnlyCompetition(h: Harness, competitionId: string) {
  await h.db
    .update(competition)
    .set({ digitalScope: "shortlist_only" })
    .where(eq(competition.id, competitionId));
}

describe("before the school round, under shortlist-only scope", () => {
  it("refuses the coordinator's upload and typed essay for a student", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    await shortlistOnlyCompetition(h, school.competition.id);
    const app = h.as(school.coordinator.actor);
    const registrationId = school.registrationIds[0]!;

    expect(
      await app.startEntryUpload({
        registrationId,
        discipline: "drawing",
        file: FILE,
      })
    ).toEqual({ ok: false, error: "shortlist_only" });
    expect(
      await app.submitEssayText({
        registrationId,
        title: "Our street",
        description: "Dogs on our street.",
        essay: "Every summer we fill the water bowls.",
      })
    ).toEqual({ ok: false, error: "shortlist_only" });
    expect(await h.db.select().from(entry)).toEqual([]);
  });

  it("refuses to create a shortlisted entry until the round opens", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    await shortlistOnlyCompetition(h, school.competition.id);

    expect(
      await h.as(school.coordinator.actor).startShortlistedEntry({
        institutionId: school.institutionId,
        reference: school.reference,
        registrationId: school.registrationIds[0]!,
        discipline: "drawing",
        file: FILE,
      })
    ).toEqual({ ok: false, error: "not_open" });
  });

  it("still takes an individual participant's upload", async () => {
    const h = await createHarness();
    const adult = await confirmedAdult(h);
    await shortlistOnlyCompetition(h, adult.competition.id);

    expect(await submitImage(h, adult)).toMatchObject({
      ok: true,
      status: "processing",
    });
  });
});

describe("startShortlistedEntry and completeShortlistedEntry", () => {
  it("creates a school-shortlisted entry with its Entry ID, pick, declarations and upload", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h);

    const result = await h
      .as(school.coordinator.actor)
      .completeShortlistedEntry(
        await putShortlistedEntry(h, school, 1, { position: 1 })
      );

    expect(result).toEqual({
      ok: true,
      entryCode: expect.stringMatching(/^PAWS27-E-[0-9A-HJKMNP-TV-Z]{6}$/),
      status: "school_shortlisted",
    });
    const [row] = await h.db.select().from(entry);
    expect(row).toMatchObject({
      status: "school_shortlisted",
      registrationId: school.registrationIds[0],
      discipline: "photography",
      title: "Kites over the lake",
      createdByUserId: school.coordinator.userId,
    });
    const history = await h.db
      .select({
        from: entryTransition.fromStatus,
        to: entryTransition.toStatus,
        actorUserId: entryTransition.actorUserId,
      })
      .from(entryTransition)
      .orderBy(asc(entryTransition.sequence));
    expect(history).toEqual([
      {
        from: null,
        to: "school_shortlisted",
        actorUserId: school.coordinator.userId,
      },
    ]);
    expect(
      await h.db
        .select({ status: entryFile.status })
        .from(entryFile)
        .where(eq(entryFile.entryId, row!.id))
    ).toEqual([{ status: "pending" }]);
    expect(
      await h.db
        .select({
          entryId: schoolRoundPick.entryId,
          position: schoolRoundPick.position,
        })
        .from(schoolRoundPick)
    ).toEqual([{ entryId: row!.id, position: 1 }]);
    expect(
      await h.db
        .select({
          declarations: schoolRoundDeclaration.declarations,
          statementVersion: schoolRoundDeclaration.statementVersion,
          declaredByUserId: schoolRoundDeclaration.declaredByUserId,
        })
        .from(schoolRoundDeclaration)
    ).toEqual([
      {
        declarations: ALL_DECLARATIONS,
        statementVersion: SHORTLIST_ONLY_DECLARATIONS_VERSION,
        declaredByUserId: school.coordinator.userId,
      },
    ]);

    const view = await h
      .as(school.coordinator.actor)
      .getSchoolRound(school.ref);
    if (!view.ok) throw new Error(view.error);
    expect(view.round.students[0]).toMatchObject({
      registrationId: school.registrationIds[0],
      entry: {
        code: result.ok ? result.entryCode : "",
        status: "school_shortlisted",
        upload: "checking",
        position: 1,
      },
    });
    expect(view.round.students[1]).toMatchObject({ entry: null });
  });

  it("refuses missing declarations and names them", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h);

    expect(
      await h.as(school.coordinator.actor).completeShortlistedEntry(
        await putShortlistedEntry(h, school, 1, {
          declarations: ["original_work", "physical_work_kept", "gallery"],
        })
      )
    ).toEqual({
      ok: false,
      error: "declarations_invalid",
      missing: ["faithful_reproduction", "participation_covered"],
      unknown: ["gallery"],
    });
    expect(await h.db.select().from(entry)).toEqual([]);
  });

  it("keeps each category within the shortlist size and its positions", async () => {
    const h = await createHarness();
    const school = await shortlistOnlySchool(h, { students: 3 });
    await setShortlistLimits(h, school.competition.id, {
      shortlistSize: 2,
      positions: 1,
    });
    await createdEntry(h, school, 1, { position: 1 });

    expect(
      await h
        .as(school.coordinator.actor)
        .completeShortlistedEntry(
          await putShortlistedEntry(h, school, 2, { position: 1 })
        )
    ).toMatchObject({
      ok: false,
      error: "shortlist_invalid",
      problems: [{ code: "position_taken", position: 1 }],
    });
    expect(
      await h
        .as(school.coordinator.actor)
        .completeShortlistedEntry(
          await putShortlistedEntry(h, school, 2, { position: 2 })
        )
    ).toMatchObject({
      ok: false,
      error: "shortlist_invalid",
      problems: [{ code: "position_out_of_range", position: 2, limit: 1 }],
    });
    await createdEntry(h, school, 2);

    expect(
      await h.as(school.coordinator.actor).startShortlistedEntry({
        ...school.ref,
        registrationId: school.registrationIds[2]!,
        discipline: "photography",
        file: FILE,
      })
    ).toEqual({
      ok: false,
      error: "shortlist_invalid",
      problems: [{ code: "shortlist_full", limit: 2, count: 3 }],
    });
    // Another category has room of its own.
    expect(
      await h.as(school.coordinator.actor).startShortlistedEntry({
        ...school.ref,
        registrationId: school.registrationIds[2]!,
        discipline: "drawing",
        file: FILE,
      })
    ).toMatchObject({ ok: true });
  });

  it("refuses a student of another registration and a finalised round", async () => {
    const h = await createHarness();
    let other: Awaited<ReturnType<typeof anotherSchool>> | undefined;
    const school = await shortlistOnlySchool(h, {
      beforeJudging: async (built) => {
        other = await anotherSchool(h, built.competition.id);
      },
    });
    const app = h.as(school.coordinator.actor);

    // The other school's registration for the competition, not a student.
    expect(
      await app.startShortlistedEntry({
        ...school.ref,
        registrationId: other!.registrationId,
        discipline: "photography",
        file: FILE,
      })
    ).toEqual({ ok: false, error: "student_not_found" });

    await app.recordPanel({
      ...school.ref,
      members: [{ fullName: "Lata Kulkarni", designation: "Art teacher" }],
    });
    await app.certifyConduct(school.ref);
    await app.finaliseSchoolRound({ ...school.ref, judgingAttested: true });
    expect(
      await app.startShortlistedEntry({
        ...school.ref,
        registrationId: school.registrationIds[0]!,
        discipline: "photography",
        file: FILE,
      })
    ).toEqual({ ok: false, error: "round_not_editable" });
  });

  it("answers not_shortlist_only under the all-participants scope", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { submit: [] });

    expect(
      await h.as(school.coordinator.actor).startShortlistedEntry({
        ...school.ref,
        registrationId: school.registrationIds[0]!,
        discipline: "photography",
        file: FILE,
      })
    ).toEqual({ ok: false, error: "not_shortlist_only" });
  });

  it("lets only the institution's coordinators create entries", async () => {
    const h = await createHarness();
    let other: Awaited<ReturnType<typeof anotherSchool>> | undefined;
    const school = await shortlistOnlySchool(h, {
      beforeJudging: async (built) => {
        other = await anotherSchool(h, built.competition.id);
      },
    });
    const ready = await putShortlistedEntry(h, school, 1);
    const participant = await h.signIn(await h.seed.member());
    const manager = await signedInWith(h, globalManager);

    for (const actor of [other!.coordinator.actor, participant, manager]) {
      await expect(
        h.as(actor).startShortlistedEntry({
          ...school.ref,
          registrationId: school.registrationIds[1]!,
          discipline: "photography",
          file: FILE,
        })
      ).rejects.toThrow(DomainError);
      await expect(h.as(actor).completeShortlistedEntry(ready)).rejects.toThrow(
        DomainError
      );
    }
    expect(await h.db.select().from(entry)).toEqual([]);
  });
});
