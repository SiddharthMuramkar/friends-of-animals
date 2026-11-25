import { describe, expect, it } from "vitest";

import { submittedImage } from "@/server/modules/entries/testing";
import {
  ADULT_STUDENT_EMAIL,
  schoolWithAdultStudent,
} from "@/server/modules/institution-submissions/testing";
import { guardianEmail } from "@/server/modules/payments/testing";
import { createHarness, type Harness } from "@/test/harness";

import { categoryOf, enterSchoolJudging, schoolInJudging } from "./testing";

// #89: once a round is finalised, each family hears whether their child's
// entry was shortlisted for FOA judging. On the school route the family
// contact is a minor's guardian, or the adult student: a minor is never
// told directly. Email only (SMS waits for DLT templates, HR-14).

const PANEL = [{ fullName: "Lata Kulkarni", designation: "Art teacher" }];

const ref = (school: { institutionId: string; reference: string }) => ({
  institutionId: school.institutionId,
  reference: school.reference,
});

async function sinceNow(h: Harness, run: () => Promise<unknown>) {
  const before = h.email.sent.length;
  await run();
  return h.email.sent.slice(before);
}

describe("telling families the school round's outcome", () => {
  it("tells each shortlisted and each not-shortlisted minor's guardian, once", async () => {
    const h = await createHarness();
    const school = await schoolInJudging(h, { students: 3, submit: [1, 2, 3] });
    const coordinator = h.as(school.coordinator.actor);
    await coordinator.recordPanel({ ...school.ref, members: PANEL });
    await coordinator.certifyConduct(school.ref);
    await coordinator.saveShortlist({
      ...school.ref,
      categoryId: await categoryOf(h, school, "photography"),
      picks: [
        { entryId: school.entryIds[1]!, position: 1 },
        { entryId: school.entryIds[2]!, position: null },
      ],
    });
    await coordinator.finaliseSchoolRound({
      ...school.ref,
      judgingAttested: true,
    });

    const sent = await sinceNow(h, () => h.drain());

    expect(sent.map((message) => message.to).sort()).toEqual([
      guardianEmail(1),
      guardianEmail(2),
      guardianEmail(3),
    ]);
    const first = h.email.lastTo(guardianEmail(1))!;
    expect(first.subject).toMatch(
      /^Entry PAWS27-E-\w+ shortlisted for FOA judging$/
    );
    expect(first.text).toContain("Student A Rao");
    expect(first.text).toContain("Test School");
    expect(first.text).toContain("placed it 1st in its category");
    const second = h.email.lastTo(guardianEmail(2))!;
    expect(second.subject).toMatch(/shortlisted for FOA judging$/);
    expect(second.text).not.toContain("placed it");
    const third = h.email.lastTo(guardianEmail(3))!;
    expect(third.subject).toBe(
      "School judging finished for Paws on the Pavement"
    );
    expect(third.text).toContain("was not on the school's shortlist");

    expect(await sinceNow(h, () => h.drain())).toEqual([]);
  });

  it("tells an adult student directly", async () => {
    const h = await createHarness();
    const school = await schoolWithAdultStudent(h);
    await submittedImage(h, {
      actor: school.coordinator.actor,
      registrationId: school.studentRegistrationId,
    });
    await h.drain();
    await enterSchoolJudging(h, school.competition.id);
    const coordinator = h.as(school.coordinator.actor);
    await coordinator.recordPanel({ ...ref(school), members: PANEL });
    await coordinator.certifyConduct(ref(school));
    await coordinator.finaliseSchoolRound({
      ...ref(school),
      judgingAttested: true,
    });

    const sent = await sinceNow(h, () => h.drain());

    expect(sent.map((message) => message.to)).toEqual([ADULT_STUDENT_EMAIL]);
    expect(sent[0]!.text).toContain("Hello Meera Iyer");
  });
});
