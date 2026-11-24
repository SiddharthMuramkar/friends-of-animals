import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  competition,
  competitionKeyDate,
  registration,
} from "@/server/db/schema";
import { submittedImage } from "@/server/modules/entries/testing";
import { signInMember } from "@/server/modules/participants/testing";
import { signInStaff } from "@/server/modules/payments/testing";
import { createHarness, type Harness } from "@/test/harness";
import { EICAR_TEST_BYTES } from "@/test/eicar";

import { confirmedSchool, otherSchool, type ConfirmedSchool } from "./testing";

// #87: the coordinator dashboard lists every student of one institution
// registration with their entry's status and next step, and each student's
// page shows their entry and the upload it takes now.

async function closesAt(h: Harness, competitionId: string) {
  const [row] = await h.db
    .select({ at: competitionKeyDate.at })
    .from(competitionKeyDate)
    .where(
      and(
        eq(competitionKeyDate.competitionId, competitionId),
        eq(competitionKeyDate.kind, "submissions_close")
      )
    );
  return row!.at;
}

async function registrationNumber(h: Harness, registrationId: string) {
  const [row] = await h.db
    .select({ number: registration.registrationNumber })
    .from(registration)
    .where(eq(registration.id, registrationId));
  return row!.number!;
}

function studentRef(school: ConfirmedSchool, number: string) {
  return { ...school.ids, registrationNumber: number };
}

describe("listInstitutionSubmissions", () => {
  it("lists every student with their entry status and next step", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 3, unconfirmed: 1 });
    const submitted = await submittedImage(h, school.forStudent(1));
    const rejected = await submittedImage(h, school.forStudent(2), {
      bytes: EICAR_TEST_BYTES,
    });
    await h.drain();

    const list = await h
      .as(school.coordinator.actor)
      .listInstitutionSubmissions(school.ids);

    expect(list).toMatchObject({
      ok: true,
      reference: school.reference,
      institutionName: "Test School",
      competitionName: "Paws on the Pavement",
      gate: "open",
      closesAt: await closesAt(h, school.competition.id),
      conductCertified: false,
      counts: {
        total: 4,
        needingUpload: 2,
        byStatus: { submitted: 1, rejected: 1, not_started: 2 },
      },
    });
    if (!list.ok) return;
    expect(
      list.rows.map(({ studentName, entryCode, status, action, hold }) => ({
        studentName,
        entryCode,
        status,
        action,
        hold,
      }))
    ).toEqual([
      {
        studentName: "Student A Rao",
        entryCode: submitted,
        status: "submitted",
        action: "replace",
        hold: null,
      },
      {
        studentName: "Student B Rao",
        entryCode: rejected,
        status: "rejected",
        action: "retry",
        hold: null,
      },
      {
        studentName: "Student C Rao",
        entryCode: null,
        status: "not_started",
        action: "submit",
        hold: null,
      },
      {
        studentName: "Student D Rao",
        entryCode: null,
        status: "not_started",
        action: null,
        hold: "registration_not_confirmed",
      },
    ]);
    expect(list.rows[0]!.registrationNumber).toMatch(/^PAWS27-R-/);
    expect(list.rows[3]!.registrationNumber).toBeNull();
  });

  it("offers nothing once submissions close, or while the competition takes the shortlist only", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 1 });
    const app = h.as(school.coordinator.actor);
    h.clock.set(await closesAt(h, school.competition.id));

    expect(await app.listInstitutionSubmissions(school.ids)).toMatchObject({
      ok: true,
      gate: "deadline_passed",
      rows: [{ action: null, hold: "deadline_passed" }],
    });

    await h.db
      .update(competition)
      .set({ digitalScope: "shortlist_only" })
      .where(eq(competition.id, school.competition.id));
    expect(await app.listInstitutionSubmissions(school.ids)).toMatchObject({
      ok: true,
      gate: "shortlist_only",
    });
  });

  it("says when the registration's conduct is certified", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 1 });
    const app = h.as(school.coordinator.actor);
    await app.certifyConduct(school.ids);

    expect(await app.listInstitutionSubmissions(school.ids)).toMatchObject({
      ok: true,
      conductCertified: true,
    });
  });
});

