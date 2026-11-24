import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { guardianLink } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import {
  applicationRow,
  member,
  openVolunteering,
  teenApplication,
  volunteerAudit,
  volunteerEvents,
} from "./testing";

describe("decideAsGuardian", () => {
  it("sends the teen's application to a community manager when their guardian approves", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { guardian, applicationId, profileId } = await teenApplication(
      h,
      declarations
    );
    h.clock.advance({ minutes: 5 });

    expect(
      await h
        .as(guardian.actor)
        .decideAsGuardian({ applicationId, decision: "approve" })
    ).toEqual({ ok: true, status: "submitted" });

    expect(await applicationRow(h, applicationId)).toMatchObject({
      status: "submitted",
      guardianUserId: guardian.id,
      guardianDecidedAt: h.clock.now(),
      closedAt: null,
    });
    const child = await h
      .as(guardian.actor)
      .childVolunteerApplication({ childId: profileId });
    expect(child).toMatchObject({
      ok: true,
      child: { id: profileId, fullName: "Arjun Rao" },
      application: { id: applicationId, status: "submitted" },
    });
    expect(await volunteerEvents(h)).toEqual([
      {
        type: "volunteer.guardian_approval_requested",
        payload: { applicationId },
      },
      { type: "volunteer.application_submitted", payload: { applicationId } },
    ]);
    expect((await volunteerAudit(h)).at(-1)).toMatchObject({
      action: "volunteer.guardian_decided",
      actorUserId: guardian.id,
      actorRole: "guardian",
      entityId: applicationId,
      before: { status: "awaiting_guardian" },
      after: { status: "submitted", decision: "approve" },
    });
  });

  it("closes the application when the guardian declines", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { guardian, teen, applicationId } = await teenApplication(
      h,
      declarations
    );

    expect(
      await h
        .as(guardian.actor)
        .decideAsGuardian({ applicationId, decision: "decline" })
    ).toEqual({ ok: true, status: "guardian_declined" });

    expect(await applicationRow(h, applicationId)).toMatchObject({
      status: "guardian_declined",
      guardianUserId: guardian.id,
      closedAt: h.clock.now(),
    });
    expect(
      (await h.as(teen.actor).myVolunteerApplication()).application
    ).toMatchObject({ status: "guardian_declined" });
    // Nothing reaches the community team.
    expect((await volunteerEvents(h)).map(({ type }) => type)).toEqual([
      "volunteer.guardian_approval_requested",
    ]);
  });

  it("refuses a second decision on the same application", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { guardian, applicationId } = await teenApplication(h, declarations);
    await h
      .as(guardian.actor)
      .decideAsGuardian({ applicationId, decision: "approve" });

    expect(
      await h
        .as(guardian.actor)
        .decideAsGuardian({ applicationId, decision: "decline" })
    ).toEqual({ ok: false, error: "invalid_transition" });
    expect(await applicationRow(h, applicationId)).toMatchObject({
      status: "submitted",
    });
  });

  it("refuses the teen, another child's guardian and a guardian whose link is revoked, changing nothing", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { teen, guardian, applicationId, profileId } = await teenApplication(
      h,
      declarations
    );
    const other = await h.seed.guardian({
      children: [{ fullName: "Meera Iyer", age: 9 }],
    });
    const otherActor = await h.signIn(other.account);
    const stranger = await member(h, {
      name: "Ravi Kumar",
      email: "ravi@example.test",
    });

    for (const actor of [teen.actor, otherActor, stranger.actor]) {
      await expect(
        h.as(actor).decideAsGuardian({ applicationId, decision: "approve" })
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        h.as(actor).childVolunteerApplication({ childId: profileId })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    await h.db
      .update(guardianLink)
      .set({ revokedAt: h.clock.now() })
      .where(eq(guardianLink.participantProfileId, profileId));
    await expect(
      h
        .as(guardian.actor)
        .decideAsGuardian({ applicationId, decision: "approve" })
    ).rejects.toMatchObject({ code: "forbidden" });

    expect(await applicationRow(h, applicationId)).toMatchObject({
      status: "awaiting_guardian",
      guardianUserId: null,
    });
    expect((await volunteerAudit(h)).map(({ action }) => action)).toEqual([
      "volunteer.application_submitted",
    ]);
  });

  it("refuses an application id that doesn't exist like somebody else's", async () => {
    const h = await createHarness();
    await openVolunteering(h);
    const other = await h.seed.guardian({
      children: [{ fullName: "Meera Iyer", age: 15 }],
    });

    await expect(
      h.as(await h.signIn(other.account)).decideAsGuardian({
        applicationId: "01938a00-0000-7000-8000-00000000ffff",
        decision: "approve",
      })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("withdrawVolunteerApplication", () => {
  it("lets the teen's guardian withdraw an open application", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { guardian, applicationId } = await teenApplication(h, declarations);

    expect(
      await h.as(guardian.actor).withdrawVolunteerApplication({ applicationId })
    ).toEqual({ ok: true });

    expect(await applicationRow(h, applicationId)).toMatchObject({
      status: "withdrawn",
      closedAt: h.clock.now(),
    });
    expect((await volunteerAudit(h)).at(-1)).toMatchObject({
      action: "volunteer.application_withdrawn",
      actorUserId: guardian.id,
      after: { status: "withdrawn", by: "guardian" },
    });
  });

  it("lets the applicant withdraw, once", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { teen, applicationId } = await teenApplication(h, declarations);

    expect(
      await h.as(teen.actor).withdrawVolunteerApplication({ applicationId })
    ).toEqual({ ok: true });
    expect(
      await h.as(teen.actor).withdrawVolunteerApplication({ applicationId })
    ).toEqual({ ok: false, error: "invalid_transition" });
    expect((await volunteerAudit(h)).at(-1)).toMatchObject({
      after: { by: "applicant" },
    });
  });

  it("refuses another member and another child's guardian, changing nothing", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { applicationId } = await teenApplication(h, declarations);
    const stranger = await member(h, {
      name: "Ravi Kumar",
      email: "ravi@example.test",
    });
    const other = await h.seed.guardian({
      children: [{ fullName: "Meera Iyer", age: 15 }],
    });

    for (const actor of [stranger.actor, await h.signIn(other.account)]) {
      await expect(
        h.as(actor).withdrawVolunteerApplication({ applicationId })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(
      h.as(h.visitor()).withdrawVolunteerApplication({ applicationId })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await applicationRow(h, applicationId)).toMatchObject({
      status: "awaiting_guardian",
    });
  });
});
