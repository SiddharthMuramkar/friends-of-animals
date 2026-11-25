// The same uploader can submit several children's work. A child's rights
// export follows their entry, not the coordinator's account.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { entry, entryFile, registration } from "@/server/db/schema";
import {
  confirmedAdult,
  ESSAY_PDF_UPLOAD,
  PHOTO,
  submittedImage,
  VIDEO_UPLOAD,
} from "@/server/modules/entries/testing";
import { confirmedSchool } from "@/server/modules/institution-submissions/testing";
import {
  FEE_PAISE,
  openOrder,
  schoolWithStudents,
} from "@/server/modules/payments/testing";
import { createHarness } from "@/test/harness";

import { collectSubjectData } from "./collect";

describe("school submission subject export", () => {
  it("contains the child's own coordinator-uploaded work without a classmate's work or uploader identity", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    const codes = await Promise.all([
      submittedImage(h, school.forStudent(1)),
      submittedImage(h, school.forStudent(2)),
    ]);
    await h.drain();
    const [mine] = await h.db
      .select({ profileId: registration.participantProfileId })
      .from(registration)
      .where(eq(registration.id, school.registrationIds[0]!));
    const fileFor = async (code: string) => {
      const [row] = await h.db
        .select({ id: entryFile.fileAssetId })
        .from(entryFile)
        .innerJoin(entry, eq(entryFile.entryId, entry.id))
        .where(eq(entry.code, code));
      return row!.id;
    };
    const ownFile = await fileFor(codes[0]!);
    const otherFile = await fileFor(codes[1]!);
    const result = await collectSubjectData(h.deps, {
      subject: { kind: "participant_profile", id: mine!.profileId },
      scope: { userIds: [], profileIds: [mine!.profileId] },
      reference: "TEST-SCHOOL",
      generatedAt: h.clock.now(),
    });
    expect(result.document.sections.file_asset).toEqual([
      expect.objectContaining({ id: ownFile }),
    ]);
    expect(result.document.sections.file_asset![0]).not.toHaveProperty(
      "owner_user_id"
    );
    expect(result.document.files.map((file) => file.id)).toEqual([ownFile]);
    expect(result.files.map((file) => file.bytes)).toEqual([PHOTO]);
    expect(JSON.stringify(result.document)).not.toContain(otherFile);
  });

  it("reports the coordinator’s uploads as references, not the children’s entry contents", async () => {
    const h = await createHarness();
    const school = await confirmedSchool(h);
    await submittedImage(h, school.forStudent(1));
    await submittedImage(h, school.forStudent(2));
    await h.drain();
    const uploads = (
      await h.db.select({ id: entryFile.fileAssetId }).from(entryFile)
    )
      .map((row) => row.id)
      .sort((a, b) => (a ?? "").localeCompare(b ?? ""));
    const result = await collectSubjectData(h.deps, {
      subject: { kind: "user", id: school.coordinator.userId },
      scope: { userIds: [school.coordinator.userId], profileIds: [] },
      reference: "TEST-UPLOADER",
      generatedAt: h.clock.now(),
    });
    expect(result.document.sections.file_asset ?? []).toEqual([]);
    expect(result.document.references["file_asset.owner_user_id"]).toEqual(
      uploads
    );
    expect(result.files).toEqual([]);
  });

  it("keeps the child's own fee item separate from the institution payer's batch", async () => {
    const h = await createHarness();
    const school = await schoolWithStudents(h);
    const { batchId, orderId } = await openOrder(school);
    h.gateway.capture(orderId);
    await h
      .as(h.visitor())
      .receiveGatewayWebhook(
        h.gateway.webhook({ type: "payment.captured", orderId })
      );
    await h.drain();
    const [mine] = await h.db
      .select({ profileId: registration.participantProfileId })
      .from(registration)
      .where(eq(registration.id, school.registrationIds[0]!));
    const subject = { kind: "participant_profile", id: mine!.profileId };
    const child = await collectSubjectData(h.deps, {
      subject,
      scope: { userIds: [], profileIds: [subject.id] },
      reference: "TEST-CHILD-FEE",
      generatedAt: h.clock.now(),
    });
    expect(child.document.sections.payment_batch_item).toEqual([
      expect.objectContaining({
        batch_id: batchId,
        registration_id: school.registrationIds[0],
        amount_minor: String(FEE_PAISE),
      }),
    ]);
    expect(child.document.sections.payment_batch ?? []).toEqual([]);
    expect(JSON.stringify(child.document)).not.toContain(
      school.registrationIds[1]
    );
    const payer = await collectSubjectData(h.deps, {
      subject: { kind: "user", id: school.coordinator.userId },
      scope: { userIds: [school.coordinator.userId], profileIds: [] },
      reference: "TEST-SCHOOL-PAYER",
      generatedAt: h.clock.now(),
    });
    expect(payer.document.sections.payment_batch).toEqual([
      expect.objectContaining({
        id: batchId,
        amount_minor: String(FEE_PAISE * 2n),
      }),
    ]);
    expect(payer.document.sections.payment_batch_item).toHaveLength(2);
  });

  it.each([VIDEO_UPLOAD, ESSAY_PDF_UPLOAD] as const)(
    "includes the original $discipline upload in the participant's rights export",
    async (upload) => {
      const h = await createHarness();
      const adult = await confirmedAdult(h, {
        disciplines: [upload.discipline],
      });
      await submittedImage(h, adult, upload);
      await h.drain();
      const [mine] = await h.db
        .select({ profileId: registration.participantProfileId })
        .from(registration)
        .where(eq(registration.id, adult.registrationId));
      const result = await collectSubjectData(h.deps, {
        subject: { kind: "user", id: adult.userId },
        scope: { userIds: [adult.userId], profileIds: [mine!.profileId] },
        reference: "TEST-MEDIA-EXPORT",
        generatedAt: h.clock.now(),
      });
      expect(result.document.files).toEqual([
        expect.objectContaining({ contentType: upload.type }),
      ]);
      expect(result.files).toEqual([
        { name: result.document.files[0]!.path, bytes: upload.bytes },
      ]);
    }
  );
});
