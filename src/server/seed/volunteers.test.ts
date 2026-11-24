import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { userRole, volunteerApplication } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_VOLUNTEERS } from "./volunteers";

describe("the volunteers' preview seed", () => {
  it("makes an approved volunteer, an application for the community team and the teen's for his guardian, the same the second time", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const snapshot = async () => ({
      applications: await h.db
        .select({
          id: volunteerApplication.id,
          status: volunteerApplication.status,
          participantProfileId: volunteerApplication.participantProfileId,
        })
        .from(volunteerApplication)
        .orderBy(asc(volunteerApplication.id)),
      volunteers: await h.db
        .select({ userId: userRole.userId })
        .from(userRole)
        .where(eq(userRole.role, "volunteer")),
    });
    const first = await snapshot();
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(first.applications).toEqual([
      {
        id: SEED_VOLUNTEERS.approved.applicationId,
        status: "approved",
        participantProfileId: null,
      },
      {
        id: SEED_VOLUNTEERS.submitted.applicationId,
        status: "submitted",
        participantProfileId: null,
      },
      {
        id: SEED_VOLUNTEERS.teen.applicationId,
        status: "awaiting_guardian",
        participantProfileId: SEED_VOLUNTEERS.teen.profileId,
      },
    ]);
    expect(first.volunteers).toHaveLength(1);
    expect(await snapshot()).toEqual(first);
  });

  it("opens applications, and lets the seeded community manager read the queue and the teen's guardian decide", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const manager = await h.signIn(SEED_VOLUNTEERS.manager);
    const guardian = await h.signIn({ email: "guardian1@example.test" });

    expect(await h.settings.get("volunteers.applicationsOpen")).toBe(true);
    expect(await h.as(manager).listVolunteerApplications()).toMatchObject({
      ok: true,
      items: [
        {
          id: SEED_VOLUNTEERS.submitted.applicationId,
          applicant: { name: "Arjun Mehta" },
          ageYears: 34,
        },
      ],
    });
    expect(
      await h.as(manager).getVolunteerApplication({
        applicationId: SEED_VOLUNTEERS.approved.applicationId,
      })
    ).toMatchObject({
      ok: true,
      application: {
        status: "approved",
        decidedBy: { name: "Neha Kapoor" },
        declarations: { safeguarding: "current", conduct: "current" },
      },
    });
    expect(
      await h.as(guardian).decideAsGuardian({
        applicationId: SEED_VOLUNTEERS.teen.applicationId,
        decision: "approve",
      })
    ).toEqual({ ok: true, status: "submitted" });
  });
});
