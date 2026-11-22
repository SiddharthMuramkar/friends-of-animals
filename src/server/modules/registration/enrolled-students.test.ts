import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { auditLog, registration } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { signedInStaff } from "@/server/modules/institutions/testing";
import {
  enrol as enrolNth,
  openOrder,
  schoolWithStudents,
} from "@/server/modules/payments/testing";
import { createHarness, type Harness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";

import { REGISTRATION_NUMBER } from "./domain/registration-number";
import { AANYA, registeredSchool, signInCoordinator } from "./testing";

type School = Awaited<ReturnType<typeof registeredSchool>>;

/** Enrols `student` as the school's coordinator; its registration id. */
async function enrol(
  h: Harness,
  school: School,
  student: Partial<typeof AANYA> = {}
): Promise<string> {
  const result = await h.as(school.coordinator.actor).enrolStudent({
    institutionId: school.institutionId,
    reference: school.reference,
    student: { ...AANYA, ...student },
  });
  if (!result.ok) throw new Error(result.error);
  return result.registrationId;
}

const BEN = {
  fullName: "ben thomas",
  dateOfBirth: "2020-02-10",
  grade: "Class 1",
};
const ZARA = { fullName: "Zara Khan", dateOfBirth: "2015-09-30", grade: "" };

describe("listEnrolledStudents", () => {
  it("lists the registration's students by name, with grade, age group and status, and counts them by status", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h, {
      competition: { code: "PAWS27", name: "Paws on the Pavement" },
    });
    const zara = await enrol(h, school, ZARA);
    const aanya = await enrol(h, school);
    const ben = await enrol(h, school, BEN);
    await h.as(school.coordinator.actor).withdrawStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      registrationId: ben,
    });

    const result = await h.as(school.coordinator.actor).listEnrolledStudents({
      institutionId: school.institutionId,
      reference: school.reference,
    });

    expect(result).toEqual({
      ok: true,
      institution: { id: school.institutionId, name: "Test School" },
      competition: {
        code: "PAWS27",
        name: "Paws on the Pavement",
        ageCutoffDate: "2027-06-01",
        ageGroups: [
          { label: "6–9", minAge: 6, maxAge: 9 },
          { label: "10–13", minAge: 10, maxAge: 13 },
        ],
      },
      reference: school.reference,
      enrolment: "open",
      counts: {
        enrolled: 2,
        confirmed: 0,
        withdrawn: 1,
        pending_payment: 0,
        refunded: 0,
      },
      students: [
        {
          registrationId: aanya,
          fullName: "Aanya Rao",
          grade: "Class 4",
          ageGroupLabel: "10–13",
          status: "enrolled",
          registrationNumber: null,
        },
        {
          registrationId: ben,
          fullName: "ben thomas",
          grade: "Class 1",
          ageGroupLabel: "6–9",
          status: "withdrawn",
          registrationNumber: null,
        },
        {
          registrationId: zara,
          fullName: "Zara Khan",
          grade: null,
          ageGroupLabel: "10–13",
          status: "enrolled",
          registrationNumber: null,
        },
      ],
    });
  });

  it("starts empty, and says when students can no longer be added", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const list = () =>
      h.as(school.coordinator.actor).listEnrolledStudents({
        institutionId: school.institutionId,
        reference: school.reference,
      });

    const before = await list();
    // openCompetition's registration closes 55 days after the clock.
    h.clock.advance({ days: 56 });
    const after = await list();

    expect(before).toMatchObject({
      ok: true,
      enrolment: "open",
      counts: {
        enrolled: 0,
        confirmed: 0,
        withdrawn: 0,
        pending_payment: 0,
        refunded: 0,
      },
      students: [],
    });
    expect(after).toMatchObject({ ok: true, enrolment: "closed" });
  });

  it("shows each confirmed student's registration number once their fee is paid, and none while it waits", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h, { students: 3 });
    const { batchId, orderId } = await openOrder(school);
    await h.as(school.coordinator.actor).confirmCheckout({
      institutionId: school.institutionId,
      batchId,
      ...h.gateway.capture(orderId),
    });
    await enrolNth(h, school, 4);

    const result = await h.as(school.coordinator.actor).listEnrolledStudents({
      institutionId: school.institutionId,
      reference: school.reference,
    });

    expect(result).toMatchObject({
      ok: true,
      counts: { enrolled: 1, confirmed: 3, withdrawn: 0 },
    });
    const students = result.ok ? result.students : [];
    expect(
      students.map(({ fullName, status, registrationNumber }) => [
        fullName,
        status,
        registrationNumber,
      ])
    ).toEqual([
      [
        "Student A Rao",
        "confirmed",
        expect.stringMatching(REGISTRATION_NUMBER),
      ],
      [
        "Student B Rao",
        "confirmed",
        expect.stringMatching(REGISTRATION_NUMBER),
      ],
      [
        "Student C Rao",
        "confirmed",
        expect.stringMatching(REGISTRATION_NUMBER),
      ],
      ["Student D Rao", "enrolled", null],
    ]);
    expect(new Set(students.map((s) => s.registrationNumber)).size).toBe(4);
  });

  it("reads the reference as a URL or a person may carry it: any case, O for 0", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    await enrol(h, school);
    const typed = ` ${school.reference.toLowerCase().replace(/0/g, "o")} `;

    const result = await h.as(school.coordinator.actor).listEnrolledStudents({
      institutionId: school.institutionId,
      reference: typed,
    });

    expect(result).toMatchObject({
      ok: true,
      reference: school.reference,
      counts: { enrolled: 1 },
    });
  });

  it("finds no registration under an unknown reference, or another institution's", async () => {
    const h = await createHarness();
    const x = await registeredSchool(h, { name: "X" });
    const y = await registeredSchool(h, { name: "Y" });
    await enrol(h, y);

    for (const reference of ["NOPE27-I-00000", y.reference]) {
      expect(
        await h.as(x.coordinator.actor).listEnrolledStudents({
          institutionId: x.institutionId,
          reference,
        })
      ).toEqual({ ok: false, error: "not_found" });
    }
  });
});

