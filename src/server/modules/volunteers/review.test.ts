import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, userRole } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import {
  adultApplication,
  applicationInput,
  applicationRow,
  bornYearsAgo,
  declarationEvents,
  openVolunteering,
  publishDeclaration,
  staffActor,
  teenApplication,
  userIdOf,
  volunteerAudit,
  volunteerEvents,
} from "./testing";

async function volunteerGrants(
  h: Awaited<ReturnType<typeof createHarness>>,
  userId: string
) {
  return h.db
    .select()
    .from(userRole)
    .where(and(eq(userRole.userId, userId), eq(userRole.role, "volunteer")));
}

describe("approveVolunteer", () => {
  it("records both declarations and grants the global volunteer role", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await adultApplication(h, declarations);
    const manager = await staffActor(h, "community_manager");

    expect(
      await h
        .as(manager)
        .approveVolunteer({ applicationId: priya.applicationId })
    ).toEqual({ ok: true });

    const [safeguarding] = await declarationEvents(
      h,
      priya.id,
      "volunteer_safeguarding_declaration"
    );
    const [conduct] = await declarationEvents(
      h,
      priya.id,
      "volunteer_code_of_conduct"
    );
    expect(await applicationRow(h, priya.applicationId)).toMatchObject({
      status: "approved",
      safeguardingConsentId: safeguarding!.id,
      conductConsentId: conduct!.id,
      decidedByUserId: userIdOf(manager),
      decidedAt: h.clock.now(),
      closedAt: h.clock.now(),
    });
    expect(await volunteerGrants(h, priya.id)).toMatchObject([
      {
        scopeType: "global",
        scopeId: null,
        grantedByUserId: userIdOf(manager),
      },
    ]);
    const mine = await h.as(priya.actor).myVolunteerApplication();
    expect(mine).toMatchObject({
      isVolunteer: true,
      application: { status: "approved" },
    });
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorUserId, userIdOf(manager)))
      .orderBy(asc(auditLog.id));
    expect(audit.map(({ action, actorRole }) => [action, actorRole])).toEqual(
      [
        ["volunteer.application_approved", "community_manager"],
        ["role.granted", "community_manager"],
      ]
    );
    expect(await volunteerEvents(h)).toContainEqual({
      type: "volunteer.application_approved",
      payload: { applicationId: priya.applicationId },
    });

    // A volunteer doesn't apply again.
    expect(
      await h
        .as(priya.actor)
        .applyToVolunteer(
          applicationInput(declarations, { dateOfBirth: bornYearsAgo(h, 30) })
        )
    ).toEqual({ ok: false, error: "already_volunteer" });
  });

  it("refuses a declaration given on a version staff have since replaced, until the applicant accepts the new one", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await adultApplication(h, declarations);
    const manager = await staffActor(h, "community_manager");
    const conduct = await publishDeclaration(h, "volunteer_code_of_conduct");

    expect(
      await h
        .as(manager)
        .approveVolunteer({ applicationId: priya.applicationId })
    ).toEqual({ ok: false, error: "code_of_conduct_outdated" });
    expect(await applicationRow(h, priya.applicationId)).toMatchObject({
      status: "submitted",
      decidedAt: null,
    });
    expect(await volunteerGrants(h, priya.id)).toEqual([]);
    expect(
      (await h.as(priya.actor).myVolunteerApplication()).application
        ?.declarations
    ).toEqual({ safeguarding: "current", conduct: "outdated" });

    expect(
      await h.as(priya.actor).acceptVolunteerDeclarations({
        safeguardingDocumentId: declarations.safeguarding,
        conductDocumentId: declarations.conduct,
      })
    ).toEqual({ ok: false, error: "declaration_outdated" });
    expect(
      await h.as(priya.actor).acceptVolunteerDeclarations({
        safeguardingDocumentId: declarations.safeguarding,
        conductDocumentId: conduct,
      })
    ).toEqual({ ok: true, changed: true });
    expect(
      await h
        .as(manager)
        .approveVolunteer({ applicationId: priya.applicationId })
    ).toEqual({ ok: true });
  });

  it("refuses an application still waiting for the guardian", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { applicationId } = await teenApplication(h, declarations);
    const manager = await staffActor(h, "community_manager");

    expect(await h.as(manager).approveVolunteer({ applicationId })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(await applicationRow(h, applicationId)).toMatchObject({
      status: "awaiting_guardian",
    });
  });

  it("needs a second factor passed within the step-up window", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await adultApplication(h, declarations);
    const manager = await staffActor(h, "community_manager");
    h.clock.advance({ minutes: 11 });

    await expect(
      h.as(manager).approveVolunteer({ applicationId: priya.applicationId })
    ).rejects.toMatchObject({ code: "step_up_required" });
    expect(await applicationRow(h, priya.applicationId)).toMatchObject({
      status: "submitted",
    });

    await h.passSecondFactor(manager);
    expect(
      await h
        .as(manager)
        .approveVolunteer({ applicationId: priya.applicationId })
    ).toEqual({ ok: true });
  });

  it("approves a teen's application once their guardian has, telling no one it shouldn't", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { guardian, teen, applicationId } = await teenApplication(
      h,
      declarations
    );
    await h
      .as(guardian.actor)
      .decideAsGuardian({ applicationId, decision: "approve" });
    const admin = await staffActor(h, "super_admin");

    expect(await h.as(admin).approveVolunteer({ applicationId })).toEqual({
      ok: true,
    });
    expect(await volunteerGrants(h, teen.id)).toHaveLength(1);
  });
});

