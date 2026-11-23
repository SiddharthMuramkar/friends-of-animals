import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  auditLog,
  consentEvent,
  consentForm,
  fileAsset,
  outbox,
} from "@/server/db/schema";
import { publicUse } from "@/server/modules/consent";
import { publishNextVersion, reattach } from "@/server/modules/consent/testing";

import { formWorld, signInReviewer, submitScan } from "./testing";

describe("signed-form review", () => {
  it("requires a clean scan and records only the ticked purposes at their submitted versions", async () => {
    const w = await formWorld();
    const { h, target, school } = w;
    const { formId, fileId } = await submitScan(w, [
      "public_display",
      "auction",
      "auction",
    ]);
    const reviewer = await signInReviewer(h);
    const staff = h.as(reviewer.actor);
    const input = { formId, decision: "accept" as const };
    const publication = {
      profileId: target.studentId,
      competitionId: school.competition.id,
    };
    expect(
      await publicUse(h.deps, { ...publication, use: "gallery" })
    ).toBeNull();
    expect(await staff.reviewConsentForm(input)).toEqual({
      ok: false,
      error: "file_not_clean",
    });
    await h.db
      .update(fileAsset)
      .set({ status: "clean" })
      .where(eq(fileAsset.id, fileId));
    const newer = await publishNextVersion(h, "auction");
    await reattach(h, school.competition.id, "auction", newer.id);

    expect(await staff.reviewConsentForm(input)).toMatchObject({
      ok: true,
      status: "accepted",
    });
    expect(await staff.reviewConsentForm(input)).toEqual({
      ok: false,
      error: "not_pending",
    });
    const events = await h.db
      .select()
      .from(consentEvent)
      .where(eq(consentEvent.subjectId, target.studentId))
      .orderBy(consentEvent.id);
    expect(events).toMatchObject(
      ["public_display", "auction"].map((purpose) => ({
        subjectType: "participant_profile",
        subjectId: target.studentId,
        action: "given",
        competitionId: school.competition.id,
        purpose,
        method: "paper_form",
        consentFormId: formId,
        reviewerUserId: reviewer.userId,
        giverUserId: null,
      }))
    );
    expect(events[1]?.documentId).not.toBe(newer.id);
    expect(await publicUse(h.deps, { ...publication, use: "gallery" })).toEqual(
      { name: "Aanya R." }
    );
    expect(
      await publicUse(h.deps, { ...publication, use: "auction" })
    ).toBeNull();
    expect(
      await publicUse(h.deps, { ...publication, use: "social_media" })
    ).toBeNull();
    expect(
      await h.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.action, "consent_form.accepted"))
    ).toHaveLength(1);
  });

  it("rejects with a reason, sends one private inbox notice, and leaves consent unchanged", async () => {
    const w = await formWorld();
    const { h, coordinator, school, target } = w;
    const { formId } = await submitScan(w);
    const staff = h.as(await h.signIn(await h.seed.superAdmin()));
    expect(
      await staff.reviewConsentForm({
        formId,
        decision: "reject",
        reason: "other",
      })
    ).toEqual({ ok: false, error: "note_required" });
    expect(
      await staff.reviewConsentForm({
        formId,
        decision: "reject",
        reason: "not_signed",
        note: "Please rescan the signature page.",
      })
    ).toMatchObject({ ok: true, status: "rejected" });
    expect(await h.db.select().from(consentEvent)).toEqual([]);
    expect(
      await h.db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, "consent.form_reviewed"))
    ).toHaveLength(1);
    await h.drain();
    const title = "A signed consent form needs attention";
    const notices = (await coordinator.listInbox()).filter(
      (item) => item.title === title
    );
    expect(notices).toMatchObject([
      {
        title,
        body: "Open the school registration’s consent dashboard to see the review decision and what to do next.",
      },
    ]);
    const authorisedPerson = h.as(await h.signIn(school.admin));
    expect(
      (await authorisedPerson.listInbox()).map((item) => item.title)
    ).not.toContain(title);
    expect((await staff.listInbox()).map((item) => item.title)).not.toContain(
      title
    );
    expect(
      await authorisedPerson.listSignedFormsForRegistration({
        registrationId: target.registrationId,
      })
    ).toMatchObject({
      ok: true,
      students: [
        {
          form: {
            id: formId,
            rejectionNote: "Please rescan the signature page.",
          },
        },
      ],
    });
    const replacement = await submitScan(w);
    expect(replacement.formId).not.toBe(formId);
  });

  it("requires a fresh staff second factor and prevents review of one's own upload", async () => {
    const w = await formWorld();
    const { h, coordinator, school } = w;
    const { formId } = await submitScan(w);
    const input = { formId, decision: "reject" as const, reason: "illegible" };
    await expect(coordinator.reviewConsentForm(input)).rejects.toMatchObject({
      code: "forbidden",
    });
    const reviewer = await signInReviewer(h, false);
    await expect(
      h.as(reviewer.actor).reviewConsentForm(input)
    ).rejects.toMatchObject({ code: "enrolment_required" });
    await h.seed.grant(
      { id: school.coordinator.userId },
      { role: "staff_admin", scope: { type: "global" } }
    );
    await h.passSecondFactor(school.coordinator.actor);
    expect(await coordinator.reviewConsentForm(input)).toEqual({
      ok: false,
      error: "own_upload",
    });
    const enrolled = await signInReviewer(h);
    h.clock.advance({ minutes: 10, seconds: 1 });
    const staff = h.as(enrolled.actor);
    await expect(staff.reviewConsentForm(input)).rejects.toMatchObject({
      code: "step_up_required",
    });
    await h.passSecondFactor(enrolled.actor);
    expect(await staff.reviewConsentForm(input)).toEqual({
      ok: true,
      status: "rejected",
    });
  });

  it("rejects incomplete review metadata in the database for undecided forms", async () => {
    const w = await formWorld();
    const { h, coordinator } = w;
    const { formId } = await submitScan(w);
    const { userId } = await signInReviewer(h);
    for (const status of ["pending_review", "withdrawn"]) {
      if (status === "withdrawn") {
        expect(await coordinator.withdrawConsentForm({ formId })).toEqual({
          ok: true,
          status: "withdrawn",
        });
      }
      for (const patch of [
        { reviewedByUserId: userId },
        { reviewedAt: h.clock.now() },
      ]) {
        await expect(
          h.db.update(consentForm).set(patch).where(eq(consentForm.id, formId))
        ).rejects.toMatchObject({
          cause: { constraint: "consent_form_reviewed_iff_decided" },
        });
      }
    }
  });
});