describe("getStudentSubmission", () => {
  it("offers a confirmed student's first upload in any of the competition's picture disciplines", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 1 });
    const number = await registrationNumber(h, school.registrationIds[0]!);

    const page = await h
      .as(school.coordinator.actor)
      .getStudentSubmission(studentRef(school, number));

    expect(page).toEqual({
      ok: true,
      reference: school.reference,
      institutionName: "Test School",
      competitionName: "Paws on the Pavement",
      closesAt: await closesAt(h, school.competition.id),
      student: {
        registrationId: school.registrationIds[0],
        name: "Student A Rao",
        registrationNumber: number,
      },
      entry: null,
      upload: {
        mode: "submit",
        disciplines: ["drawing", "painting", "photography"],
      },
      hold: null,
    });
  });

  it("shows the submitted entry with its picture, and offers a replacement in its discipline", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 1 });
    const code = await submittedImage(h, school.forStudent(1));
    await h.drain();
    const number = await registrationNumber(h, school.registrationIds[0]!);

    const page = await h
      .as(school.coordinator.actor)
      .getStudentSubmission(studentRef(school, number));

    expect(page).toMatchObject({
      ok: true,
      entry: {
        code,
        status: "submitted",
        title: "The dog at the tea stall",
        discipline: "photography",
        submittedAt: h.clock.now(),
        picture: { width: 1600, height: 1200, url: expect.any(String) },
        latestUpload: null,
      },
      upload: { mode: "replace", disciplines: ["photography"] },
      hold: null,
    });
  });

  it("holds the upload once submissions close", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 1 });
    const number = await registrationNumber(h, school.registrationIds[0]!);
    h.clock.set(await closesAt(h, school.competition.id));

    expect(
      await h
        .as(school.coordinator.actor)
        .getStudentSubmission(studentRef(school, number))
    ).toMatchObject({ ok: true, upload: null, hold: "deadline_passed" });
  });

  it("finds nothing for a number outside the registration, or a reference of another institution", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 1 });
    const other = await confirmedSchool(h, {
      students: 1,
      code: "SKIES27",
      name: "Other School",
    });
    const theirs = await registrationNumber(h, other.registrationIds[0]!);
    const app = h.as(school.coordinator.actor);

    expect(await app.getStudentSubmission(studentRef(school, theirs))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(
      await app.getStudentSubmission({
        institutionId: school.institutionId,
        reference: other.reference,
        registrationNumber: theirs,
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("who may read the submission roster and a student's page", () => {
  it("allows the institution's coordinators and its authorised person", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 1 });
    const number = await registrationNumber(h, school.registrationIds[0]!);

    for (const actor of [
      school.coordinator.actor,
      await h.signIn(school.admin),
    ]) {
      expect(
        await h.as(actor).listInstitutionSubmissions(school.ids)
      ).toMatchObject({ ok: true });
      expect(
        await h.as(actor).getStudentSubmission(studentRef(school, number))
      ).toMatchObject({ ok: true });
    }
  });

  it("refuses another institution's coordinator, a member, a guardian, a competition manager and a visitor", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 1 });
    const number = await registrationNumber(h, school.registrationIds[0]!);
    const other = await otherSchool(h);
    const family = await h.seed.guardian({
      children: [{ fullName: "Isha Desai", age: 9 }],
    });
    const actors = [
      other.coordinator.actor,
      (await signInMember(h, { name: "Ravi Kumar" })).actor,
      await h.signIn(family.account),
      (await signInStaff(h, "competition_manager")).actor,
      h.visitor(),
    ];

    for (const actor of actors) {
      await expect(
        h.as(actor).listInstitutionSubmissions(school.ids)
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        h.as(actor).getStudentSubmission(studentRef(school, number))
      ).rejects.toMatchObject({ code: "forbidden" });
    }
  });
});
