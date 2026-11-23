import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import * as schema from "@/server/db/schema";
import {
  auditLog,
  consentEvent,
  consentForm,
  fileAsset,
  registration,
} from "@/server/db/schema";
import {
  AANYA,
  registeredSchool,
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

describe("signed-form submission", () => {
  it("authorizes the requested institution before reading its registration or forms", async () => {
    const w = await formWorld();
    const { h, formScope, target } = w;
    const { formId, fileId } = await submitScan(w);
    const otherSchool = await registeredSchool(h, {
      name: "Other Synthetic School",
    });
    const queries: string[] = [];
    const db = drizzle({
      client: h.db.$client,
      schema,
      logger: { logQuery: (query) => queries.push(query) },
    });
    const useCases = createApp({ ...h.deps, db }).as(
      otherSchool.coordinator.actor
    );
    const upload = { ...target, ...UPLOAD };
    const submit = { ...target, fileId, uses: ["auction"] };
    const withdrawal = { ...formScope, formId };
    await expect(
      useCases.requestConsentFormUpload(upload)
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(useCases.submitConsentForm(submit)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      useCases.withdrawConsentForm(withdrawal)
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      useCases.declareParticipation(formScope)
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      useCases.listSignedFormsForRegistration(formScope)
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(
      queries.some((query) =>
        /from "(?:institution_registration|consent_form)"/.test(query)
      )
    ).toBe(false);

    await expect(
      useCases.listSignedFormsForRegistration({
        ...formScope,
        institutionId: otherSchool.institutionId,
      })
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      useCases.withdrawConsentForm({
        institutionId: otherSchool.institutionId,
        registrationId: otherSchool.registrationId,
        formId,
      })
    ).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("stops new signed-form collection and declarations when FOA suspends the school", async () => {
    const w = await formWorld();
    const { h, school, formScope, target, coordinator } = w;
    const fileId = await uploadScan(w);
    const staff = h.as((await signInReviewer(h)).actor);
    expect(
      await staff.decideInstitution({
        institutionId: school.institutionId,
        decision: "suspend",
        reason: "Synthetic school verification is under review.",
      })
    ).toMatchObject({ ok: true, status: "suspended" });

    const upload = await coordinator.requestConsentFormUpload({
      ...target,
      ...UPLOAD,
    });
    expect
      .soft(upload.ok ? { ok: true } : upload)
      .toEqual({ ok: false, error: "not_found" });
    expect
      .soft(
        await coordinator.submitConsentForm({
          ...target,
          fileId,
          uses: ["auction"],
        })
      )
      .toEqual({ ok: false, error: "not_found" });
    expect.soft(await coordinator.declareParticipation(formScope)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect
      .soft(await coordinator.listSignedFormsForRegistration(formScope))
      .toMatchObject({
        ok: true,
        canDeclareParticipation: false,
        participationDeclaredAt: null,
        students: [{ studentId: target.studentId, uploadEligible: false }],
      });
    expect.soft(await h.db.select().from(consentForm)).toEqual([]);
    expect
      .soft(await h.db.select({ id: fileAsset.id }).from(fileAsset))
      .toEqual([{ id: fileId }]);
  });

  it("holds an upload to the enrolled student and rejects a stale document selection", async () => {
    const w = await formWorld();
    const { h, school, target, coordinator } = w;
    const enrolment = await coordinator.enrolStudent({
      institutionId: school.institutionId,
      reference: school.reference,
      student: { ...AANYA, fullName: "Synthetic Second Student" },
    });
    if (!enrolment.ok) throw new Error(`Enrolment refused: ${enrolment.error}`);
    const [other] = await h.db
      .select({ studentId: registration.participantProfileId })
      .from(registration)
      .where(eq(registration.id, enrolment.registrationId));
    const fileId = await uploadScan(w);
    await expect(
      coordinator.submitConsentForm({
        ...target,
        studentId: other!.studentId,
        fileId,
        uses: ["auction"],
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await coordinator.submitConsentForm({
        ...target,
        fileId,
        uses: ["auction"],
        documentIds: { auction: target.studentId },
      })
    ).toEqual({ ok: false, error: "document_outdated" });
    expect(
      await coordinator.submitConsentForm({
        ...target,
        fileId,
        uses: ["auction"],
      })
    ).toMatchObject({ ok: true, status: "pending_review" });
  });
  it("presigns only through the student scope and submits a completed upload without granting consent", async () => {
    const { h, coordinator, target } = await formWorld();
    expect(
      await coordinator.requestUpload({ ...UPLOAD, purpose: "consent_form" })
    ).toEqual({
      ok: false,
      error: "purpose_unavailable",
    });
    const upload = await coordinator.requestConsentFormUpload({
      ...target,
      ...UPLOAD,
    });
    if (!upload.ok) throw new Error(`Upload refused: ${upload.error}`);
    const { fileId, uploadUrl, headers } = upload;
    const input = { ...target, fileId, uses: ["public_display", "auction"] };
    expect(await coordinator.submitConsentForm(input)).toEqual({
      ok: false,
      error: "file_not_uploaded",
    });
    await h.storage.put(uploadUrl, SCAN, headers);
    expect(await coordinator.completeUpload({ fileId })).toMatchObject({
      ok: true,
    });
    expect(await coordinator.submitConsentForm({ ...input, uses: [] })).toEqual(
      { ok: false, error: "no_uses" }
    );
    expect(
      await coordinator.submitConsentForm({ ...input, uses: ["participation"] })
    ).toEqual({ ok: false, error: "not_offered" });
    const form = await coordinator.submitConsentForm(input);
    expect(form).toMatchObject({ ok: true, status: "pending_review" });
    expect(await coordinator.submitConsentForm(input)).toEqual({
      ok: false,
      error: "file_in_use",
    });
    expect(await h.db.select().from(consentEvent)).toEqual([]);
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "consent_form.submitted"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: form.ok ? form.formId : undefined,
    });
  });

  it("refuses outsiders and accepts the authorised person of the same school", async () => {
    const { h, school, coordinator, target } = await formWorld();
    const other = await seedInstitution(h, { name: "Other Synthetic School" });
    const outsider = await signInCoordinator(h, other.institution.id);
    const member = await h.signIn(await h.seed.member());
    for (const actor of [outsider.actor, member, h.visitor()]) {
      const as = h.as(actor);
      await expect(
        as.requestConsentFormUpload({ ...target, ...UPLOAD })
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        as.submitConsentForm({
          ...target,
          fileId: target.studentId,
          uses: ["auction"],
        })
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await h.db.select().from(fileAsset)).toEqual([]);
    const admin = h.as(await h.signIn(school.admin));
    const upload = await admin.requestConsentFormUpload({
      ...target,
      ...UPLOAD,
    });
    if (!upload.ok) throw new Error(`Upload refused: ${upload.error}`);
    await expect(
      coordinator.submitConsentForm({
        ...target,
        fileId: upload.fileId,
        uses: ["auction"],
      })
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
