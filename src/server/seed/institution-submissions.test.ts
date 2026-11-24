import { describe, expect, it } from "vitest";

import {
  entry,
  entryFile,
  participantProfile,
  registration,
} from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_COORDINATORS } from "./coordinators";
import { SEED_SCHOOL_SUBMISSIONS } from "./institution-submissions";

const SCHOOL = {
  institutionId: SEED_SCHOOL_SUBMISSIONS.institutionRegistration.institutionId,
  reference: SEED_SCHOOL_SUBMISSIONS.institutionRegistration.reference,
};

describe("the school-route submissions seed", () => {
  it("shows the seeded coordinator a roster with every kind of row", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const coordinator = h.as(await h.signIn(SEED_COORDINATORS.coordinator));

    const roster = await coordinator.listInstitutionSubmissions(SCHOOL);

    expect(roster).toMatchObject({
      ok: true,
      competitionName: "Trees for Birds",
      gate: "open",
      conductCertified: false,
      counts: { total: 6, needingUpload: 3 },
    });
    if (!roster.ok) return;
    expect(
      roster.rows.map(({ studentName, entryCode, status, action, hold }) => ({
        studentName,
        entryCode,
        status,
        action,
        hold,
      }))
    ).toEqual([
      {
        studentName: "Ananya Menon",
        entryCode: "TREES27-E-5EEDC1",
        status: "submitted",
        action: "replace",
        hold: null,
      },
      {
        studentName: "Ishaan Rao",
        entryCode: "TREES27-E-5EEDC2",
        status: "processing",
        action: null,
        hold: null,
      },
      {
        studentName: "Myra Pillai",
        entryCode: "TREES27-E-5EEDC3",
        status: "rejected",
        action: "retry",
        hold: null,
      },
      {
        studentName: "Neel Desai",
        entryCode: null,
        status: "not_started",
        action: "submit",
        hold: null,
      },
      {
        studentName: "Tara Gokhale",
        entryCode: null,
        status: "not_started",
        action: "submit",
        hold: null,
      },
      {
        studentName: "Vihaan Shetty",
        entryCode: null,
        status: "not_started",
        action: null,
        hold: "registration_not_confirmed",
      },
    ]);
    expect(
      await coordinator.getStudentSubmission({
        ...SCHOOL,
        registrationNumber: "TREES27-R-5EEDC1",
      })
    ).toMatchObject({
      ok: true,
      entry: { status: "submitted", picture: { url: expect.any(String) } },
      upload: { mode: "replace", disciplines: ["painting"] },
    });
    expect(await coordinator.getConductCertification(SCHOOL)).toMatchObject({
      ok: true,
      canCertify: true,
      certification: null,
    });
  });

  it("changes nothing when it runs again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const rows = async () => ({
      profiles: await h.db
        .select()
        .from(participantProfile)
        .orderBy(participantProfile.id),
      registrations: await h.db
        .select()
        .from(registration)
        .orderBy(registration.id),
      entries: await h.db.select().from(entry).orderBy(entry.id),
      files: await h.db.select().from(entryFile).orderBy(entryFile.id),
    });
    const first = await rows();

    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(await rows()).toEqual(first);
  });
});
