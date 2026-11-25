import { emit } from "@/server/outbox/emit";
import { EVENT_PAYLOADS } from "@/server/outbox/events";
import { solvedHumanCheck } from "@/test/human-check";
import {
  auditLog,
  fileAsset,
  fileDerivative,
  galleryPurge,
  galleryReport,
  participantProfile,
  outbox,
} from "@/server/db/schema";
import { desc, eq, like } from "drizzle-orm";
import { expect, it } from "vitest";
import { createHarness } from "@/test/harness";
import { seedAuctionResults } from "@/test/seed-auction-results";
import { seedGallery, SEED_GALLERY } from "../../seed/gallery";
import { consentCompetition } from "../consent/testing";
import { confirmedChild, submittedImage } from "../entries/testing";
import { signedInWith, managerOf } from "../judging/testing";
import {
  closeSubmissions,
  entryIdOf,
  signedInVerifier,
} from "../verification/testing";

it("curates a verified, consented entry; a visitor cannot curate and a withdrawn item is not public", async () => {
  const h = await createHarness();
  const competition = await consentCompetition(h, { fee: 0n });
  const family = await confirmedChild(h, { competition });
  const code = await submittedImage(h, family);
  await h.drain();
  const entryId = await entryIdOf(h, code);
  await closeSubmissions(h);
  const verifier = await signedInVerifier(h);
  expect(await h.as(verifier).verifyEntry({ entryId })).toMatchObject({
    ok: true,
  });
  const curator = h.as(
    await signedInWith(h, {
      role: "content_manager",
      scope: { type: "global" },
    })
  );
  const visitor = h.as(h.visitor());
  const guardian = h.as(family.actor);
  const manager = h.as(await signedInWith(h, managerOf(competition.id)));
  await expect(visitor.listGalleryItemsForAdmin()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(visitor.pickGalleryEntry({ entryId })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    manager.listGalleryCandidates({ competitionId: competition.id })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(await curator.pickGalleryEntry({ entryId })).toMatchObject({
    ok: false,
    error: "no_public_display_consent",
  });
  expect(await curator.listGalleryItemsForAdmin()).toEqual([]);
  await h.db
    .update(participantProfile)
    .set({ schoolName: "Sample Learning School", city: "Nagpur" })
    .where(eq(participantProfile.id, family.childId));
  expect(
    await guardian.giveChildConsent({
      childId: family.childId,
      competitionId: competition.id,
      purpose: "public_display",
      documentId: competition.guardianDocuments.public_display!,
    })
  ).toMatchObject({ ok: true });
  const candidates = await curator.listGalleryCandidates({
    competitionId: competition.id,
  });
  expect(candidates, JSON.stringify(candidates)).toMatchObject([
    { entryId, eligible: true },
  ]);
  const picked = await curator.pickGalleryEntry({ entryId });
  if (!picked.ok) throw new Error(picked.error);
  const ref = { itemId: picked.itemId };
  expect(await visitor.getPublicGalleryItem(ref)).toBeNull();
  await expect(
    visitor.editGalleryItem({
      ...ref,
      title: "Private title",
      story: "",
      featured: true,
    })
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(manager.publishGalleryItem(ref)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await curator.publishGalleryItem(ref)).toMatchObject({
    ok: false,
    error: "review_required",
  });
  expect(
    await curator.editGalleryItem({
      ...ref,
      title: "A dog and a cup of tea",
      story: "Kindness can be quiet.",
      featured: true,
    })
  ).toMatchObject({ ok: true });
  expect(await curator.publishGalleryItem(ref)).toMatchObject({
    ok: false,
    error: "stamp_pending",
  });
  await h.drain();
  expect(await curator.publishGalleryItem(ref)).toMatchObject({ ok: true });
  expect(await visitor.getPublicGalleryItem(ref)).toMatchObject({
    title: "A dog and a cup of tea",
    story: "Kindness can be quiet.",
    credit: { name: "Isha D." },
    image: {
      url: `/media/gallery/${ref.itemId}`,
      thumbnailUrl: `/media/gallery/${ref.itemId}?size=thumb`,
    },
  });
  expect(await visitor.readGalleryImage(ref)).toMatchObject({
    ok: true,
    contentType: "image/webp",
  });
  expect(
    await visitor.readGalleryImage({ ...ref, size: "thumb" })
  ).toMatchObject({ ok: true, contentType: "image/webp" });
  expect((await visitor.getPublicGalleryItem(ref))?.credit).toEqual({
    name: "Isha D.",
  });
  const creditTarget = {
    childId: family.childId,
    competitionId: competition.id,
  };
  for (const purpose of ["display_school", "display_city"] as const) {
    expect(
      await guardian.giveChildConsent({
        ...creditTarget,
        purpose,
        documentId: competition.guardianDocuments.public_display!,
      })
    ).toMatchObject({ ok: true });
  }
  expect((await visitor.getPublicGalleryItem(ref))?.credit).toEqual({
    name: "Isha D.",
    school: "Sample Learning School",
    city: "Nagpur",
  });
  expect(
    await guardian.withdrawChildConsent({
      ...creditTarget,
      purpose: "display_school",
    })
  ).toMatchObject({ ok: true });
  expect((await visitor.getPublicGalleryItem(ref))?.credit).toEqual({
    name: "Isha D.",
    city: "Nagpur",
  });
  const [creditEvent] = await h.db
    .select()
    .from(outbox)
    .where(eq(outbox.handler, "gallery.withdraw_consent"));
  await h.drain();
  await h.db.transaction((tx) =>
    emit(tx, h.clock, {
      type: "consent.withdrawn",
      aggregate: { type: "consent_event", id: creditEvent!.aggregateId },
      payload: EVENT_PAYLOADS["consent.withdrawn"].parse(creditEvent!.payload),
    })
  );
  await h.drain();
  expect(await h.db.select().from(galleryPurge)).toHaveLength(1);
  expect((await curator.listGalleryItemsForAdmin())[0]?.status).toBe(
    "published"
  );
  expect(await visitor.featuredGalleryItems()).toHaveLength(1);
  const allFiles = [
    ...(await h.db.select({ key: fileAsset.storageKey }).from(fileAsset)),
    ...(await h.db
      .select({ key: fileDerivative.storageKey })
      .from(fileDerivative)),
  ];
  const publicJson = JSON.stringify([
    await visitor.listPublicGallery(),
    await visitor.getPublicGalleryItem(ref),
    await visitor.featuredGalleryItems(),
  ]);
  for (const file of allFiles) expect(publicJson).not.toContain(file.key);
  await expect(visitor.listGalleryReports()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(
    manager.hideGalleryItem({ ...ref, reason: "moderator" })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(
    await visitor.reportGalleryItem({
      ...ref,
      reason: "identifies_child",
      details: "Test private concern",
      contact: "test-private@example.test",
      humanCheck: await solvedHumanCheck(h, h.visitor()),
    })
  ).toMatchObject({ ok: true });
  expect(await curator.listGalleryReports()).toMatchObject([
    {
      status: "open",
      details: "Test private concern",
      contact: "test-private@example.test",
    },
  ]);
  expect(
    await curator.hideGalleryItem({ ...ref, reason: "reported" })
  ).toMatchObject({ ok: true });
  expect(await visitor.getPublicGalleryItem(ref)).toBeNull();
  expect(await visitor.readGalleryImage(ref)).toMatchObject({ ok: false });
  expect(await curator.listGalleryReports()).toMatchObject([
    { status: "actioned" },
  ]);
  await h.drain();
  expect(h.cdn.purges.slice(1)).toEqual([
    [
      "/",
      "/gallery",
      `/gallery/${ref.itemId}`,
      `/media/gallery/${ref.itemId}`,
      `/media/gallery/${ref.itemId}?size=thumb`,
      `/gallery/${ref.itemId}/report`,
      `/gallery-report/${ref.itemId}`,
    ],
  ]);
  await expect(manager.restoreGalleryItem(ref)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await curator.restoreGalleryItem(ref)).toMatchObject({ ok: true });
  expect(
    await curator.editGalleryItem({
      ...ref,
      title: "A dog and a cup of tea",
      story: "Kindness can be quiet.",
      featured: true,
    })
  ).toMatchObject({ ok: true });
  expect(await curator.publishGalleryItem(ref)).toMatchObject({ ok: true });
  await expect(visitor.readGalleryDraftImage(ref)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(await curator.readGalleryDraftImage(ref)).toMatchObject({
    ok: true,
    contentType: "image/webp",
  });
  const audits = await h.db
    .select()
    .from(auditLog)
    .where(like(auditLog.action, "gallery.%"));
  expect(audits.map((a) => a.action)).toEqual(
    expect.arrayContaining(["gallery.reported", "gallery.hidden"])
  );
  expect(JSON.stringify(audits)).not.toContain("Test private concern");
  expect(JSON.stringify(audits)).not.toContain("test-private@example.test");

  expect(
    await guardian.withdrawChildConsent({
      childId: family.childId,
      competitionId: competition.id,
      purpose: "public_display",
    })
  ).toMatchObject({ ok: true });
  expect(await visitor.getPublicGalleryItem(ref)).toBeNull();
  expect(await visitor.listPublicGallery()).toMatchObject({ items: [] });
  expect(await visitor.readGalleryImage(ref)).toMatchObject({ ok: false });
  h.cdn.failNext();
  await h.drain();
  expect(await curator.listGalleryItemsForAdmin()).toMatchObject([
    { status: "unpublished" },
  ]);
  expect(await h.db.select().from(galleryPurge)).toHaveLength(3);
  h.clock.advance({ minutes: 1 });
  await h.drain();
  const purges = await h.db.select().from(galleryPurge);
  expect(
    purges.every(
      (p) => p.status === "completed" && p.completedAt! <= p.deadlineAt
    )
  ).toBe(true);
  // Regranting does not resurrect an earlier item. A fresh explicit pick,
  // review and publish binds the new grant. Old withdrawal replay is inert.
  const [withdrawal] = await h.db
    .select()
    .from(outbox)
    .where(eq(outbox.handler, "gallery.withdraw_consent"))
    .orderBy(desc(outbox.occurredAt));
  expect(
    await guardian.giveChildConsent({
      ...creditTarget,
      purpose: "public_display",
      documentId: competition.guardianDocuments.public_display!,
    })
  ).toMatchObject({ ok: true });
  expect(await visitor.getPublicGalleryItem(ref)).toBeNull();
  expect(await curator.pickGalleryEntry({ entryId })).toMatchObject({
    ok: true,
    itemId: ref.itemId,
  });
  expect(
    await curator.editGalleryItem({
      ...ref,
      title: "A dog and a cup of tea",
      story: "Kindness can be quiet.",
      featured: true,
    })
  ).toMatchObject({ ok: true });
  expect(await curator.publishGalleryItem(ref)).toMatchObject({ ok: true });
  await h.db.transaction((tx) =>
    emit(tx, h.clock, {
      type: "consent.withdrawn",
      aggregate: { type: "consent_event", id: withdrawal!.aggregateId },
      payload: EVENT_PAYLOADS["consent.withdrawn"].parse(withdrawal!.payload),
    })
  );
  await h.drain();
  expect(await visitor.getPublicGalleryItem(ref)).not.toBeNull();
  expect(await h.db.select().from(galleryPurge)).toHaveLength(3);
});

it("guards public reports and keeps a durable overdue purge visible without exposing the artist", async () => {
  const h = await createHarness();
  await seedAuctionResults(h.deps);
  await seedGallery(h.deps);
  const itemId = SEED_GALLERY.items[0];
  const actor = h.visitor();
  const visitor = h.as(actor);
  const curator = h.as(
    await signedInWith(h, {
      role: "content_manager",
      scope: { type: "global" },
    })
  );
  const worker = h.as({ kind: "system", process: "worker" });
  const input = {
    itemId,
    reason: "other",
    details: "A concern from this test",
  };
  await expect(worker.reportGalleryItem(input)).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(worker.issueGalleryPlainProof()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(worker.getPublicGalleryItem({ itemId })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(worker.featuredGalleryItems()).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(worker.readGalleryImage({ itemId })).rejects.toMatchObject({
    code: "forbidden",
  });
  await expect(worker.listPublicGallery()).rejects.toMatchObject({
    code: "forbidden",
  });
  const plain = await visitor.issueGalleryPlainProof();
  expect(plain).not.toBeNull();
  expect(await visitor.reportGalleryItem(input)).toMatchObject({
    ok: false,
    error: "human_check_failed",
  });
  await h.settings.set("gallery.reportsPerIpPerHour", 1);
  expect(
    await visitor.reportGalleryItem({
      ...input,
      website: "bot",
      humanCheck: await solvedHumanCheck(h, actor),
    })
  ).toEqual({ ok: true });
  const initial = await h.db.select().from(galleryReport);
  expect(
    await visitor.reportGalleryItem({
      ...input,
      humanCheck: await solvedHumanCheck(h, actor),
    })
  ).toEqual({ ok: true });
  expect(
    await visitor.reportGalleryItem({
      ...input,
      humanCheck: await solvedHumanCheck(h, actor),
    })
  ).toMatchObject({ ok: false, error: "rate_limited" });
  const other = h.visitor({ ip: "198.51.100.43" });
  expect(
    await h.as(other).reportGalleryItem({
      ...input,
      humanCheck: await solvedHumanCheck(h, other),
    })
  ).toMatchObject({ ok: true });
  expect(await h.db.select().from(galleryReport)).toHaveLength(
    initial.length + 2
  );
  const report = (await curator.listGalleryReports()).find(
    (r) => r.details === input.details
  )!;
  await expect(
    visitor.dismissGalleryReport({ reportId: report.reportId })
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(
    await curator.dismissGalleryReport({ reportId: report.reportId })
  ).toMatchObject({ ok: true });
  expect(
    await curator.dismissGalleryReport({ reportId: report.reportId })
  ).toMatchObject({ ok: false, error: "invalid_transition" });
  await h.settings.set("gallery.withdrawalPurgeMinutes", 1);
  h.cdn.failNext(2);
  expect(
    await curator.hideGalleryItem({ itemId, reason: "moderator" })
  ).toMatchObject({ ok: true });
  expect(await visitor.readGalleryImage({ itemId })).toMatchObject({
    ok: false,
  });
  await h.drain();
  h.clock.advance({ minutes: 1 });
  await h.drain();
  const [pending] = await h.db
    .select()
    .from(galleryPurge)
    .where(eq(galleryPurge.itemId, itemId));
  expect(pending).toMatchObject({
    status: "pending",
    attempts: 2,
    overdueAlerted: true,
  });
  expect(await visitor.getPublicGalleryItem({ itemId })).toBeNull();
  h.clock.advance({ minutes: 10 });
  await h.drain();
  expect(
    await h.db
      .select()
      .from(galleryPurge)
      .where(eq(galleryPurge.itemId, itemId))
  ).toMatchObject([{ status: "completed", attempts: 3, overdueAlerted: true }]);
  expect(
    await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "gallery.purge_overdue"))
  ).toHaveLength(1);
  expect(await curator.listInbox()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: "Gallery purge overdue" }),
    ])
  );
});
