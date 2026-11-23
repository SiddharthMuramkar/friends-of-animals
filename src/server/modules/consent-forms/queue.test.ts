import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { auditLog, fileAsset, registration } from "@/server/db/schema";
import {
  AANYA,
  signInCoordinator,
} from "@/server/modules/registration/testing";
import { seedInstitution } from "@/test/institutions";

import {
  formWorld,
  SCAN,
  signInReviewer,
  submitScan,
  UPLOAD,
  uploadScan,
} from "./testing";

describe("signed-form queue and dashboard", () => {
  it("exposes only scoped status to coordinators and reserves the private scan for staff", async () => {
    const w = await formWorld();
    const { h, target, coordinator } = w;
    const { formId, fileId } = await submitScan(w);
    const reviewer = h.as((await signInReviewer(h)).actor);
    const queue = { status: "pending_review" as const };
    const detail = { formId };
    await expect(
      coordinator.listConsentFormsForReview(queue)
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      coordinator.getConsentFormForReview(detail)
    ).rejects.toMatchObject({ code: "forbidden" });
    const member = h.as(await h.signIn(await h.seed.member()));
    await expect(
      member.listSignedFormsForRegistration({
        registrationId: target.registrationId,
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(member.withdrawConsentForm(detail)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await reviewer.listConsentFormsForReview(queue)).toMatchObject({
      ok: true,
      forms: [
        {
          id: formId,
          studentName: "Aanya R.",
          scanStatus: "uploaded",
          uses: ["public_display", "auction"],
        },
      ],
    });
    expect(await reviewer.getConsentFormForReview(detail)).toMatchObject({
      ok: true,
      form: { download: null },
    });
    await h.db
      .update(fileAsset)
      .set({ status: "clean" })
      .where(eq(fileAsset.id, fileId));
    const reviewed = await reviewer.getConsentFormForReview(detail);
    if (!reviewed.ok || !reviewed.form.download)
      throw new Error("Scan not available");
    expect(await h.storage.get(reviewed.form.download.url)).toMatchObject({
      ok: true,
      bytes: SCAN,
      cacheControl: "private, no-store",
    });
    expect(reviewed.form.documents).toMatchObject([
      { purpose: "public_display", version: 1 },
      { purpose: "auction", version: 1 },
    ]);
    expect(
      await h.db.select().from(auditLog).where(eq(auditLog.action, "file.read"))
    ).toMatchObject([{ entityId: fileId }]);
    expect(
      await coordinator.listSignedFormsForRegistration({
        registrationId: target.registrationId,
      })
    ).toMatchObject({
      ok: true,
      students: [
        { studentId: target.studentId, form: { status: "pending_review" } },
      ],
    });
    expect(await coordinator.withdrawConsentForm(detail)).toEqual({
      ok: true,
      status: "withdrawn",
    });
    expect(await coordinator.withdrawConsentForm(detail)).toEqual({
      ok: false,
      error: "not_pending",
    });
    expect(await reviewer.listConsentFormsForReview(queue)).toEqual({
      ok: true,
      forms: [],
    });
  });

  it("keeps the workflow dormant with the production configuration", async () => {
    const { h, school, target } = await formWorld();
    const app = createApp({
      ...h.deps,
      files: { ...h.deps.files, appEnv: "production" },
    });
    const coordinator = app.as(school.coordinator.actor);
    const staff = app.as((await signInReviewer(h)).actor);
    expect(
      await coordinator.requestConsentFormUpload({ ...target, ...UPLOAD })
    ).toEqual({ ok: false, error: "unavailable" });
    expect(
      await coordinator.listSignedFormsForRegistration({
        registrationId: target.registrationId,
      })
    ).toEqual({ ok: false, error: "unavailable" });
    expect(
      await coordinator.declareParticipation({
        registrationId: target.registrationId,
      })
    ).toEqual({ ok: false, error: "unavailable" });
    expect(
      await staff.listConsentFormsForReview({ status: "pending_review" })
    ).toEqual({ ok: false, error: "unavailable" });
    expect(await h.db.select().from(fileAsset)).toEqual([]);
  });

  it("keeps a pending form withdrawable after the enrolment ends without offering another upload", async () => {
    const w = await formWorld();
    const { h, school, target, coordinator } = w;
    const { formId } = await submitScan(w);
    const scope = {
      institutionId: school.institutionId,
      reference: school.reference,
    };
    const roster = await coordinator.listEnrolledStudents(scope);
    if (!roster.ok || !roster.students[0]) throw new Error("Missing student");
    const { registrationId: enrolmentId } = roster.students[0];
    expect(
      await coordinator.withdrawStudent({
        ...scope,
        registrationId: enrolmentId,
      })
    ).toEqual({ ok: true });

    const query = { registrationId: target.registrationId };
    expect(
      await coordinator.listSignedFormsForRegistration(query)
    ).toMatchObject({
      ok: true,
      students: [
        {
          studentId: target.studentId,
          enrolmentId,
          uploadEligible: false,
          form: { id: formId, status: "pending_review" },
        },
      ],
    });
    expect(
      await coordinator.requestConsentFormUpload({ ...target, ...UPLOAD })
    ).toEqual({ ok: false, error: "not_found" });

    const { institution } = await seedInstitution(h, {
      name: "Other Synthetic School",
    });
    const outsider = await signInCoordinator(h, institution.id);
    for (const actor of [outsider.actor, h.visitor()]) {
      await expect(
        h.as(actor).withdrawConsentForm({ formId })
      ).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    const authorisedPerson = h.as(await h.signIn(school.admin));
    expect(await authorisedPerson.withdrawConsentForm({ formId })).toEqual({
      ok: true,
      status: "withdrawn",
    });
  });

  it("shows the rejection reason and note after the enrolment is withdrawn", async () => {
    const w = await formWorld();
    const { h, school, target, coordinator } = w;
    const { formId } = await submitScan(w);
    const scope = {
      institutionId: school.institutionId,
      reference: school.reference,
    };
    const roster = await coordinator.listEnrolledStudents(scope);
    if (!roster.ok || !roster.students[0]) throw new Error("Missing student");
    const { registrationId: enrolmentId } = roster.students[0];
    expect(
      await coordinator.withdrawStudent({
        ...scope,
        registrationId: enrolmentId,
      })
    ).toEqual({ ok: true });

    const reviewer = h.as((await signInReviewer(h)).actor);
    const note = "The scan is missing the signature page.";
    expect(
      await reviewer.reviewConsentForm({
        formId,
        decision: "reject",
        reason: "not_signed",
        note,
      })
    ).toEqual({ ok: true, status: "rejected" });
    await h.drain();
    expect(await coordinator.listInbox()).toContainEqual(
      expect.objectContaining({
        title: "A signed consent form needs attention",
      })
    );
    expect(
      await coordinator.listSignedFormsForRegistration({
        registrationId: target.registrationId,
      })
    ).toMatchObject({
      ok: true,
      students: [
        {
          studentId: target.studentId,
          enrolmentId,
          uploadEligible: false,
          form: {
            id: formId,
            status: "rejected",
            rejectionReason: "not_signed",
            rejectionNote: note,
          },
        },
      ],
    });
  });

  it("lists pending forms in submission order and reserves roll numbers for detail", async () => {
    const w = await formWorld();
    const { h, school, coordinator, target } = w;
    const first = await submitScan(w);
    h.clock.advance({ minutes: 1 });
    const enrolment = await coordinator.enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: { ...AANYA, fullName: "Aanya Reddy", studentRef: "FORM-02" },
    });
    if (!enrolment.ok) throw new Error(`Enrolment refused: ${enrolment.error}`);
    const [student] = await h.db
      .select({ studentId: registration.participantProfileId })
      .from(registration)
      .where(eq(registration.id, enrolment.registrationId));
    const second = await submitScan({
      ...w,
      target: { ...target, ...student! },
    });
    const reviewer = h.as((await signInReviewer(h)).actor);
    const queue = await reviewer.listConsentFormsForReview({});
    expect(queue).toMatchObject({
      ok: true,
      forms: [
        { id: first.formId, studentName: "Aanya R." },
        { id: second.formId, studentName: "Aanya R." },
      ],
    });
    if (!queue.ok) throw new Error("Missing review queue");
    for (const form of queue.forms)
      expect(form).not.toHaveProperty("studentRef");
    expect(
      await reviewer.getConsentFormForReview({ formId: second.formId })
    ).toMatchObject({
      ok: true,
      form: { studentName: "Aanya R.", studentRef: "FORM-02" },
    });
  });

  it("allows only one pending form, and refuses a quarantined replacement", async () => {
    const w = await formWorld();
    const { h, target, coordinator } = w;
    const { formId } = await submitScan(w);
    const fileId = await uploadScan(w);
    const input = { ...target, fileId, uses: ["auction"] };
    expect(await coordinator.submitConsentForm(input)).toEqual({
      ok: false,
      error: "review_pending",
    });
    await coordinator.withdrawConsentForm({ formId });
    await h.db
      .update(fileAsset)
      .set({ status: "quarantined" })
      .where(eq(fileAsset.id, fileId));
    expect(await coordinator.submitConsentForm(input)).toEqual({
      ok: false,
      error: "file_unavailable",
    });
  });
});
