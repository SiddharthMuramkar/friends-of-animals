import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  competition,
  inboxItem,
  competitionKeyDate,
  entry,
  entryFile,
  entryTransition,
  fileAsset,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import {
  ADULT_STUDENT_EMAIL,
  confirmedSchool,
  otherSchool,
  schoolWithAdultStudent,
} from "@/server/modules/institution-submissions/testing";
import { guardianEmail } from "@/server/modules/payments/testing";
import { createHarness, type Harness } from "@/test/harness";
import { EICAR_TEST_BYTES } from "@/test/eicar";
import { readMediaFixture } from "@/test/media-fixtures";

import { confirmedAdult, PHOTO, submitImage, submittedImage } from "../testing";

// #87: on the school route, while the competition's digital submission
// scope is all participants, a coordinator submits each confirmed
// student's entry through the same use cases as an individual: the same
// file rules, scan, derivatives, Entry ID and deadline.

const ENTRY_ID = /^[A-Z]{3,6}\d{2}-E-[0-9A-HJKMNP-TV-Z]{6}$/;

describe("a coordinator submitting for a student", () => {
  it("creates the student's entry with its Entry ID, made by the coordinator, and submits it once its file passes the checks", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);

    const completed = await submitImage(h, school.forStudent(1));

    expect(completed).toEqual({
      ok: true,
      entryCode: expect.stringMatching(ENTRY_ID),
      status: "processing",
    });
    if (!completed.ok) return;
    expect(completed.entryCode.startsWith("PAWS27-E-")).toBe(true);
    const [row] = await h.db
      .select()
      .from(entry)
      .where(eq(entry.code, completed.entryCode));
    expect(row).toMatchObject({
      registrationId: school.registrationIds[0],
      createdByUserId: school.coordinator.userId,
      status: "processing",
    });
    await h.drain();
    const [after] = await h.db
      .select({ status: entry.status })
      .from(entry)
      .where(eq(entry.code, completed.entryCode));
    expect(after?.status).toBe("submitted");
    const moves = await h.db
      .select({
        to: entryTransition.toStatus,
        actorUserId: entryTransition.actorUserId,
      })
      .from(entryTransition)
      .where(eq(entryTransition.entryId, row!.id))
      .orderBy(entryTransition.sequence);
    expect(moves).toEqual([
      { to: "processing", actorUserId: school.coordinator.userId },
      { to: "submitted", actorUserId: null },
    ]);
  });
});

const FILE = { name: "work.jpg", type: "image/jpeg", size: PHOTO.length };

async function entryOf(h: Harness, registrationId: string) {
  const [row] = await h.db
    .select({ id: entry.id, code: entry.code, status: entry.status })
    .from(entry)
    .where(eq(entry.registrationId, registrationId));
  return row;
}

async function fileStatuses(h: Harness, entryId: string) {
  const rows = await h.db
    .select({ status: entryFile.status })
    .from(entryFile)
    .where(eq(entryFile.entryId, entryId))
    .orderBy(asc(entryFile.attemptNumber));
  return rows.map((row) => row.status);
}