describe("declineVolunteer", () => {
  it("closes the application with the reason the applicant is told", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await adultApplication(h, declarations);
    const manager = await staffActor(h, "community_manager");

    expect(
      await h.as(manager).declineVolunteer({
        applicationId: priya.applicationId,
        reason: "  We have no openings in your city yet.  ",
      })
    ).toEqual({ ok: true });

    expect(await applicationRow(h, priya.applicationId)).toMatchObject({
      status: "declined",
      decidedByUserId: userIdOf(manager),
      closedAt: h.clock.now(),
    });
    expect(
      (await h.as(priya.actor).myVolunteerApplication()).application
    ).toMatchObject({
      status: "declined",
      declineReason: "We have no openings in your city yet.",
    });
    const audit = (await volunteerAudit(h)).at(-1);
    expect(audit).toMatchObject({
      action: "volunteer.application_declined",
      actorRole: "community_manager",
    });
    expect(JSON.stringify(audit)).not.toContain("openings");
    expect(await volunteerEvents(h)).toContainEqual({
      type: "volunteer.application_declined",
      payload: { applicationId: priya.applicationId },
    });
    expect(await volunteerGrants(h, priya.id)).toEqual([]);
  });

  it("needs a reason of 1 to 500 characters, and a submitted application", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await adultApplication(h, declarations);
    const manager = await staffActor(h, "community_manager");

    for (const reason of ["   ", "x".repeat(501)]) {
      expect(
        await h
          .as(manager)
          .declineVolunteer({ applicationId: priya.applicationId, reason })
      ).toEqual({ ok: false, error: "invalid_input", fields: ["reason"] });
    }
    await h
      .as(manager)
      .declineVolunteer({ applicationId: priya.applicationId, reason: "No." });
    expect(
      await h
        .as(manager)
        .declineVolunteer({ applicationId: priya.applicationId, reason: "No." })
    ).toEqual({ ok: false, error: "invalid_transition" });
    expect(
      await h.as(manager).approveVolunteer({
        applicationId: priya.applicationId,
      })
    ).toEqual({ ok: false, error: "invalid_transition" });
  });
});

describe("the community team's queue", () => {
  it("lists applications waiting for a decision, oldest first, and filters by status", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await adultApplication(h, declarations);
    h.clock.advance({ minutes: 1 });
    const ravi = await adultApplication(h, declarations, {
      name: "Ravi Kumar",
      email: "ravi@example.test",
    });
    const { applicationId: teenApplicationId } = await teenApplication(
      h,
      declarations
    );
    const manager = await staffActor(h, "community_manager");

    const waiting = await h.as(manager).listVolunteerApplications();
    expect(waiting).toMatchObject({
      ok: true,
      items: [
        {
          id: priya.applicationId,
          applicant: { id: priya.id, name: "Priya Nair" },
          ageYears: 30,
          interests: ["technology", "outreach"],
          status: "submitted",
        },
        { id: ravi.applicationId, applicant: { name: "Ravi Kumar" } },
      ],
    });
    expect(
      await h
        .as(manager)
        .listVolunteerApplications({ status: "awaiting_guardian" })
    ).toMatchObject({
      ok: true,
      items: [{ id: teenApplicationId, ageYears: 15 }],
    });
    expect(
      await h.as(manager).listVolunteerApplications({ status: "open" })
    ).toEqual({ ok: false, error: "invalid_input", fields: ["status"] });
  });

  it("shows one application with the applicant, their age, the guardian's decision and the declarations", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { guardian, teen, applicationId } = await teenApplication(
      h,
      declarations
    );
    await h
      .as(guardian.actor)
      .decideAsGuardian({ applicationId, decision: "approve" });
    const manager = await staffActor(h, "community_manager");

    expect(
      await h.as(manager).getVolunteerApplication({ applicationId })
    ).toMatchObject({
      ok: true,
      application: {
        id: applicationId,
        status: "submitted",
        applicant: { id: teen.id, name: "Arjun Rao", email: "arjun@example.test" },
        ageYears: 15,
        minor: true,
        guardian: { name: "Sunita Rao", decidedAt: h.clock.now() },
        declarations: { safeguarding: "current", conduct: "current" },
        decidedBy: null,
      },
    });
    expect(
      await h.as(manager).getVolunteerApplication({
        applicationId: "01938a00-0000-7000-8000-00000000ffff",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});