describe("withdrawStudent", () => {
  it("withdraws an enrolled student, who can then be enrolled again", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const first = await enrol(h, school);

    const result = await h.as(school.coordinator.actor).withdrawStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      registrationId: first,
    });
    const again = await h.as(school.coordinator.actor).enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: { ...AANYA, guardianPhone: "90000 00310" },
    });

    expect(result).toEqual({ ok: true });
    expect(again).toMatchObject({ ok: true });
    const rows = await h.db
      .select({ id: registration.id, status: registration.status })
      .from(registration);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: first, status: "withdrawn" },
        { id: again.ok && again.registrationId, status: "enrolled" },
      ])
    );
  });

  it("refuses after registration closes", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const registrationId = await enrol(h, school);
    h.clock.advance({ days: 56 });

    const result = await h.as(school.coordinator.actor).withdrawStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      registrationId,
    });

    expect(result).toEqual({ ok: false, error: "closed" });
  });

  it("finds no student under another institution's registration", async () => {
    const h = await createHarness();
    const x = await registeredSchool(h, { name: "X" });
    const y = await registeredSchool(h, { name: "Y" });
    const ofY = await enrol(h, y);

    for (const [reference, registrationId] of [
      [x.reference, ofY],
      [x.reference, "01938a00-0000-7000-8000-00000000dead"],
      [y.reference, ofY],
    ] as const) {
      expect(
        await h.as(x.coordinator.actor).withdrawStudent({
          institutionId: x.institutionId,
          reference,
          registrationId,
        })
      ).toEqual({ ok: false, error: "not_found" });
    }
    expect(
      await h.db
        .select({ status: registration.status })
        .from(registration)
        .where(eq(registration.id, ofY))
    ).toEqual([{ status: "enrolled" }]);
  });
});