describe("who a coordinator may submit for", () => {
  it("refuses a coordinator of another institution, leaving no entry, file or audit row", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const other = await otherSchool(h);
    const auditBefore = await h.db.select().from(auditLog);
    const filesBefore = await h.db.select().from(fileAsset);

    await expect(
      h.as(other.coordinator.actor).startEntryUpload({
        registrationId: school.registrationIds[0]!,
        discipline: "drawing",
        file: FILE,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(other.coordinator.actor).getEntryUploadOptions({
        registrationId: school.registrationIds[0]!,
      })
    ).rejects.toThrow(DomainError);
    await expect(
      h.as(other.coordinator.actor).completeEntryUpload({
        registrationId: school.registrationIds[0]!,
        fileId: "01938a00-0000-7000-8000-000000000999",
        title: "Not theirs",
        description: "Another school's student.",
      })
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(await h.db.select().from(entry)).toEqual([]);
    expect(await h.db.select().from(fileAsset)).toEqual(filesBefore);
    expect(await h.db.select().from(auditLog)).toEqual(auditBefore);
  });

  it("refuses a coordinator on an individual registration", async () => {
    const h = await createHarness();
    const asha = await confirmedAdult(h);
    const school = await confirmedSchool(h);

    await expect(
      h.as(school.coordinator.actor).startEntryUpload({
        registrationId: asha.registrationId,
        discipline: "drawing",
        file: FILE,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("lets the institution's authorised person submit too", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const admin = await h.signIn(school.admin);

    const completed = await submitImage(h, school.forStudent(1, admin));

    expect(completed).toMatchObject({ ok: true, status: "processing" });
  });

  it("refuses a student whose enrolment isn't confirmed yet", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { unconfirmed: 1 });

    expect(
      await h.as(school.coordinator.actor).startEntryUpload({
        registrationId: school.unconfirmedIds[0]!,
        discipline: "drawing",
        file: FILE,
      })
    ).toEqual({ ok: false, error: "registration_not_confirmed" });
  });

  it("refuses while the competition takes digital work from the school shortlist only", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    await h.db
      .update(competition)
      .set({ digitalScope: "shortlist_only" })
      .where(eq(competition.id, school.competition.id));
    const app = h.as(school.coordinator.actor);
    const registrationId = school.registrationIds[0]!;

    expect(
      await app.startEntryUpload({
        registrationId,
        discipline: "drawing",
        file: FILE,
      })
    ).toEqual({ ok: false, error: "shortlist_only" });
    expect(await app.getEntryUploadOptions({ registrationId })).toEqual({
      ok: false,
      error: "shortlist_only",
    });
  });
});

describe("the same pipeline as an individual's", () => {
  it("refuses a file of the wrong type or too large at the start", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const app = h.as(school.coordinator.actor);
    const registrationId = school.registrationIds[0]!;

    expect(
      await app.startEntryUpload({
        registrationId,
        discipline: "drawing",
        file: { name: "work.gif", type: "image/gif", size: 1000 },
      })
    ).toEqual({ ok: false, error: "wrong_type" });
    expect(
      await app.startEntryUpload({
        registrationId,
        discipline: "drawing",
        file: { name: "work.jpg", type: "image/jpeg", size: 21 * 1024 * 1024 },
      })
    ).toEqual({ ok: false, error: "too_large" });
  });

  it("rejects an infected file and lets the coordinator retry", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const student = school.forStudent(1);
    const code = await submittedImage(h, student, { bytes: EICAR_TEST_BYTES });
    await h.drain();
    expect(await entryOf(h, student.registrationId)).toMatchObject({
      code,
      status: "rejected",
    });

    const retried = await submitImage(h, student);
    expect(retried).toEqual({
      ok: true,
      entryCode: code,
      status: "processing",
    });
    await h.drain();
    expect(await entryOf(h, student.registrationId)).toMatchObject({
      status: "submitted",
    });
  });
});

describe("replacing a student's file", () => {
  it("keeps the entry submitted, and its live file, until the replacement passes its checks", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const student = school.forStudent(1);
    const code = await submittedImage(h, student);
    await h.drain();
    const { id } = (await entryOf(h, student.registrationId))!;

    const replaced = await submitImage(h, student, {
      bytes: readMediaFixture("rotatedJpeg"),
    });

    expect(replaced).toEqual({
      ok: true,
      entryCode: code,
      status: "submitted",
    });
    expect(await fileStatuses(h, id)).toEqual(["live", "pending"]);
    await h.drain();
    expect(await entryOf(h, student.registrationId)).toMatchObject({
      status: "submitted",
    });
    expect(await fileStatuses(h, id)).toEqual(["superseded", "live"]);
  });

  it("refuses a replacement and a retry once submissions close", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    await submittedImage(h, school.forStudent(1));
    await submittedImage(h, school.forStudent(2), { bytes: EICAR_TEST_BYTES });
    await h.drain();
    const [closes] = await h.db
      .select({ at: competitionKeyDate.at })
      .from(competitionKeyDate)
      .where(eq(competitionKeyDate.kind, "submissions_close"));
    h.clock.set(closes!.at);

    for (const registrationId of school.registrationIds) {
      expect(
        await h.as(school.coordinator.actor).startEntryUpload({
          registrationId,
          discipline: "photography",
          file: FILE,
        })
      ).toEqual({ ok: false, error: "deadline_passed" });
    }
  });
});

describe("upload allowances", () => {
  it("lets a coordinator upload for a class in one sitting, one unfinished upload per student", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h, { students: 8 });

    for (let n = 1; n <= 8; n++) {
      expect(await submitImage(h, school.forStudent(n))).toMatchObject({
        ok: true,
        status: "processing",
      });
      h.clock.advance({ seconds: 30 });
    }
    const app = h.as(school.coordinator.actor);
    const first = await app.startEntryUpload({
      registrationId: school.registrationIds[0]!,
      discipline: "photography",
      file: FILE,
    });
    expect(first).toMatchObject({ ok: true });
    expect(
      await app.startEntryUpload({
        registrationId: school.registrationIds[0]!,
        discipline: "photography",
        file: FILE,
      })
    ).toEqual({ ok: false, error: "upload_limit" });
  });
});

describe("the family's receipt", () => {
  it("tells a minor's guardian the Entry ID once the entry is submitted, and nobody else", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const code = await submittedImage(h, school.forStudent(1));
    const sentBefore = h.email.sent.length;
    const inboxBefore = await h.db.select().from(inboxItem);

    await h.drain();

    const sent = h.email.sent.slice(sentBefore);
    expect(sent.map((mail) => mail.to)).toEqual([guardianEmail(1)]);
    expect(sent[0]!.subject).toContain(code);
    expect(sent[0]!.text).toContain(code);
    expect(sent[0]!.text).toContain("Student A Rao");
    expect(sent[0]!.text).toContain("Test School");
    expect(await h.db.select().from(inboxItem)).toEqual(inboxBefore);
  });

  it("tells an adult student themselves", async () => {
    const h = await createHarness();
    const college = await schoolWithAdultStudent(h);
    const code = await submittedImage(h, {
      actor: college.coordinator.actor,
      registrationId: college.studentRegistrationId,
    });
    const sentBefore = h.email.sent.length;

    await h.drain();

    const sent = h.email.sent.slice(sentBefore);
    expect(sent.map((mail) => mail.to)).toEqual([ADULT_STUDENT_EMAIL]);
    expect(sent[0]!.text).toContain("Hello Meera Iyer");
    expect(sent[0]!.text).toContain(code);
  });

  it("sends nothing for a replacement going live", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    await submittedImage(h, school.forStudent(1));
    await h.drain();
    const sentBefore = h.email.sent.length;

    await submittedImage(h, school.forStudent(1), {
      bytes: readMediaFixture("rotatedJpeg"),
    });
    await h.drain();

    expect(h.email.sent.slice(sentBefore)).toEqual([]);
  });
});
