import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, participantProfile, registration } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { uuidv7 } from "@/server/ids";
import { signedInStaff } from "@/server/modules/institutions/testing";
import { SEED_COORDINATORS } from "@/server/seed/coordinators";
import { SEED_REGISTRATIONS } from "@/server/seed/registration";
import { SEED_SCOPES } from "@/server/seed/scopes";
import {
  CLEAN_STUDENT_IMPORT_CSV_30,
  SAMPLE_STUDENT_IMPORT_CSV,
} from "@/server/seed/student-import-samples";
import { createHarness, type Harness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";

import { formatStudentImportReport } from "./domain/student-csv";

import {
  AANYA,
  registeredSchool,
  signInCoordinator,
  STUDENT_AGE_CUTOFF,
  STUDENT_AGE_GROUPS,
} from "./testing";

const csv = (text: string) => new TextEncoder().encode(text);

type School = Awaited<ReturnType<typeof registeredSchool>>;

/** The school's coordinator imports `text` into its registration. */
function importAs(h: Harness, school: School, text: string) {
  return h.as(school.coordinator.actor).importStudents({
    institutionId: school.institutionId,
    reference: school.reference,
    file: csv(text),
  });
}

const GUARDIAN_HEADER =
  "full_name,date_of_birth,guardian_name,guardian_relationship,guardian_phone";

async function enrolledAudits(h: Harness) {
  return h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "registration.student_enrolled"));
}

async function importAudits(h: Harness) {
  return h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.action, "registration.students_imported"));
}

const NOTHING = { profiles: 0, registrations: 0 };

async function counts(h: Harness) {
  const profiles = await h.db.select().from(participantProfile);
  const registrations = await h.db.select().from(registration);
  return { profiles: profiles.length, registrations: registrations.length };
}