describe("the registration statuses, at the use cases", () => {
  // Every ordered pair of enrolled and withdrawn (and none, before the
  // first), with the use case a coordinator would try it with.
  it("∅ -> enrolled: enrolStudent, while registration is open", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const id = await enrol(h, school);
    expect(
      await h.db
        .select({ status: registration.status })
        .from(registration)
        .where(eq(registration.id, id))
    ).toEqual([{ status: "enrolled" }]);
  });

  it("enrolled -> enrolled: refused, the child is already enrolled", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    await enrol(h, school);
    expect(
      await h.as(school.coordinator.actor).enrolStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        student: AANYA,
      })
    ).toEqual({ ok: false, error: "already_enrolled" });
  });

  it("enrolled -> withdrawn: withdrawStudent, while registration is open", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const registrationId = await enrol(h, school);
    expect(
      await h.as(school.coordinator.actor).withdrawStudent({
        institutionId: school.institutionId,
        reference: school.reference,
        registrationId,
      })
    ).toEqual({ ok: true });
  });

  it("withdrawn -> withdrawn: refused, the student is not enrolled", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const registrationId = await enrol(h, school);
    const input = {
      institutionId: school.institutionId,
      reference: school.reference,
      registrationId,
    };
    await h.as(school.coordinator.actor).withdrawStudent(input);
    expect(await h.as(school.coordinator.actor).withdrawStudent(input)).toEqual(
      { ok: false, error: "not_enrolled" }
    );
  });

  it("withdrawn -> enrolled: never; enrolling again makes a new registration and the old one stays withdrawn", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const first = await enrol(h, school);
    await h.as(school.coordinator.actor).withdrawStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      registrationId: first,
    });

    const second = await enrol(h, school);

    expect(second).not.toBe(first);
    expect(
      await h.db
        .select({ status: registration.status })
        .from(registration)
        .where(eq(registration.id, first))
    ).toEqual([{ status: "withdrawn" }]);
  });
});

describe("the audit log", () => {
  it("records a withdrawal by ids, with who did it and from where", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h, {
      coordinatorMeta: { ip: "198.51.100.8", userAgent: "Office laptop" },
    });
    const registrationId = await enrol(h, school);

    await h.as(school.coordinator.actor).withdrawStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      registrationId,
    });

    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "registration.student_withdrawn"))
    ).toEqual([
      expect.objectContaining({
        actorUserId: school.coordinator.userId,
        actorRole: "institution_coordinator",
        entityType: "registration",
        entityId: registrationId,
        before: { status: "enrolled" },
        after: { status: "withdrawn" },
        ip: "198.51.100.8",
        userAgent: "Office laptop",
      }),
    ]);
  });
});

describe("who may see and withdraw students", () => {
  it("lets the institution's authorised person do both", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const registrationId = await enrol(h, school);
    const authorisedPerson = h.as(await h.signIn(school.admin));
    const at = {
      institutionId: school.institutionId,
      reference: school.reference,
    };

    expect(await authorisedPerson.listEnrolledStudents(at)).toMatchObject({
      ok: true,
      counts: { enrolled: 1 },
    });
    expect(
      await authorisedPerson.withdrawStudent({ ...at, registrationId })
    ).toEqual({ ok: true });
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

  it.each(OUTSIDERS)("refuses %s both", async (_who, actorFor) => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    const registrationId = await enrol(h, school);
    const outsider = h.as(await actorFor(h));
    const at = {
      institutionId: school.institutionId,
      reference: school.reference,
    };

    await expect(outsider.listEnrolledStudents(at)).rejects.toThrow(
      DomainError
    );
    await expect(
      outsider.withdrawStudent({ ...at, registrationId })
    ).rejects.toThrow(DomainError);
    expect(
      await h.db.select({ status: registration.status }).from(registration)
    ).toEqual([{ status: "enrolled" }]);
  });
});
