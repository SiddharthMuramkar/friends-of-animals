import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  competitionConsentDocument,
  consentEvent,
  fileAsset,
  guardianLink,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import {
  formWorld,
  signInReviewer,
  submitScan,
} from "@/server/modules/consent-forms/testing";

import { publicUse, schoolParticipationUse } from "./index";

describe("school-route use", () => {
  it("records participation and judging once through the school's coordinator", async () => {
    const { h, target, school, coordinator, formScope } = await formWorld();
    const scope = {
      profileId: target.studentId,
      competitionId: school.competition.id,
    };
    const member = h.as(await h.signIn(await h.seed.member()));
    await expect(member.declareParticipation(formScope)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      await schoolParticipationUse(h.deps, { ...scope, use: "participation" })
    ).toEqual({ allowed: false, reason: "no_declaration" });
    expect(await coordinator.declareParticipation(formScope)).toMatchObject({
      ok: true,
      declaredAt: h.clock.now(),
    });
    h.clock.advance({ minutes: 1 });
    expect(await coordinator.declareParticipation(formScope)).toMatchObject({
      ok: true,
    });
    for (const use of ["participation", "judging"] as const) {
      expect(await schoolParticipationUse(h.deps, { ...scope, use })).toEqual({
        allowed: true,
        basis: "institution_declaration",
      });
    }
    for (const use of [
      "gallery",
      "results",
      "social_media",
      "auction",
    ] as const) {
      expect(await publicUse(h.deps, { ...scope, use })).toBeNull();
    }
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "consent_form.participation_declared"))
    ).toHaveLength(1);
  });

  it("applies approved credit options, refuses account and staff-recorded grants and respects a guardian withdrawal", async () => {
    const w = await formWorld();
    const { h, target, school, formScope, coordinator } = w;
    const scope = {
      profileId: target.studentId,
      competitionId: school.competition.id,
    };
    const documents = await h.db
      .select()
      .from(competitionConsentDocument)
      .where(eq(competitionConsentDocument.competitionId, scope.competitionId));
    const display = documents.find(
      ({ purpose }) => purpose === "public_display"
    )!;
    const event = {
      subjectType: "participant_profile" as const,
      subjectId: target.studentId,
      competitionId: scope.competitionId,
      purpose: "public_display" as const,
      documentId: display.consentDocumentId,
      giverUserId: school.coordinator.userId,
    };
    const { account, guardianId } = await h.seed.guardian({ children: [] });
    await h.db.insert(guardianLink).values({
      id: uuidv7(h.clock.now()),
      guardianId,
      participantProfileId: target.studentId,
      relationship: "parent",
      createdAt: h.clock.now(),
    });
    const guardian = h.as(await h.signIn(account));
    const guardianScope = {
      childId: scope.profileId,
      competitionId: scope.competitionId,
      purpose: "public_display" as const,
    };
    h.clock.advance({ minutes: 1 });
    expect(
      await guardian.giveChildConsent({
        ...guardianScope,
        documentId: display.consentDocumentId,
      })
    ).toEqual({ ok: true, changed: true });
    expect
      .soft(await publicUse(h.deps, { ...scope, use: "gallery" }))
      .toBeNull();

    h.clock.advance({ minutes: 1 });
    await h.db.insert(consentEvent).values({
      ...event,
      id: uuidv7(h.clock.now()),
      method: "staff_recorded",
      action: "given",
      occurredAt: h.clock.now(),
    });
    expect(await publicUse(h.deps, { ...scope, use: "gallery" })).toBeNull();

    h.clock.advance({ minutes: 1 });
    const { formId, fileId } = await submitScan(w, [
      "public_display",
      "auction",
      "display_city",
    ]);
    await h.db
      .update(fileAsset)
      .set({ status: "clean" })
      .where(eq(fileAsset.id, fileId));
    const reviewer = await signInReviewer(h);
    expect(
      await h
        .as(reviewer.actor)
        .reviewConsentForm({ formId, decision: "accept" })
    ).toMatchObject({ ok: true });
    expect(await publicUse(h.deps, { ...scope, use: "gallery" })).toEqual({
      name: "Aanya R.",
      city: "Pune",
    });
    expect(await publicUse(h.deps, { ...scope, use: "auction" })).toEqual({
      name: "Aanya R.",
    });

    // A later event from the verified guardian path must take precedence over the form.
    h.clock.advance({ minutes: 1 });
    expect(await guardian.withdrawChildConsent(guardianScope)).toEqual({
      ok: true,
      changed: true,
    });
    expect(await publicUse(h.deps, { ...scope, use: "gallery" })).toBeNull();
    expect(
      await coordinator.listSignedFormsForRegistration(formScope)
    ).toMatchObject({
      ok: true,
      students: [
        {
          form: { id: formId, status: "accepted" },
          effectiveConsent: expect.arrayContaining([
            { purpose: "public_display", status: "withdrawn" },
          ]),
        },
      ],
    });
  });
});
