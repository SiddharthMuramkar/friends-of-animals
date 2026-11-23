import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createApp } from "@/server/app";
import { auditLog, fileAsset } from "@/server/db/schema";

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
      await staff.listConsentFormsForReview({ status: "pending_review" })
    ).toEqual({ ok: false, error: "unavailable" });
    expect(await h.db.select().from(fileAsset)).toEqual([]);
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