describe("importStudents", () => {
  it("enrols every student of a clean 30-row file, each in their age group", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);

    const result = await h.as(school.coordinator.actor).importStudents({
      institutionId: school.institutionId,
      reference: school.reference,
      file: csv(CLEAN_STUDENT_IMPORT_CSV_30),
    });

    expect(result).toMatchObject({
      ok: true,
      counts: {
        total: 30,
        enrolled: 30,
        notEnrolled: 0,
        invalid: 0,
        duplicateInFile: 0,
        alreadyEnrolled: 0,
      },
      notEnrolled: [],
    });
    expect(await counts(h)).toEqual({ profiles: 30, registrations: 30 });
    const rows = await h.db
      .select({
        status: registration.status,
        ageGroupId: registration.ageGroupId,
        institutionRegistrationId: registration.institutionRegistrationId,
      })
      .from(registration);
    expect(new Set(rows.map((row) => row.status))).toEqual(
      new Set(["enrolled"])
    );
    expect(new Set(rows.map((row) => row.institutionRegistrationId))).toEqual(
      new Set([school.registrationId])
    );
    // On the 1 June 2027 cut-off: the 15 born up to 19 May 2017 are 10 to
    // 12, the 15 born from 28 July 2017 are 7 to 9.
    const byGroup = (label: string) =>
      rows.filter((row) => row.ageGroupId === school.group(label).id).length;
    expect({ "6–9": byGroup("6–9"), "10–13": byGroup("10–13") }).toEqual({
      "6–9": 15,
      "10–13": 15,
    });
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "registration.student_enrolled"))
    ).toHaveLength(30);
  });

  it("enrols the good rows of a mixed file and names each bad row, its cells and #75's problems, writing nothing for them", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const rows = [
      "Aanya Rao,2017-06-01,Kavita Rao,parent,90000 00301",
      ",2017-06-01,Kavita Rao,parent,90000 00301",
      "Kabir Shah,31/02/2016,Meena Shah,parent,90000 00302",
      "Tara Sen,2027-03-01,Rita Sen,parent,90000 00303",
      "Dev Nair,2018-01-10,Lata Nair,uncle,12345",
      "Vikram Rao,2013-06-01,Kavita Rao,parent,90000 00301",
      "Ishaan Rao,2019-02-02,Kavita Rao,parent,90000 00301,Class 2",
      "Meera Iyer,2020-03-04,Lakshmi Iyer,legal guardian,90000 00305",
    ];

    const result = await importAs(
      h,
      school,
      [GUARDIAN_HEADER, ...rows].join("\r\n")
    );

    const cells = (row: number) => rows[row - 2]!.split(",").slice(0, 5);
    expect(result).toEqual({
      ok: true,
      counts: {
        total: 8,
        enrolled: 2,
        notEnrolled: 6,
        invalid: 6,
        duplicateInFile: 0,
        alreadyEnrolled: 0,
      },
      header: GUARDIAN_HEADER.split(","),
      ignoredColumns: [],
      notEnrolled: [
        {
          rowNumber: 3,
          cells: cells(3),
          problems: [{ field: "fullName", code: "required" }],
        },
        {
          rowNumber: 4,
          cells: cells(4),
          problems: [{ field: "dateOfBirth", code: "invalid_date" }],
        },
        {
          rowNumber: 5,
          cells: cells(5),
          problems: [{ field: "dateOfBirth", code: "in_future" }],
        },
        {
          rowNumber: 6,
          cells: cells(6),
          problems: [
            { field: "guardianRelationship", code: "invalid_choice" },
            { field: "guardianPhone", code: "invalid_phone" },
          ],
        },
        {
          rowNumber: 7,
          cells: cells(7),
          problems: [
            {
              field: "dateOfBirth",
              code: "outside_age_groups",
              age: 14,
              groups: STUDENT_AGE_GROUPS.map((group) => ({
                ...group,
                id: school.group(group.label).id,
              })),
              ageCutoffDate: STUDENT_AGE_CUTOFF,
            },
          ],
        },
        { rowNumber: 8, cells: cells(8), problems: [{ code: "extra_cells" }] },
      ],
    });
    expect(await counts(h)).toEqual({ profiles: 2, registrations: 2 });
    const names = await h.db
      .select({ fullName: participantProfile.fullName })
      .from(participantProfile);
    expect(names.map((each) => each.fullName).toSorted()).toEqual([
      "Aanya Rao",
      "Meera Iyer",
    ]);
    expect(await enrolledAudits(h)).toHaveLength(2);
  });

  describe("the same student twice", () => {
    it("enrols the first row for a child and reports later rows against it, by identity or roll number", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);

      const result = await importAs(
        h,
        school,
        [
          `student_ref,${GUARDIAN_HEADER}`,
          "4B-07,Aanya  Rao,2016-03-09,Kavita Rao,parent,90000 00301",
          ",aanyá rao,09/03/2016,Kavita Rao,parent,90000 00301",
          " 4b-07 ,Anya R,2016-04-10,Kavita Rao,parent,90000 00301",
          ",Ishaan Rao,2016-03-09,Kavita Rao,parent,90000 00301",
        ].join("\r\n")
      );

      expect(result).toMatchObject({
        ok: true,
        counts: { total: 4, enrolled: 2, duplicateInFile: 2 },
        notEnrolled: [
          {
            rowNumber: 3,
            problems: [{ code: "duplicate_in_file", duplicateOf: 2 }],
          },
          {
            rowNumber: 4,
            problems: [{ code: "duplicate_in_file", duplicateOf: 2 }],
          },
        ],
      });
      expect(await counts(h)).toEqual({ profiles: 2, registrations: 2 });
    });

    it("reports a child already enrolled, even when the file has them twice, and keeps them to one registration", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      await h.as(school.coordinator.actor).enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: AANYA,
      });

      const result = await importAs(
        h,
        school,
        [
          GUARDIAN_HEADER,
          " aanyá  RAO,01/06/2017,Kavita Rao,parent,90000 00301",
          "Aanya Rao,2017-06-01,Kavita Rao,parent,90000 00301",
          "Ishaan Rao,2017-06-01,Kavita Rao,parent,90000 00301",
        ].join("\r\n")
      );

      expect(result).toMatchObject({
        ok: true,
        counts: { total: 3, enrolled: 1, alreadyEnrolled: 2 },
        notEnrolled: [
          { rowNumber: 2, problems: [{ code: "already_enrolled" }] },
          { rowNumber: 3, problems: [{ code: "already_enrolled" }] },
        ],
      });
      expect(await counts(h)).toEqual({ profiles: 2, registrations: 2 });
    });

    it("enrols a child again whose earlier enrolment was withdrawn", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const coordinator = h.as(school.coordinator.actor);
      const first = await coordinator.enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: AANYA,
      });
      if (!first.ok) throw new Error(first.error);
      await coordinator.withdrawStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        registrationId: first.registrationId,
      });

      const result = await importAs(
        h,
        school,
        `${GUARDIAN_HEADER}\r\nAanya Rao,2017-06-01,Kavita Rao,parent,90000 00301`
      );

      expect(result).toMatchObject({ ok: true, counts: { enrolled: 1 } });
      const live = await h.db
        .select({ status: registration.status })
        .from(registration);
      expect(live.map((each) => each.status).toSorted()).toEqual([
        "enrolled",
        "withdrawn",
      ]);
      expect(await counts(h)).toEqual({ profiles: 1, registrations: 2 });
    });
  });

  describe("uploading again", () => {
    const FILE = [
      GUARDIAN_HEADER,
      "Aanya Rao,2017-06-01,Kavita Rao,parent,+91 90000 00301",
      "Kabir Shah,31/02/2016,Meena Shah,parent,+91 90000 00302",
      "Meera Iyer,2020-03-04,Lakshmi Iyer,legal guardian,",
      "Ishaan Rao,2019-02-02,Kavita Rao,parent,+91 90000 00301",
    ].join("\r\n");

    it("enrols exactly the fixed rows of the downloaded report", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const first = await importAs(h, school, FILE);
      if (!first.ok) throw new Error(first.error);
      const report = formatStudentImportReport(
        first.header,
        first.notEnrolled.map((row) => ({
          rowNumber: row.rowNumber,
          cells: row.cells,
          problems: row.problems.map((problem) => problem.code),
        }))
      );
      // The phones went out neutralised, as a spreadsheet must see them.
      expect(report).toContain("'+91 90000 00302");

      const fixed = report
        .replace("31/02/2016", "28/02/2016")
        .replace("legal guardian,", "legal guardian,90000 00305");
      const again = await importAs(h, school, fixed);

      expect(first).toMatchObject({ counts: { enrolled: 2, invalid: 2 } });
      expect(again).toMatchObject({
        ok: true,
        counts: { total: 2, enrolled: 2, notEnrolled: 0 },
      });
      expect(await counts(h)).toEqual({ profiles: 4, registrations: 4 });
      const [kabir] = await h.db
        .select()
        .from(participantProfile)
        .where(eq(participantProfile.fullName, "Kabir Shah"));
      // The quote put in front for the spreadsheet came off again.
      expect(
        h.deps.cipher.decrypt(
          "participant_profile.guardian_phone",
          kabir!.guardianPhoneCiphertext!
        )
      ).toBe("+919000000302");
    });

    it("enrols nobody from the whole file again, reporting every earlier good row as already enrolled", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      await importAs(h, school, FILE);

      const again = await importAs(h, school, FILE);

      expect(again).toMatchObject({
        ok: true,
        counts: { total: 4, enrolled: 0, invalid: 2, alreadyEnrolled: 2 },
      });
      expect(
        again.ok &&
          again.notEnrolled
            .filter((row) => row.problems[0]?.code === "already_enrolled")
            .map((row) => row.rowNumber)
      ).toEqual([2, 5]);
      expect(await counts(h)).toEqual({ profiles: 2, registrations: 2 });
    });
  });

  describe("the audit log", () => {
    it("records each import once, by counts alone, with who did it and from where; each student as by hand", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h, {
        coordinatorMeta: { ip: "198.51.100.7", userAgent: "Staffroom browser" },
      });

      await importAs(
        h,
        school,
        [
          GUARDIAN_HEADER,
          "Aanya Rao,2017-06-01,Kavita Rao,parent,90000 00301",
          ",2017-06-01,Kavita Rao,parent,90000 00301",
        ].join("\r\n")
      );

      expect(await importAudits(h)).toEqual([
        expect.objectContaining({
          actorKind: "user",
          actorUserId: school.coordinator.userId,
          actorRole: "institution_coordinator",
          entityType: "institution_registration",
          entityId: school.registrationId,
          before: null,
          after: {
            institutionRegistrationId: school.registrationId,
            total: 2,
            enrolled: 1,
            notEnrolled: 1,
            invalid: 1,
            duplicateInFile: 0,
            alreadyEnrolled: 0,
          },
          ip: "198.51.100.7",
          userAgent: "Staffroom browser",
          occurredAt: h.clock.now(),
        }),
      ]);
      const [profile] = await h.db.select().from(participantProfile);
      expect(await enrolledAudits(h)).toEqual([
        expect.objectContaining({
          actorUserId: school.coordinator.userId,
          entityType: "registration",
          after: expect.objectContaining({
            participantProfileId: profile!.id,
            institutionRegistrationId: school.registrationId,
            status: "enrolled",
          }),
        }),
      ]);
      // No names or details in either.
      const logged = JSON.stringify(await h.db.select().from(auditLog));
      expect(logged).not.toContain("Aanya");
      expect(logged).not.toContain("Kavita");
      expect(logged).not.toContain("2017-06-01");
    });

    it("records an import that enrolled nobody", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);

      await importAs(h, school, `${GUARDIAN_HEADER}\r\n,2017-06-01,,,`);

      expect(await importAudits(h)).toMatchObject([
        { after: { total: 1, enrolled: 0, invalid: 1 } },
      ]);
    });
  });

  it("reports a row enrolled meanwhile by another route as already enrolled, and commits the rest", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const coordinator = h.as(school.coordinator.actor);
    const first = await coordinator.enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: AANYA,
    });
    if (!first.ok) throw new Error(first.error);
    await coordinator.withdrawStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      registrationId: first.registrationId,
    });
    // The same child's profile, taking part in the competition by a route
    // the duplicate check doesn't look at: only the one-live-registration
    // index sees it, as when another enrolment wins a race.
    const [profile] = await h.db.select().from(participantProfile);
    await h.db.insert(registration).values({
      id: uuidv7(h.clock.now()),
      participantProfileId: profile!.id,
      competitionId: school.competition.id,
      route: "individual",
      ageGroupId: school.group("10–13").id,
      status: "enrolled",
      createdAt: h.clock.now(),
      updatedAt: h.clock.now(),
    });
    const auditsBefore = (await enrolledAudits(h)).length;

    const result = await importAs(
      h,
      school,
      [
        GUARDIAN_HEADER,
        "Aanya Rao,2017-06-01,Kavita Rao,parent,90000 00301",
        "Meera Iyer,2020-03-04,Lakshmi Iyer,parent,90000 00305",
      ].join("\r\n")
    );

    expect(result).toMatchObject({
      ok: true,
      counts: { total: 2, enrolled: 1, alreadyEnrolled: 1 },
      notEnrolled: [{ rowNumber: 2, problems: [{ code: "already_enrolled" }] }],
    });
    const live = await h.db
      .select()
      .from(registration)
      .where(
        and(
          eq(registration.participantProfileId, profile!.id),
          ne(registration.status, "withdrawn")
        )
      );
    expect(live).toHaveLength(1);
    // Meera's student_enrolled entry only: Aanya's rolled back with her row.
    expect(await enrolledAudits(h)).toHaveLength(auditsBefore + 1);
    expect(await importAudits(h)).toMatchObject([
      { after: { enrolled: 1, alreadyEnrolled: 1 } },
    ]);
  });

  describe("a file it can't read", () => {
    it.each([
      ["empty", "", { code: "empty" }],
      [
        "missing the date of birth column",
        "full_name,grade\r\nAanya Rao,Class 4",
        { code: "missing_columns", columns: ["date_of_birth"] },
      ],
      ["the header alone", "full_name,date_of_birth\r\n", { code: "no_rows" }],
      [
        "separated by semicolons",
        "full_name;date_of_birth\r\nAanya Rao;2017-06-01",
        { code: "wrong_separator", separator: ";" },
      ],
    ])("refuses a file %s and writes nothing", async (_case, text, problem) => {
      const h = await createHarness();
      const school = await registeredSchool(h);

      const result = await importAs(h, school, text);

      expect(result).toEqual({ ok: false, error: "unreadable_file", problem });
      expect(await counts(h)).toEqual(NOTHING);
      expect(await importAudits(h)).toEqual([]);
    });

    it("refuses a file Excel saved as Windows-1252, not UTF-8", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      // "Zoë" with ë as the single byte 0xEB.
      const bytes = Uint8Array.from([
        ...new TextEncoder().encode("full_name,date_of_birth\r\nZo"),
        0xeb,
        ...new TextEncoder().encode(",2017-06-01\r\n"),
      ]);

      const result = await h.as(school.coordinator.actor).importStudents({
        institutionId: school.institutionId,
        reference: school.reference,
        file: bytes,
      });

      expect(result).toEqual({
        ok: false,
        error: "unreadable_file",
        problem: { code: "not_utf8" },
      });
      expect(await counts(h)).toEqual(NOTHING);
    });

    it("refuses more than 1,000 students in one file", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const rows = Array.from(
        { length: 1001 },
        (_, n) => `Student ${n},2017-06-01`
      );

      const result = await importAs(
        h,
        school,
        ["full_name,date_of_birth", ...rows].join("\r\n")
      );

      expect(result).toEqual({
        ok: false,
        error: "unreadable_file",
        problem: { code: "too_many_rows", maxRows: 1000, rows: 1001 },
      });
      expect(await importAudits(h)).toEqual([]);
    });

    // A small file can still name a huge number of columns or rows; each is
    // refused before a row is read, or one upload runs the server out of
    // memory.
    it("refuses 150,000 columns in a file under the size limit, writing nothing", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const header = "full_name,date_of_birth" + ",x".repeat(150_000);
      const rows = Array.from({ length: 30_000 }, (_, n) => `N${n},1`);

      const result = await importAs(h, school, [header, ...rows].join("\r\n"));

      expect(result).toEqual({
        ok: false,
        error: "unreadable_file",
        problem: { code: "too_many_columns", maxColumns: 40, columns: 150_002 },
      });
      expect(await counts(h)).toEqual(NOTHING);
      expect(await importAudits(h)).toEqual([]);
    });

    it("refuses 30,000 rows under a header padded with 150,000 blank cells, writing nothing", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const header = "full_name,date_of_birth" + ",".repeat(150_000);
      const rows = Array.from({ length: 30_000 }, () => "x,1");

      const result = await importAs(h, school, [header, ...rows].join("\r\n"));

      expect(result).toEqual({
        ok: false,
        error: "unreadable_file",
        problem: { code: "too_many_rows", maxRows: 1000, rows: 30_000 },
      });
      expect(await counts(h)).toEqual(NOTHING);
      expect(await importAudits(h)).toEqual([]);
    });

    it("reads a header padded with 300,000 blank cells as its named columns alone", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const header = "full_name,date_of_birth" + ",".repeat(300_000);
      const rows = Array.from({ length: 1000 }, (_, n) => `N${n},1`);
      const text = [header, ...rows].join("\r\n");
      expect(csv(text).length).toBeLessThanOrEqual(750 * 1024);

      const result = await importAs(h, school, text);

      expect(result).toMatchObject({
        ok: true,
        counts: { total: 1000, enrolled: 0, invalid: 1000 },
        header: ["full_name", "date_of_birth"],
        ignoredColumns: [],
      });
      expect(
        result.ok && result.notEnrolled.every((row) => row.cells.length === 2)
      ).toBe(true);
      expect(await counts(h)).toEqual(NOTHING);
    });
  });

  describe("the registration it is for", () => {
    const ONE = `${GUARDIAN_HEADER}\r\nAanya Rao,2017-06-01,Kavita Rao,parent,90000 00301`;

    it("refuses before registration opens and after it closes, writing nothing", async () => {
      const h = await createHarness();
      const { institution: x } = await seedInstitution(h);
      const { actor } = await signInCoordinator(h, x.id);
      const published = await h.seed.competition({
        status: "published",
        participation: "institutions",
        ageGroups: STUDENT_AGE_GROUPS,
        ageCutoffDate: STUDENT_AGE_CUTOFF,
      });
      const early = await h.seed.institutionRegistration({
        institutionId: x.id,
        competitionId: published.id,
      });
      const school = await registeredSchool(h, { name: "Late School" });

      const before = await h.as(actor).importStudents({
        institutionId: x.id,
        reference: early.reference,
        file: csv(ONE),
      });
      // openCompetition's registration closes 55 days after the clock.
      h.clock.advance({ days: 56 });
      await h.drain();
      const after = await importAs(h, school, ONE);

      expect(before).toEqual({ ok: false, error: "not_open_yet" });
      expect(after).toEqual({ ok: false, error: "closed" });
      expect(await counts(h)).toEqual(NOTHING);
      expect(await importAudits(h)).toEqual([]);
    });

    it("finds no registration under an unknown reference, or another institution's", async () => {
      const h = await createHarness();
      const x = await registeredSchool(h, { name: "X" });
      const y = await registeredSchool(h, { name: "Y" });

      for (const reference of ["NOPE27-I-00000", y.reference]) {
        expect(
          await h.as(x.coordinator.actor).importStudents({
            institutionId: x.institutionId,
            reference,
            file: csv(ONE),
          })
        ).toEqual({ ok: false, error: "not_found" });
      }
      expect(await counts(h)).toEqual(NOTHING);
      expect(await importAudits(h)).toEqual([]);
    });
  });

  describe("who may import", () => {
    const ONE = `${GUARDIAN_HEADER}\r\nAanya Rao,2017-06-01,Kavita Rao,parent,90000 00301`;

    it("lets the institution's authorised person import", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const authorisedPerson = await h.signIn(school.admin);

      const result = await h.as(authorisedPerson).importStudents({
        institutionId: school.institutionId,
        reference: school.reference,
        file: csv(ONE),
      });

      expect(result).toMatchObject({ ok: true, counts: { enrolled: 1 } });
    });

    const OUTSIDERS: [string, (h: Harness) => Promise<Actor>][] = [
      [
        "a coordinator of another institution",
        async (h) => {
          const { institution: y } = await seedInstitution(h, { name: "Y" });
          return (await signInCoordinator(h, y.id)).actor;
        },
      ],
      ["a member", async (h) => h.signIn(await h.seed.member())],
      ["a staff admin", (h) => signedInStaff(h)],
      ["a visitor", async (h) => h.visitor()],
    ];

    it.each(OUTSIDERS)(
      "refuses %s, writing nothing",
      async (_who, actorFor) => {
        const h = await createHarness();
        const school = await registeredSchool(h);
        const actor = await actorFor(h);

        await expect(
          h.as(actor).importStudents({
            institutionId: school.institutionId,
            reference: school.reference,
            file: csv(ONE),
          })
        ).rejects.toThrow(DomainError);
        expect(await counts(h)).toEqual(NOTHING);
        expect(await importAudits(h)).toEqual([]);
      }
    );
  });

  describe("the preview's sample file", () => {
    it("enrols its five good rows into the seeded registration and reports one row for each usual mistake", async () => {
      const h = await createHarness();
      await h.seed.preview();
      const coordinator = await h.signIn(SEED_COORDINATORS.coordinator);
      const importSample = () =>
        h.as(coordinator).importStudents({
          institutionId: SEED_SCOPES.institution.id,
          reference: SEED_REGISTRATIONS.institution.reference,
          file: csv(SAMPLE_STUDENT_IMPORT_CSV),
        });

      const first = await importSample();
      const again = await importSample();

      expect(first).toMatchObject({
        ok: true,
        counts: {
          total: 10,
          enrolled: 5,
          notEnrolled: 5,
          invalid: 3,
          duplicateInFile: 1,
          alreadyEnrolled: 1,
        },
        notEnrolled: [
          {
            rowNumber: 7,
            problems: [{ field: "guardianPhone", code: "required" }],
          },
          {
            rowNumber: 8,
            problems: [{ field: "dateOfBirth", code: "invalid_date" }],
          },
          {
            rowNumber: 9,
            problems: [
              { field: "dateOfBirth", code: "outside_age_groups", age: 4 },
            ],
          },
          {
            rowNumber: 10,
            problems: [{ code: "duplicate_in_file", duplicateOf: 3 }],
          },
          { rowNumber: 11, problems: [{ code: "already_enrolled" }] },
        ],
      });
      expect(again).toMatchObject({
        ok: true,
        counts: { total: 10, enrolled: 0, invalid: 3, alreadyEnrolled: 7 },
      });
    });
  });
});
