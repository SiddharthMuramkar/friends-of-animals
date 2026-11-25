import { expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { entry, fileAsset, registration } from "../../db/schema";
import {
  formWorld,
  signInReviewer,
  submitScan,
} from "../consent-forms/testing";
import { setInstitutionFee } from "../payments/testing";
import { submittedImage } from "../entries/testing";
import { signedInWith } from "../judging/testing";

it("requires verified school-route social permission, not a school's declaration or the accepted gallery-only form", async () => {
  const w = await formWorld();
  const { h, school, coordinator, target, formScope } = w;
  expect(await coordinator.declareParticipation(formScope)).toMatchObject({
    ok: true,
  });
  await setInstitutionFee(h, school, 0n);
  expect(
    await coordinator.payInstitutionFees({
      institutionId: school.institutionId,
      reference: school.reference,
    })
  ).toMatchObject({ ok: true });
  const [student] = await h.db
    .select()
    .from(registration)
    .where(
      and(
        eq(registration.participantProfileId, target.studentId),
        eq(registration.competitionId, school.competition.id)
      )
    );
  const code = await submittedImage(h, {
    actor: school.coordinator.actor,
    registrationId: student!.id,
  });
  await h.drain();
  const [work] = await h.db.select().from(entry).where(eq(entry.code, code));
  // Start this seam from a finished school entry (verification has its own
  // acceptance and real race tests); consent forms still go through review.
  await h.db
    .update(entry)
    .set({ status: "foa_verified" })
    .where(eq(entry.id, work!.id));
  const curator = h.as(
    await signedInWith(h, {
      role: "content_manager",
      scope: { type: "global" },
    })
  );
  expect(await curator.pickGalleryEntry({ entryId: work!.id })).toMatchObject({
    ok: false,
    error: "no_public_display_consent",
  });
  const reviewer = h.as((await signInReviewer(h)).actor);
  const accept = async (uses: string[]) => {
    const { formId, fileId } = await submitScan(w, uses);
    await h.db
      .update(fileAsset)
      .set({ status: "clean" })
      .where(eq(fileAsset.id, fileId));
    expect(
      await reviewer.reviewConsentForm({ formId, decision: "accept" })
    ).toMatchObject({ ok: true });
  };
  await accept(["public_display"]);
  const picked = await curator.pickGalleryEntry({ entryId: work!.id });
  if (!picked.ok) throw Error(picked.error);
  const ref = { itemId: picked.itemId };
  expect(
    await curator.editGalleryItem({
      ...ref,
      title: "Art of kindness",
      story: "",
      featured: false,
    })
  ).toMatchObject({ ok: true });
  await h.drain();
  expect(await curator.publishGalleryItem(ref)).toMatchObject({ ok: true });
  expect(await curator.queueSocialExport(ref)).toEqual({
    ok: false,
    error: "no_social_consent",
  });
  await accept(["social_media"]);
  // The independent social grant must leave the already-reviewed gallery grant intact.
  const queued = await curator.queueSocialExport(ref);
  if (!queued.ok) throw Error(queued.error);
  expect(await curator.listSocialExports()).toMatchObject([
    {
      exportId: queued.exportId,
      credit: { name: "Aanya R." },
      status: "pending",
    },
  ]);
});
