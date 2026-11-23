import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { downloadRequest } from "@/app/api/files/_lib/file-requests";
import { createApp } from "@/server/app";
import {
  auditLog,
  competitionConsentDocument,
  fileAsset,
  registration,
} from "@/server/db/schema";
import { publicUse } from "@/server/modules/consent";
import { publishNextVersion } from "@/server/modules/consent/testing";
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
    const { h, formScope, target, coordinator } = w;
    const { formId, fileId } = await submitScan(w);
    const reviewer = h.as((await signInReviewer(h)).actor);
    const queue = { status: "pending_review" as const };
    const detail = { formId };
    const withdrawal = { ...formScope, formId };
    await expect(
      coordinator.listConsentFormsForReview(queue)
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      coordinator.getConsentFormForReview(detail)
    ).rejects.toMatchObject({ code: "forbidden" });
    const member = h.as(await h.signIn(await h.seed.member()));
    await expect(
      member.listSignedFormsForRegistration(formScope)
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(member.withdrawConsentForm(withdrawal)).rejects.toMatchObject({
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
      form: { scanAvailable: false },
    });
    await h.db
      .update(fileAsset)
      .set({ status: "clean" })
      .where(eq(fileAsset.id, fileId));
    const sign = vi.spyOn(h.storage, "presignGet");
    const reviewed = await reviewer.getConsentFormForReview(detail);
    if (!reviewed.ok) throw new Error("Review detail not available");
    expect.soft(sign).not.toHaveBeenCalled();
    expect
      .soft(
        await h.db
          .select()
          .from(auditLog)
          .where(eq(auditLog.action, "file.read"))
      )
      .toEqual([]);
    expect
      .soft({
        fileId: reviewed.form.fileId,
        scanAvailable: reviewed.form.scanAvailable,
      })
      .toEqual({ fileId, scanAvailable: true });
    expect.soft(Object.hasOwn(reviewed.form, "download")).toBe(false);
    expect(reviewed.form.documents).toMatchObject([
      { purpose: "public_display", version: 1 },
      { purpose: "auction", version: 1 },
    ]);
    const response = await downloadRequest(reviewer, fileId);
  if (response.status !== 302 || !response.location) {
      throw new Error("Scan not available");
    }
    expect(await h.storage.get(response.location)).toMatchObject({
      ok: true,
      bytes: SCAN,
      cacheControl: "private, no-store",
    });
    expect.soft(sign).toHaveBeenCalledTimes(1);
    expect(
      await h.db.select().from(auditLog).where(eq(auditLog.action, "file.read"))
    ).toMatchObject([{ entityId: fileId }]);
    expect(
      await coordinator.listSignedFormsForRegistration(formScope)
    ).toMatchObject({
      ok: true,
      students: [
        { studentId: target.studentId, form: { status: "pending_review" } },
      ],
    });
    expect(await coordinator.withdrawConsentForm(withdrawal)).toEqual({
      ok: true,
      status: "withdrawn",
    });
    expect(await coordinator.withdrawConsentForm(withdrawal)).toEqual({
      ok: false,
      error: "not_pending",
    });
    expect(await reviewer.listConsentFormsForReview(queue)).toEqual({
      ok: true,
      forms: [],
    });
  });

  it("keeps the workflow dormant with the production configuration", async () => {
    const { h, school, formScope, target } = await formWorld();
    const app = createApp({
      ...h.deps,
      files: { ...h.deps.files, appEnv: "production" },
    });
    const coordinator = app.as(school.coordinator.actor);
    const staff = app.as((await signInReviewer(h)).actor);
    expect(
      await coordinator.requestConsentFormUpload({ ...target, ...UPLOAD })
    ).toEqual({ ok: false, error: "unavailable" });
    expect(await coordinator.listSignedFormsForRegistration(formScope)).toEqual(
      { ok: false, error: "unavailable" }
    );
    expect(await coordinator.declareParticipation(formScope)).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(
      await staff.listConsentFormsForReview({ status: "pending_review" })
    ).toEqual({ ok: false, error: "unavailable" });
    expect(await h.db.select().from(fileAsset)).toEqual([]);
  });

  it("keeps a pending form withdrawable after the enrolment ends without offering another upload", async () => {
    const w = await formWorld();
    const { h, school, formScope, target, coordinator } = w;
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

    const withdrawal = { ...formScope, formId };
    expect(
      await coordinator.listSignedFormsForRegistration(formScope)
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
        h.as(actor).withdrawConsentForm(withdrawal)
      ).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    const authorisedPerson = h.as(await h.signIn(school.admin));
    expect(await authorisedPerson.withdrawConsentForm(withdrawal)).toEqual({
      ok: true,
      status: "withdrawn",
    });
  });

  it("shows the rejection reason and note after the enrolment is withdrawn", async () => {
    const w = await formWorld();
    const { h, school, formScope, target, coordinator } = w;
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
      await coordinator.listSignedFormsForRegistration(formScope)
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

  it("shows the earlier pending form on the new enrolment and lets the coordinator withdraw it", async () => {
    const w = await formWorld();
    const { h, school, formScope, target, coordinator } = w;
    const { formId } = await submitScan(w);
    const rosterScope = {
      institutionId: school.institutionId,
      reference: school.reference,
    };
    const roster = await coordinator.listEnrolledStudents(rosterScope);
    if (!roster.ok || !roster.students[0]) throw new Error("Missing student");
    const { registrationId: earlier } = roster.students[0];
    expect(
      await coordinator.withdrawStudent({
        ...rosterScope,
        registrationId: earlier,
      })
    ).toEqual({ ok: true });
    h.clock.advance({ minutes: 1 });
    const enrolled = await coordinator.enrolStudent({
      ...rosterScope,
      student: AANYA,
    });
    if (!enrolled.ok) throw new Error(`Enrolment refused: ${enrolled.error}`);
    expect(enrolled.registrationId).not.toBe(earlier);
    const replacement = {
      ...target,
      fileId: await uploadScan(w),
      uses: ["auction"],
    };
    expect(await coordinator.submitConsentForm(replacement)).toEqual({
      ok: false,
      error: "review_pending",
    });

    const pending = await coordinator.listSignedFormsForRegistration(formScope);
    if (!pending.ok) throw new Error("Missing dashboard");
    expect(
      pending.students.find(({ enrolmentId }) => enrolmentId === earlier)
    ).toMatchObject({
      uploadEligible: false,
      canWithdraw: false,
      form: { id: formId, status: "pending_review" },
    });
    const active = pending.students.find(
      ({ enrolmentId }) => enrolmentId === enrolled.registrationId
    );
    expect(active).toMatchObject({
      studentId: target.studentId,
      uploadEligible: false,
      canWithdraw: true,
      form: { id: formId, status: "pending_review" },
    });
    if (!active?.form)
      throw new Error("Missing pending form on the active enrolment");
    expect(
      await coordinator.withdrawConsentForm({
        ...formScope,
        formId: active.form.id,
      })
    ).toEqual({ ok: true, status: "withdrawn" });
    const withdrawn =
      await coordinator.listSignedFormsForRegistration(formScope);
    expect(withdrawn).toMatchObject({
      ok: true,
      students: expect.arrayContaining([
        expect.objectContaining({
          enrolmentId: earlier,
          uploadEligible: false,
          canWithdraw: false,
          form: expect.objectContaining({ id: formId, status: "withdrawn" }),
          studentId: target.studentId,
        }),
        expect.objectContaining({
          enrolmentId: enrolled.registrationId,
          uploadEligible: true,
          form: null,
        }),
      ]),
    });
    expect(await coordinator.submitConsentForm(replacement)).toMatchObject({
      ok: true,
      status: "pending_review",
    });
  });

  it("shows current purpose consent while later submissions are pending, rejected or withdrawn", async () => {
    const w = await formWorld();
    const { h, school, formScope, target, coordinator } = w;
    const competitionId = school.competition.id;
    const publication = {
      profileId: target.studentId,
      competitionId,
      use: "gallery" as const,
    };
    const first = await submitScan(w, ["public_display"]);
    const reviewer = h.as((await signInReviewer(h)).actor);
    await h.db
      .update(fileAsset)
      .set({ status: "clean" })
      .where(eq(fileAsset.id, first.fileId));
    expect(
      await reviewer.reviewConsentForm({
        formId: first.formId,
        decision: "accept",
      })
    ).toEqual({ ok: true, status: "accepted" });
    h.clock.advance({ minutes: 1 });
    const later = await submitScan(w, ["auction"]);
    const expectState = async (
      form: object,
      display: "given" | "not_granted"
    ) => {
      expect
        .soft(await coordinator.listSignedFormsForRegistration(formScope))
        .toMatchObject({
          ok: true,
          students: [
            {
              form,
              effectiveConsent: expect.arrayContaining([
                { purpose: "public_display", status: display },
                { purpose: "auction", status: "not_granted" },
              ]),
            },
          ],
        });
    };
    await expectState({ id: later.formId, status: "pending_review" }, "given");
    expect(await publicUse(h.deps, publication)).toEqual({ name: "Aanya R." });
    expect(
      await reviewer.reviewConsentForm({
        formId: later.formId,
        decision: "reject",
        reason: "not_signed",
      })
    ).toEqual({ ok: true, status: "rejected" });
    await expectState(
      { id: later.formId, status: "rejected", rejectionReason: "not_signed" },
      "given"
    );
    h.clock.advance({ minutes: 1 });
    const replacement = await submitScan(w, ["auction"]);
    expect(
      await coordinator.withdrawConsentForm({
        ...formScope,
        formId: replacement.formId,
      })
    ).toEqual({ ok: true, status: "withdrawn" });
    await expectState({ id: replacement.formId, status: "withdrawn" }, "given");
    expect(await publicUse(h.deps, publication)).toEqual({ name: "Aanya R." });

    const newVersion = await publishNextVersion(h, "public_display");
    await h.db
      .update(competitionConsentDocument)
      .set({ consentDocumentId: newVersion.id })
      .where(
        and(
          eq(competitionConsentDocument.competitionId, competitionId),
          eq(competitionConsentDocument.purpose, "public_display")
        )
      );
    await expectState(
      { id: replacement.formId, status: "withdrawn" },
      "not_granted"
    );
    expect(await publicUse(h.deps, publication)).toBeNull();
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
      form: { studentName: "Aanya Reddy", studentRef: "FORM-02" },
    });
  });

  it("distinguishes students with matching queue names and no roll number in the staff detail", async () => {
    const w = await formWorld();
    const { h, school, coordinator, target } = w;
    const rosterScope = {
      institutionId: school.institutionId,
      reference: school.reference,
    };
    const first = await submitScan(w);
    h.clock.advance({ minutes: 1 });
    const secondEnrolment = await coordinator.enrolStudent({
      ...rosterScope,
      student: { ...AANYA, fullName: "Aanya Roy" },
    });
    if (!secondEnrolment.ok)
      throw new Error(`Enrolment refused: ${secondEnrolment.error}`);
    const roster = await coordinator.listEnrolledStudents(rosterScope);
    if (!roster.ok) throw new Error("Missing roster");
    const firstRow = roster.students.find(
      ({ fullName }) => fullName === "Aanya Rao"
    );
    const secondRow = roster.students.find(
      ({ registrationId }) => registrationId === secondEnrolment.registrationId
    );
    if (!firstRow || !secondRow) throw new Error("Missing enrolments");
    const [student] = await h.db
      .select({ studentId: registration.participantProfileId })
      .from(registration)
      .where(eq(registration.id, secondRow.registrationId));
    if (!student) throw new Error("Missing student profile");
    const second = await submitScan({
      ...w,
      target: { ...target, ...student },
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
    for (const form of queue.forms) {
      expect(form).not.toHaveProperty("enrolmentRef");
    }
    for (const [form, row] of [
      [first, firstRow],
      [second, secondRow],
    ] as const) {
      expect
        .soft(await reviewer.getConsentFormForReview({ formId: form.formId }))
        .toMatchObject({
          ok: true,
          form: {
            studentName: row.fullName,
            studentRef: null,
            enrolmentRef: row.registrationId,
          },
        });
    }
  });

  it("allows only one pending form, and refuses a quarantined replacement", async () => {
    const w = await formWorld();
    const { h, formScope, target, coordinator } = w;
    const { formId } = await submitScan(w);
    const fileId = await uploadScan(w);
    const input = { ...target, fileId, uses: ["auction"] };
    expect(await coordinator.submitConsentForm(input)).toEqual({
      ok: false,
      error: "review_pending",
    });
    await coordinator.withdrawConsentForm({ ...formScope, formId });
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
