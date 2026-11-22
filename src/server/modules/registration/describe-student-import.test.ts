import { describe, expect, it } from "vitest";

import type { Actor } from "@/server/actor";
import { DomainError } from "@/server/errors";
import { signedInStaff } from "@/server/modules/institutions/testing";
import { createHarness, type Harness } from "@/test/harness";
import { seedInstitution } from "@/test/institutions";

import {
  registeredSchool,
  signInCoordinator,
  STUDENT_AGE_CUTOFF,
  STUDENT_AGE_GROUPS,
} from "./testing";

describe("describeStudentImport", () => {
  it("gives the template's 14 columns in order with when each is needed, the limits and the competition", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h, { name: "Lakeside School" });

    const result = await h.as(school.coordinator.actor).describeStudentImport({
      institutionId: school.institutionId,
      reference: school.reference.toLowerCase(),
    });

    expect(result).toEqual({
      ok: true,
      institution: { id: school.institutionId, name: "Lakeside School" },
      competition: {
        code: school.competition.code,
        name: expect.any(String),
        ageCutoffDate: STUDENT_AGE_CUTOFF,
        ageGroups: STUDENT_AGE_GROUPS,
      },
      reference: school.reference,
      enrolment: "open",
      columns: [
        { header: "student_ref", need: "optional" },
        { header: "full_name", need: "always" },
        { header: "date_of_birth", need: "always" },
        { header: "grade", need: "optional" },
        { header: "guardian_name", need: "minor" },
        { header: "guardian_relationship", need: "minor" },
        { header: "guardian_phone", need: "minor" },
        { header: "guardian_email", need: "optional" },
        { header: "student_phone", need: "adult" },
        { header: "student_email", need: "optional" },
        { header: "address", need: "optional" },
        { header: "pin_code", need: "optional" },
        { header: "city", need: "optional" },
        { header: "state", need: "optional" },
      ],
      limits: { maxRows: 1000, maxBytes: 768_000, maxColumns: 40 },
    });
  });

  it("says when students can't be imported now", async () => {
    const h = await createHarness();
    const school = await registeredSchool(h);
    // openCompetition's registration closes 55 days after the clock.
    h.clock.advance({ days: 56 });

    const result = await h.as(school.coordinator.actor).describeStudentImport({
      institutionId: school.institutionId,
      reference: school.reference,
    });

    expect(result).toMatchObject({ ok: true, enrolment: "closed" });
  });

  it("finds no registration under an unknown reference, or another institution's", async () => {
    const h = await createHarness();
    const x = await registeredSchool(h, { name: "X" });
    const y = await registeredSchool(h, { name: "Y" });

    for (const reference of ["NOPE27-I-00000", y.reference]) {
      expect(
        await h.as(x.coordinator.actor).describeStudentImport({
          institutionId: x.institutionId,
          reference,
        })
      ).toEqual({ ok: false, error: "not_found" });
    }
  });

  describe("who may see it", () => {
    it("lets the institution's authorised person see it", async () => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const authorisedPerson = await h.signIn(school.admin);

      const result = await h.as(authorisedPerson).describeStudentImport({
        institutionId: school.institutionId,
        reference: school.reference,
      });

      expect(result).toMatchObject({ ok: true });
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

    it.each(OUTSIDERS)("refuses %s", async (_who, actorFor) => {
      const h = await createHarness();
      const school = await registeredSchool(h);
      const actor = await actorFor(h);

      await expect(
        h.as(actor).describeStudentImport({
          institutionId: school.institutionId,
          reference: school.reference,
        })
      ).rejects.toThrow(DomainError);
    });
  });
});
