import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  consentEvent,
  guardian,
  guardianLink,
  outbox,
  volunteerApplication,
} from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness, type Harness } from "@/test/harness";

import {
  adultApplication,
  applicationInput,
  applicationRow,
  bornYearsAgo,
  declarationEvents,
  linkedTeen,
  member,
  openVolunteering,
  publishDeclaration,
  volunteerAudit,
  volunteerEvents,
} from "./testing";

const PRIYA = { name: "Priya Nair", email: "priya@example.test" };

/** Nothing about an application was written: no row, consent, job or audit. */
async function expectNothingWritten(h: Harness) {
  expect(await h.db.select().from(volunteerApplication)).toEqual([]);
  expect(await h.db.select().from(consentEvent)).toEqual([]);
  expect(await volunteerEvents(h)).toEqual([]);
  expect(await volunteerAudit(h)).toEqual([]);
}

describe("applyToVolunteer", () => {
  it("sends an adult's application straight to a community manager, with both declarations recorded", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await member(h, PRIYA);

    const result = await h.as(priya.actor).applyToVolunteer(
      applicationInput(declarations, {
        interests: ["technology", "outreach", "technology"],
        dateOfBirth: bornYearsAgo(h, 30),
      })
    );

    expect(result).toEqual({
      ok: true,
      applicationId: expect.any(String),
      status: "submitted",
    });
    if (!result.ok) return;
    const mine = await h.as(priya.actor).myVolunteerApplication();
    expect(mine.application).toMatchObject({
      id: result.applicationId,
      status: "submitted",
      // Kept once each, in the catalogue's order.
      interests: ["technology", "outreach"],
      availability: {
        slots: [
          { day: "wednesday", part: "evening" },
          { day: "saturday", part: "morning" },
        ],
        note: "School holidays too",
      },
      declarations: { safeguarding: "current", conduct: "current" },
    });
    const safeguarding = await declarationEvents(
      h,
      priya.id,
      "volunteer_safeguarding_declaration"
    );
    const conduct = await declarationEvents(
      h,
      priya.id,
      "volunteer_code_of_conduct"
    );
    expect(safeguarding).toMatchObject([
      {
        action: "given",
        documentId: declarations.safeguarding,
        method: "web_form",
        giverUserId: priya.id,
      },
    ]);
    expect(conduct).toMatchObject([
      { action: "given", documentId: declarations.conduct },
    ]);
    expect(await volunteerEvents(h)).toEqual([
      {
        type: "volunteer.application_submitted",
        payload: { applicationId: result.applicationId },
      },
    ]);
    expect(await volunteerAudit(h)).toMatchObject([
      {
        action: "volunteer.application_submitted",
        actorUserId: priya.id,
        entityType: "volunteer_application",
        entityId: result.applicationId,
      },
    ]);
  });

  it("refuses anyone under 14 and writes nothing", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const young = await member(h, PRIYA);

    const result = await h.as(young.actor).applyToVolunteer(
      applicationInput(declarations, {
        // 13 years and 364 days today.
        dateOfBirth: bornYearsAgo(h, 14, -1),
      })
    );

    expect(result).toEqual({ ok: false, error: "under_min_age" });
    await expectNothingWritten(h);
  });

  it("counts a 29 February birthday from 1 March in other years", async () => {
    const h = await createHarness({ now: new Date("2026-02-28T12:00:00Z") });
    const declarations = await openVolunteering(h);
    const leapling = await member(h, PRIYA);
    const input = applicationInput(declarations, {
      dateOfBirth: "2012-02-29",
    });

    expect(await h.as(leapling.actor).applyToVolunteer(input)).toEqual({
      ok: false,
      error: "under_min_age",
    });
    h.clock.advance({ days: 1 });
    // 14 now, so no longer too young: a minor with no guardian to ask.
    expect(await h.as(leapling.actor).applyToVolunteer(input)).toEqual({
      ok: false,
      error: "guardian_required",
    });
  });

  it("holds a 14-year-old's application for their verified guardian, from their birthday", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { teen, profileId } = await linkedTeen(h, { age: 14, days: 0 });

    const result = await h
      .as(teen.actor)
      .applyToVolunteer(applicationInput(declarations));

    expect(result).toEqual({
      ok: true,
      applicationId: expect.any(String),
      status: "awaiting_guardian",
    });
    if (!result.ok) return;
    expect(await applicationRow(h, result.applicationId)).toMatchObject({
      applicantUserId: teen.id,
      participantProfileId: profileId,
      status: "awaiting_guardian",
      guardianUserId: null,
      closedAt: null,
    });
    expect(await volunteerEvents(h)).toEqual([
      {
        type: "volunteer.guardian_approval_requested",
        payload: { applicationId: result.applicationId },
      },
    ]);
  });

  it("refuses a teen the day before their 14th birthday", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { teen } = await linkedTeen(h, { age: 13, days: 364 });

    expect(
      await h.as(teen.actor).applyToVolunteer(applicationInput(declarations))
    ).toEqual({ ok: false, error: "under_min_age" });
    await expectNothingWritten(h);
  });

  it("takes a linked teen's age from the profile their guardian keeps, not a typed date", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { teen } = await linkedTeen(h, { age: 15 });

    const result = await h
      .as(teen.actor)
      .applyToVolunteer(
        applicationInput(declarations, { dateOfBirth: bornYearsAgo(h, 30) })
      );

    expect(result).toMatchObject({ ok: true, status: "awaiting_guardian" });
  });

  it("refuses a minor with no verified guardian to ask, and writes nothing", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const alone = await member(h, PRIYA);
    expect(
      await h
        .as(alone.actor)
        .applyToVolunteer(
          applicationInput(declarations, { dateOfBirth: bornYearsAgo(h, 16) })
        )
    ).toEqual({ ok: false, error: "guardian_required" });

    // A linked teen whose guardian's link is revoked, then one whose
    // guardian never verified.
    const { teen, profileId, guardian: parent } = await linkedTeen(h);
    await h.db
      .update(guardianLink)
      .set({ revokedAt: h.clock.now() })
      .where(eq(guardianLink.participantProfileId, profileId));
    expect(
      await h.as(teen.actor).applyToVolunteer(applicationInput(declarations))
    ).toEqual({ ok: false, error: "guardian_required" });
    await h.db
      .update(guardianLink)
      .set({ revokedAt: null })
      .where(eq(guardianLink.participantProfileId, profileId));
    await h.db
      .update(guardian)
      .set({ verifiedAt: null, verificationMethod: null })
      .where(eq(guardian.userId, parent.id));
    expect(
      await h.as(teen.actor).applyToVolunteer(applicationInput(declarations))
    ).toEqual({ ok: false, error: "guardian_required" });
    await expectNothingWritten(h);
  });

  it("follows the age settings, held to their bounds", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const { teen } = await linkedTeen(h, { age: 15 });

    await h.settings.set("volunteers.minAgeYears", 16);
    expect(
      await h.as(teen.actor).applyToVolunteer(applicationInput(declarations))
    ).toEqual({ ok: false, error: "under_min_age" });

    // An adult of 19 needs a guardian's approval below 21.
    await h.settings.set("volunteers.minAgeYears", 14);
    await h.settings.set("volunteers.guardianApprovalBelowAgeYears", 21);
    const young = await member(h, PRIYA);
    expect(
      await h
        .as(young.actor)
        .applyToVolunteer(
          applicationInput(declarations, { dateOfBirth: bornYearsAgo(h, 19) })
        )
    ).toEqual({ ok: false, error: "guardian_required" });
  });

  it("asks for a date of birth from someone with no participant profile", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await member(h, PRIYA);

    expect(
      await h.as(priya.actor).applyToVolunteer(applicationInput(declarations))
    ).toEqual({ ok: false, error: "date_of_birth_required" });
    expect(
      await h
        .as(priya.actor)
        .applyToVolunteer(
          applicationInput(declarations, { dateOfBirth: "15/01/1990" })
        )
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["dateOfBirth"],
    });
    await expectNothingWritten(h);
  });

  it("refuses an answer that doesn't parse, naming the fields", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await member(h, PRIYA);

    expect(
      await h.as(priya.actor).applyToVolunteer(
        applicationInput(declarations, {
          interests: [],
          availability: { slots: [], note: "x".repeat(281) },
          dateOfBirth: bornYearsAgo(h, 30),
        })
      )
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["interests", "availability"],
    });
    await expectNothingWritten(h);
  });

  it("allows one open application per person, and another once it closes", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const priya = await adultApplication(h, declarations, PRIYA);
    const again = applicationInput(declarations, {
      dateOfBirth: bornYearsAgo(h, 30),
    });

    expect(await h.as(priya.actor).applyToVolunteer(again)).toEqual({
      ok: false,
      error: "application_open",
    });
    expect(
      await h
        .as(priya.actor)
        .withdrawVolunteerApplication({ applicationId: priya.applicationId })
    ).toEqual({ ok: true });
    expect(await h.as(priya.actor).applyToVolunteer(again)).toMatchObject({
      ok: true,
      status: "submitted",
    });
  });

  it("needs both declarations published, and the versions shown to be current", async () => {
    const h = await createHarness();
    await h.settings.set("volunteers.applicationsOpen", true);
    const safeguarding = await publishDeclaration(
      h,
      "volunteer_safeguarding_declaration"
    );
    const priya = await member(h, PRIYA);
    const dateOfBirth = bornYearsAgo(h, 30);

    expect(
      await h
        .as(priya.actor)
        .applyToVolunteer(
          applicationInput(
            { safeguarding, conduct: safeguarding },
            { dateOfBirth }
          )
        )
    ).toEqual({ ok: false, error: "declaration_unpublished" });

    const conduct = await publishDeclaration(h, "volunteer_code_of_conduct");
    await publishDeclaration(h, "volunteer_code_of_conduct");
    expect(
      await h
        .as(priya.actor)
        .applyToVolunteer(
          applicationInput({ safeguarding, conduct }, { dateOfBirth })
        )
    ).toEqual({ ok: false, error: "declaration_outdated" });
    await expectNothingWritten(h);
  });

  it("stays closed until a super admin opens applications", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    await h.settings.set("volunteers.applicationsOpen", false);
    const priya = await member(h, PRIYA);

    expect(
      await h
        .as(priya.actor)
        .applyToVolunteer(
          applicationInput(declarations, { dateOfBirth: bornYearsAgo(h, 30) })
        )
    ).toEqual({ ok: false, error: "applications_closed" });
    expect(
      (await h.as(priya.actor).myVolunteerApplication()).applicationsOpen
    ).toBe(false);
    await expectNothingWritten(h);
  });

  it("stores the date of birth only encrypted", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);
    const dateOfBirth = bornYearsAgo(h, 30);
    const priya = await member(h, PRIYA);
    await h
      .as(priya.actor)
      .applyToVolunteer(applicationInput(declarations, { dateOfBirth }));

    const raw = await h.db.execute(
      sql`SELECT row_to_json(volunteer_application)::text AS row FROM volunteer_application`
    );
    const text = JSON.stringify(raw);
    expect(text).toContain("date_of_birth_ciphertext");
    expect(text).not.toContain(dateOfBirth);
  });

  it("refuses a visitor before anything else", async () => {
    const h = await createHarness();
    const declarations = await openVolunteering(h);

    await expect(
      h.as(h.visitor()).applyToVolunteer(applicationInput(declarations))
    ).rejects.toEqual(expect.any(DomainError));
    await expect(
      h.as(h.visitor()).myVolunteerApplication()
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await h.db.select().from(auditLog)).toEqual([]);
    expect(await h.db.select().from(outbox)).toEqual([]);
  });
});
