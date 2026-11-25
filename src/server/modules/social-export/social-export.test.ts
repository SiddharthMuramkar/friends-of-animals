import { emit } from "@/server/outbox/emit";
import { EVENT_PAYLOADS } from "@/server/outbox/events";
import { eq } from "drizzle-orm";
import {
  auditLog,
  fileAsset,
  fileDerivative,
  participantProfile,
  outbox,
} from "@/server/db/schema";
import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { consentCompetition } from "../consent/testing";
import { confirmedChild, submittedImage } from "../entries/testing";
import { signedInWith } from "../judging/testing";
import {
  closeSubmissions,
  entryIdOf,
  signedInVerifier,
} from "../verification/testing";

async function publishedGallery() {
  const h = await createHarness();
  const competition = await consentCompetition(h, { fee: 0n });
  const family = await confirmedChild(h, { competition });
  const code = await submittedImage(h, family);
  await h.drain();
  const entryId = await entryIdOf(h, code);
  await closeSubmissions(h);
  expect(
    await h.as(await signedInVerifier(h)).verifyEntry({ entryId })
  ).toMatchObject({ ok: true });
  const curator = h.as(
    await signedInWith(h, {
      role: "content_manager",
      scope: { type: "global" },
    })
  );
  const guardian = h.as(family.actor);
  const target = { childId: family.childId, competitionId: competition.id };
  expect(
    await guardian.giveChildConsent({
      ...target,
      purpose: "public_display",
      documentId: competition.guardianDocuments.public_display!,
    })
  ).toMatchObject({ ok: true });
  const picked = await curator.pickGalleryEntry({ entryId });
  if (!picked.ok) throw Error(picked.error);
  const ref = { itemId: picked.itemId };
  expect(
    await curator.editGalleryItem({
      ...ref,
      title: "A dog and a cup of tea",
      story: "Kindness can be quiet.",
      featured: false,
    })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(await curator.publishGalleryItem(ref)).toMatchObject({ ok: true });
  const grantSocial = () =>
    guardian.giveChildConsent({
      ...target,
      purpose: "social_media",
      documentId: competition.guardianDocuments.social_media!,
    });
  return {
    h,
    curator,
    guardian,
    target,
    ref,
    grantSocial,
    publicDocumentId: competition.guardianDocuments.public_display!,
    visitor: h.as(h.visitor()),
  };
}

it("queues only a published gallery item with separate social consent, as a curator", async () => {
  const { curator, visitor, guardian, ref, grantSocial } =
    await publishedGallery();
  await expect(guardian.listSocialExportCandidates()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(guardian.queueSocialExport(ref)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(guardian.listSocialExports()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(visitor.listSocialExportCandidates()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(visitor.queueSocialExport(ref)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(visitor.listSocialExports()).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await curator.listSocialExportCandidates()).toEqual([]);
  expect(await curator.queueSocialExport(ref)).toEqual({
    ok: false,
    error: "no_social_consent",
  });
  expect(await curator.listSocialExports()).toEqual([]);
  expect(await grantSocial()).toMatchObject({ ok: true });
  expect(await curator.listSocialExportCandidates()).toEqual([
    {
      itemId: ref.itemId,
      title: "A dog and a cup of tea",
      credit: { name: "Isha D." },
      sampleIllustration: false,
    },
  ]);
  const queued = await curator.queueSocialExport(ref);
  if (!queued.ok) throw Error(queued.error);
  expect(await curator.listSocialExports()).toEqual([
    {
      exportId: queued.exportId,
      itemId: ref.itemId,
      title: "A dog and a cup of tea",
      caption: "A dog and a cup of tea\n\nKindness can be quiet.",
      credit: { name: "Isha D." },
      status: "pending",
      stampReady: false,
      sampleIllustration: false,
    },
  ]);
  expect(await curator.queueSocialExport(ref)).toEqual({
    ok: false,
    error: "already_queued",
  });
  expect(await curator.listSocialExportCandidates()).toEqual([]);
});

it("edits captions, downloads only the ready stamped PNG and fresh credit, and records manual posting", async () => {
  const { h, curator, visitor, ref, grantSocial, guardian, target } =
    await publishedGallery();
  expect(await grantSocial()).toMatchObject({ ok: true });
  const queued = await curator.queueSocialExport(ref);
  if (!queued.ok) throw Error(queued.error);
  const id = { exportId: queued.exportId };
  await expect(visitor.requestSocialExportStamp(id)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(guardian.requestSocialExportStamp(id)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await curator.requestSocialExportStamp(id)).toMatchObject({
    ok: true,
    stamp: "queued",
  });
  await expect(
    guardian.editSocialCaption({ ...id, caption: "Text" })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(guardian.getSocialExportDownload(id)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(guardian.markSocialExportPosted(id)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    visitor.editSocialCaption({ ...id, caption: "Text" })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(visitor.getSocialExportDownload(id)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(visitor.markSocialExportPosted(id)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await curator.getSocialExportDownload(id)).toEqual({
    ok: false,
    error: "stamp_pending",
  });
  expect(await curator.markSocialExportPosted(id)).toEqual({
    ok: false,
    error: "stamp_pending",
  });
  expect(await curator.editSocialCaption({ ...id, caption: " " })).toEqual({
    ok: false,
    error: "invalid_input",
  });
  expect(
    await curator.editSocialCaption({
      ...id,
      caption: "Every creature deserves kindness.",
    })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(h.media.stamps.filter((s) => s.variant === "social")).toHaveLength(1);
  const download = await curator.getSocialExportDownload(id);
  if (!download.ok) throw Error(download.error);
  expect(download.caption).toBe("Every creature deserves kindness.");
  expect(download.credit).toEqual({ name: "Isha D." });
  expect(await h.storage.get(download.url)).toMatchObject({
    ok: true,
    contentType: "image/png",
    contentDisposition: `attachment; filename="foa-social-${queued.exportId}.png"`,
    cacheControl: "private, no-store",
  });
  const source = await h.db
    .select()
    .from(fileDerivative)
    .where(eq(fileDerivative.kind, "stamp_social_v1"));
  expect(source).toHaveLength(1);
  expect(download.url).toContain(source[0]!.storageKey);
  const originals = await h.db.select().from(fileAsset);
  for (const file of originals)
    expect(download.url).not.toContain(file.storageKey);
  expect(await curator.markSocialExportPosted(id)).toMatchObject({ ok: true });
  expect(await curator.markSocialExportPosted(id)).toEqual({
    ok: false,
    error: "already_posted",
  });
  expect(
    await curator.editSocialCaption({ ...id, caption: "Another caption" })
  ).toEqual({ ok: false, error: "already_posted" });
  expect(await curator.listSocialExports()).toMatchObject([
    {
      ...id,
      status: "posted",
      stampReady: true,
      caption: "Every creature deserves kindness.",
    },
  ]);
  expect(
    await guardian.withdrawChildConsent({ ...target, purpose: "social_media" })
  ).toMatchObject({ ok: true });
  expect(await curator.getSocialExportDownload(id)).toMatchObject({
    ok: false,
  });
  h.clock.advance({ seconds: 301 });
  expect(await h.storage.get(download.url)).toMatchObject({
    ok: false,
    error: "expired",
  });
});

it("removes withdrawn exports immediately, never revives an old grant or posted status, and ignores replay against a newer queue", async () => {
  const { h, curator, ref, grantSocial, guardian, target } =
    await publishedGallery();
  const social = { ...target, purpose: "social_media" as const };
  expect(await grantSocial()).toMatchObject({ ok: true });
  const queued = await curator.queueSocialExport(ref);
  if (!queued.ok) throw Error(queued.error);
  await h.drain();
  expect(
    await curator.markSocialExportPosted({ exportId: queued.exportId })
  ).toMatchObject({ ok: true });
  expect(await guardian.withdrawChildConsent(social)).toMatchObject({
    ok: true,
  });
  expect(await curator.listSocialExports()).toEqual([]);
  expect(await curator.listSocialExportCandidates()).toEqual([]);
  expect(
    await curator.editSocialCaption({
      exportId: queued.exportId,
      caption: "Do not use",
    })
  ).toMatchObject({ ok: false });
  expect(
    await curator.markSocialExportPosted({ exportId: queued.exportId })
  ).toMatchObject({ ok: false });
  expect(
    await curator.getSocialExportDownload({ exportId: queued.exportId })
  ).toMatchObject({ ok: false });
  // A distinct grant, even at the fake clock's same instant, cannot resurrect
  // the old row. Explicit requeue may happen before delayed withdrawal delivery.
  expect(await grantSocial()).toMatchObject({ ok: true });
  expect(await curator.listSocialExports()).toEqual([]);
  expect(
    await curator.requestSocialExportStamp({ exportId: queued.exportId })
  ).toEqual({ ok: false, error: "source_changed" });
  const requeued = await curator.queueSocialExport(ref);
  if (!requeued.ok) throw Error(requeued.error);
  expect(requeued.exportId).not.toBe(queued.exportId);
  expect(
    await curator.getSocialExportDownload({ exportId: queued.exportId })
  ).toEqual({ ok: false, error: "not_found" });
  await h.drain();
  expect(await curator.listSocialExports()).toMatchObject([
    { exportId: requeued.exportId, status: "pending" },
  ]);
  expect(await guardian.withdrawChildConsent(social)).toMatchObject({
    ok: true,
  });
  await h.drain();
  expect(
    await curator.getSocialExportDownload({ exportId: requeued.exportId })
  ).toEqual({ ok: false, error: "not_found" });
  expect(await curator.listSocialExports()).toEqual([]);
  const audits = await h.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.entityType, "social_export"));
  expect(
    audits.filter((a) => a.action === "social_export.withdrawn")
  ).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain("Kindness can be quiet.");
});

it("recomputes the small credit fields, checks source visibility and retires the old public-display grant", async () => {
  const { h, curator, guardian, ref, target, grantSocial, publicDocumentId } =
    await publishedGallery();
  expect(await grantSocial()).toMatchObject({ ok: true });
  await h.db
    .update(participantProfile)
    .set({ schoolName: "Sample Learning School", city: "Nagpur" })
    .where(eq(participantProfile.id, target.childId));
  for (const purpose of ["display_school", "display_city"] as const) {
    expect(
      await guardian.giveChildConsent({
        ...target,
        purpose,
        documentId: publicDocumentId,
      })
    ).toMatchObject({ ok: true });
  }
  const queued = await curator.queueSocialExport(ref);
  if (!queued.ok) throw Error(queued.error);
  const id = { exportId: queued.exportId };
  await h.drain();
  const credit = {
    name: "Isha D.",
    school: "Sample Learning School",
    city: "Nagpur",
  };
  expect(await curator.listSocialExports()).toMatchObject([{ ...id, credit }]);
  expect(await curator.getSocialExportDownload(id)).toMatchObject({
    ok: true,
    credit,
  });
  expect(
    await guardian.withdrawChildConsent({
      ...target,
      purpose: "display_school",
    })
  ).toMatchObject({ ok: true });
  expect((await curator.listSocialExports())[0]?.credit).toEqual({
    name: "Isha D.",
    city: "Nagpur",
  });
  const download = await curator.getSocialExportDownload(id);
  if (!download.ok) throw Error(download.error);
  expect(download.credit).toEqual({ name: "Isha D.", city: "Nagpur" });
  expect(download.caption).not.toContain("Sample Learning School");
  // Hide is moderation, not just a temporary pause. A fresh review and
  // publication may be queued again but must never reuse its old caption.
  expect(
    await curator.hideGalleryItem({ ...ref, reason: "moderator" })
  ).toMatchObject({ ok: true });
  expect(await curator.listSocialExports()).toEqual([]);
  expect(await curator.queueSocialExport(ref)).toMatchObject({
    ok: false,
    error: "gallery_unavailable",
  });
  expect(await curator.restoreGalleryItem(ref)).toMatchObject({ ok: true });
  expect(
    await curator.editGalleryItem({
      ...ref,
      title: "A dog and a cup of tea",
      story: "New review after hide",
      featured: false,
    })
  ).toMatchObject({ ok: true });
  expect(await curator.publishGalleryItem(ref)).toMatchObject({ ok: true });
  expect(await curator.listSocialExports()).toEqual([]);
  expect(await curator.getSocialExportDownload(id)).toEqual({
    ok: false,
    error: "not_found",
  });
  const afterHide = await curator.queueSocialExport(ref);
  if (!afterHide.ok) throw Error(afterHide.error);
  const afterHideId = { exportId: afterHide.exportId };
  expect(
    await guardian.withdrawChildConsent({
      ...target,
      purpose: "public_display",
    })
  ).toMatchObject({ ok: true });
  expect(await curator.getSocialExportDownload(afterHideId)).toMatchObject({
    ok: false,
    error: "gallery_unavailable",
  });
  await h.drain();
  expect(await curator.getSocialExportDownload(afterHideId)).toEqual({
    ok: false,
    error: "not_found",
  });
  expect(
    await guardian.giveChildConsent({
      ...target,
      purpose: "public_display",
      documentId: publicDocumentId,
    })
  ).toMatchObject({ ok: true });
  expect(await curator.listSocialExports()).toEqual([]);
  const candidates = await curator.listGalleryCandidates();
  const pick = await curator.pickGalleryEntry({
    entryId: candidates[0]!.entryId,
  });
  if (!pick.ok) throw Error(pick.error);
  expect(pick.itemId).toBe(ref.itemId);
  expect(
    await curator.editGalleryItem({
      ...ref,
      title: "A dog and a cup of tea",
      story: "Renewed review",
      featured: false,
    })
  ).toMatchObject({ ok: true });
  expect(await curator.publishGalleryItem(ref)).toMatchObject({ ok: true });
  expect(await curator.listSocialExports()).toEqual([]);
  const renewed = await curator.queueSocialExport(ref);
  if (!renewed.ok) throw Error(renewed.error);
  expect(renewed.exportId).not.toBe(queued.exportId);
  const withdrawals = await h.db
    .select()
    .from(outbox)
    .where(eq(outbox.handler, "social_export.withdraw_consent"));
  expect(withdrawals).toHaveLength(1);
  await h.db.transaction((tx) =>
    emit(tx, h.clock, {
      type: "consent.withdrawn",
      aggregate: { type: "consent_event", id: withdrawals[0]!.aggregateId },
      payload: EVENT_PAYLOADS["consent.withdrawn"].parse(
        withdrawals[0]!.payload
      ),
    })
  );
  await h.drain();
  expect(await curator.listSocialExports()).toMatchObject([
    { exportId: renewed.exportId, status: "pending" },
  ]);
});
