import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  artworkCustodyEvent,
  artworkResultsWindow,
  outbox,
} from "@/server/db/schema";
import { uuidv7 } from "@/server/ids";
import { emit } from "@/server/outbox";
import { signedInWith, managerOf } from "../judging/testing";
import { confirmedChild, submittedImage } from "../entries/testing";
import {
  closeSubmissions,
  entryIdOf,
  signedInVerifier,
} from "../verification/testing";
import {
  SEED_ARTWORK,
  SEED_ARTWORK_VERIFIER,
  seedPhysicalArtwork,
} from "@/server/seed/physical-artwork";
import { seedFunctions } from "@/server/seed/builders";
import { seedCompetitions } from "@/server/seed/competitions";
import {
  SEED_COORDINATORS,
  seedCoordinators,
} from "@/server/seed/coordinators";
import { seedInstitutions } from "@/server/seed/institutions";
import { seedRegistrations } from "@/server/seed/registration";
import { createHarness } from "@/test/harness";
import {
  conditionPhotos,
  receivedArtwork,
  verificationDetails,
} from "./testing";
import {
  isPhysicallyReadyForJudging,
  physicallyReadyEntryIds,
} from "./readiness";

const { seedPreview: seedSchoolArtwork } = seedFunctions([
  seedCompetitions,
  seedInstitutions,
  seedCoordinators,
  // The ORIG27 school examples reuse the institution's seeded pupils.
  seedRegistrations,
  seedPhysicalArtwork,
]);

describe("artwork custody", () => {
  it("verifies only a received artwork with clean private front and back photos", async () => {
    const h = await createHarness();
    const w = await receivedArtwork(h);
    const verifier = h.as(w.verifier);
    const input = {
      artworkId: w.artworkId,
      ...verificationDetails,
      photos: [],
    };
    await expect(
      h.as(w.individual.actor).verifyArtwork(input)
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await verifier.verifyArtwork(input)).toMatchObject({
      ok: false,
      error: "photos_too_few",
    });
    expect(await isPhysicallyReadyForJudging(h.db, w.individual.entryId)).toBe(
      false
    );
    await expect(
      h.as(w.individual.actor).requestArtworkPhotoUpload({
        artworkId: w.artworkId,
        kind: "front",
        sizeBytes: 100,
        contentType: "image/png",
      })
    ).rejects.toMatchObject({ code: "forbidden" });
    const photos = await conditionPhotos(h, w.verifier, w.artworkId);
    expect(
      await verifier.verifyArtwork({
        ...input,
        photos,
        checklist: { ...input.checklist, matchesDigital: false },
      })
    ).toMatchObject({ ok: false, error: "checklist_failed" });
    expect(await verifier.verifyArtwork({ ...input, photos })).toMatchObject({
      ok: true,
    });
    expect(await isPhysicallyReadyForJudging(h.db, w.individual.entryId)).toBe(
      true
    );
    expect(
      await physicallyReadyEntryIds(h.db, { competitionId: w.competitionId })
    ).toEqual(new Set([w.individual.entryId]));
    await expect(
      h.as(w.individual.actor).getArtworkCustody({ artworkId: w.artworkId })
    ).rejects.toMatchObject({ code: "forbidden" });
    const result = await verifier.getArtworkCustody({ artworkId: w.artworkId });
    expect(result).toMatchObject({
      ok: true,
      status: "verified",
      storageLocation: "Rack B, Shelf 2",
      events: [{ kind: "received" }, { kind: "stored" }],
      verification: { material: "Watercolour on paper" },
    });
    if (!result.ok) throw new Error("missing custody");
    const photoId = result.photos[0]!.id;
    await expect(
      h.as(w.individual.actor).getArtworkPhotoUrl({ photoId })
    ).rejects.toMatchObject({ code: "forbidden" });
    const url = await h.as(w.manager).getArtworkPhotoUrl({ photoId });
    expect(url).toMatchObject({
      ok: true,
      url: expect.stringContaining("artwork_condition_photo"),
    });
    if (!url.ok) throw new Error("photo unavailable");
    await expect(
      h.as(w.verifier).getFileDownloadUrl({ fileId: photos[0]!.fileId })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(url.url).not.toContain(w.artworkCode);
    h.clock.advance({ seconds: 299 });
    expect(await h.storage.get(url.url)).toMatchObject({ ok: true });
    h.clock.advance({ seconds: 2 });
    expect(await h.storage.get(url.url)).toMatchObject({ ok: false });
    expect(
      await h.db
        .select()
        .from(outbox)
        .where(eq(outbox.eventType, "artwork.verified"))
    ).toHaveLength(1);
    await expect(
      h.db
        .update(artworkCustodyEvent)
        .set({ location: "other" })
        .where(eq(artworkCustodyEvent.artworkId, w.artworkId))
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      h.db
        .delete(artworkCustodyEvent)
        .where(eq(artworkCustodyEvent.artworkId, w.artworkId))
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      h.db.execute(sql`TRUNCATE artwork_custody_event`)
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });
  it("requires a scoped verifier with 2FA for inspection and refuses an unfinished photo", async () => {
    const h = await createHarness();
    const w = await receivedArtwork(h);
    const user = await h.seed.member();
    await h.seed.grant(user, {
      role: "foa_verifier",
      scope: { type: "global" },
    });
    await h.seed.authenticator(user);
    const withoutFactor = await h.signIn(user, {}, { secondFactor: false });
    await expect(
      h.as(withoutFactor).verifyArtwork({
        artworkId: w.artworkId,
        ...verificationDetails,
        photos: [],
      })
    ).rejects.toMatchObject({ code: "second_factor_required" });
    const verifier = h.as(w.verifier);
    const front = await verifier.requestArtworkPhotoUpload({
      artworkId: w.artworkId,
      kind: "front",
      contentType: "image/png",
      sizeBytes: 100,
    });
    const back = await verifier.requestArtworkPhotoUpload({
      artworkId: w.artworkId,
      kind: "back",
      contentType: "image/png",
      sizeBytes: 100,
    });
    if (!front.ok || !back.ok) throw new Error("upload grant refused");
    expect(
      await verifier.verifyArtwork({
        artworkId: w.artworkId,
        ...verificationDetails,
        photos: [
          { fileId: front.fileId, kind: "front" },
          { fileId: back.fileId, kind: "back" },
        ],
      })
    ).toMatchObject({ ok: false, error: "photo_not_ready" });
    expect(
      await verifier.getArtworkPhotoUrl({ photoId: front.photoId })
    ).toMatchObject({ ok: false, error: "photo_not_ready" });
    const stranger = await signedInWith(h, managerOf(uuidv7(h.clock.now())));
    await expect(
      h.as(stranger).getArtworkPhotoUrl({ photoId: front.photoId })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("permits the verified guardian of a child to request return, not another guardian", async () => {
    const h = await createHarness();
    const child = await confirmedChild(h);
    const code = await submittedImage(h, child);
    await h.drain();
    await closeSubmissions(h);
    const entryId = await entryIdOf(h, code);
    const competitionId = child.competition.id;
    const verifier = await signedInVerifier(h);
    const manager = await signedInWith(h, managerOf(competitionId));
    expect(await h.as(verifier).verifyEntry({ entryId })).toMatchObject({
      ok: true,
    });
    const artwork = await h
      .as(manager)
      .requestPhysicalArtwork({ competitionId, entryIds: [entryId] });
    if (!artwork.ok) throw new Error(JSON.stringify(artwork));
    const artworkId = artwork.artworks[0]!.artworkId;
    expect(
      await h.as(verifier).markArtworkReceived({ artworkId })
    ).toMatchObject({ ok: true });
    await publish(h, competitionId);
    const unrelated = await h.seed.guardian({
      children: [{ fullName: "Another child", age: 12 }],
    });
    await expect(
      h
        .as(await h.signIn(unrelated.account))
        .requestArtworkReturn({ artworkId })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await h.as(child.actor).requestArtworkReturn({ artworkId })
    ).toMatchObject({ ok: true });
  });

  it("permits only the school's scoped coordinator to request return for its original", async () => {
    const h = await createHarness();
    await seedSchoolArtwork(h.deps);
    const verifier = h.as(await h.signIn(SEED_ARTWORK_VERIFIER));
    const artwork = await verifier.getArtwork({
      artworkCode: SEED_ARTWORK.codes[6],
    });
    if (!artwork.ok) throw new Error("missing artwork");
    const ref = { artworkId: artwork.artwork.artworkId };
    const other = await signedInWith(h, {
      role: "institution_coordinator",
      scope: { type: "institution", id: uuidv7(h.clock.now()) },
    });
    await expect(h.as(other).requestArtworkReturn(ref)).rejects.toMatchObject({
      code: "forbidden",
    });
    const coordinator = h.as(await h.signIn(SEED_COORDINATORS.coordinator));
    expect(await coordinator.requestArtworkReturn(ref)).toMatchObject({
      ok: false,
      error: "return_window_not_open",
    });
    // ORIG27 remains in judging; exercise the trusted publication event
    // rather than relying on a synthetic preview return window.
    await publish(h, SEED_ARTWORK.competitionId);
    expect(await coordinator.requestArtworkReturn(ref)).toMatchObject({
      ok: true,
    });
  });

  it("admits actual physically ready entries to an FOA physical round, not a received or discrepant original", async () => {
    const h = await createHarness();
    const w = await receivedArtwork(h);
    const manager = h.as(w.manager);
    const verifier = h.as(w.verifier);
    const ref = { artworkId: w.artworkId };
    for (const discipline of ["drawing", "painting", "photography"] as const) {
      const draft = await manager.createRubricDraft({
        competitionId: w.competitionId,
        discipline,
      });
      if (!draft.ok) throw new Error(JSON.stringify(draft));
      expect(
        await manager.publishRubric({ rubricId: draft.rubric.id })
      ).toMatchObject({ ok: true });
    }
    const physical = await manager.createJudgingRound({
      competitionId: w.competitionId,
      name: "Physical round",
    });
    if (!physical.ok) throw new Error(JSON.stringify(physical));
    const input = {
      roundId: physical.roundId,
      entryIds: [w.individual.entryId],
    };
    expect(await manager.admitToPool(input)).toMatchObject({
      ok: true,
      admitted: 0,
      refused: [{ reason: "not_physically_ready" }],
    });
    expect(
      await verifier.raiseArtworkDiscrepancy({
        ...ref,
        reason: "mismatch",
        notes: "Check the label",
      })
    ).toMatchObject({ ok: true });
    expect(await manager.admitToPool(input)).toMatchObject({
      ok: true,
      admitted: 0,
      refused: [{ reason: "not_physically_ready" }],
    });
    expect(
      await manager.resolveArtworkDiscrepancy({
        ...ref,
        resolution: "Label confirmed",
      })
    ).toMatchObject({ ok: true });
    const photos = await conditionPhotos(h, w.verifier, w.artworkId);
    expect(
      await verifier.verifyArtwork({ ...ref, ...verificationDetails, photos })
    ).toMatchObject({ ok: true });
    expect(await manager.admitToPool(input)).toMatchObject({
      ok: true,
      admitted: 1,
      refused: [],
    });
    const exhibition = await manager.createJudgingRound({
      competitionId: w.competitionId,
      name: "Exhibition round",
    });
    if (!exhibition.ok) throw new Error(JSON.stringify(exhibition));
    expect(
      await manager.exhibitArtwork({ ...ref, location: "Hall" })
    ).toMatchObject({ ok: true });
    expect(
      await manager.admitToPool({ ...input, roundId: exhibition.roundId })
    ).toMatchObject({ ok: true, admitted: 1, refused: [] });
    await publish(h, w.competitionId);
    h.clock.advance({ days: 30 });
    await h.drain();
    const retained = await manager.createJudgingRound({
      competitionId: w.competitionId,
      name: "Retained round",
    });
    if (!retained.ok) throw new Error(JSON.stringify(retained));
    expect(
      await manager.admitToPool({ ...input, roundId: retained.roundId })
    ).toMatchObject({ ok: true, admitted: 1, refused: [] });
  });

  it("blocks verification and judging until a verifier's discrepancy is resolved", async () => {
    const h = await createHarness();
    const w = await receivedArtwork(h);
    const ref = { artworkId: w.artworkId };
    const report = {
      ...ref,
      reason: "mismatch",
      notes: "The picture does not match.",
    };
    const stranger = h.as(w.individual.actor);
    const verifier = h.as(w.verifier);
    const manager = h.as(w.manager);
    await expect(
      stranger.raiseArtworkDiscrepancy(report)
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await verifier.raiseArtworkDiscrepancy(report)).toMatchObject({
      ok: true,
    });
    expect(await verifier.raiseArtworkDiscrepancy(report)).toMatchObject({
      ok: false,
      error: "discrepancy_open",
    });
    expect(
      await verifier.verifyArtwork({
        ...ref,
        ...verificationDetails,
        photos: [],
      })
    ).toMatchObject({ ok: false, error: "discrepancy_open" });
    expect(await isPhysicallyReadyForJudging(h.db, w.individual.entryId)).toBe(
      false
    );
    const queue = { competitionId: w.competitionId };
    await expect(
      stranger.listArtworkDiscrepancies(queue)
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await verifier.listArtworkDiscrepancies(queue)).toMatchObject({
      ok: true,
      discrepancies: [{ artworkCode: w.artworkCode }],
    });
    const resolution = {
      ...ref,
      resolution: "Verified match with the correct label.",
    };
    await expect(
      stranger.resolveArtworkDiscrepancy(resolution)
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await manager.resolveArtworkDiscrepancy(resolution)).toMatchObject({
      ok: true,
    });
    expect(await verifier.listArtworkDiscrepancies(queue)).toMatchObject({
      ok: true,
      discrepancies: [],
    });
    const photos = await conditionPhotos(h, w.verifier, w.artworkId);
    expect(
      await verifier.verifyArtwork({ ...ref, ...verificationDetails, photos })
    ).toMatchObject({ ok: true });
    expect(await isPhysicallyReadyForJudging(h.db, w.individual.entryId)).toBe(
      true
    );
  });

  it("exhibits and moves verified work, refuses pre-publication returns, and fulfils a timely family request", async () => {
    const h = await createHarness();
    const w = await receivedArtwork(h);
    const ref = { artworkId: w.artworkId };
    const verifier = h.as(w.verifier);
    const manager = h.as(w.manager);
    const member = h.as(w.individual.actor);
    const photographs = await conditionPhotos(h, w.verifier, w.artworkId);
    expect(
      await verifier.verifyArtwork({
        ...ref,
        ...verificationDetails,
        photos: photographs,
      })
    ).toMatchObject({ ok: true });
    const location = { ...ref, location: "Exhibition hall" };
    for (const action of [
      "exhibitArtwork",
      "storeArtwork",
      "moveArtwork",
    ] as const) {
      await expect(member[action](location)).rejects.toMatchObject({
        code: "forbidden",
      });
    }
    expect(await manager.exhibitArtwork(location)).toMatchObject({ ok: true });
    expect(await isPhysicallyReadyForJudging(h.db, w.individual.entryId)).toBe(
      true
    );
    expect(
      await manager.storeArtwork({ ...ref, location: "Store B" })
    ).toMatchObject({ ok: true });
    expect(
      await manager.moveArtwork({ ...ref, location: "Rack C" })
    ).toMatchObject({ ok: true });
    const via = {
      ...ref,
      via: { method: "hand_over" as const, receivedBy: "A family member" },
    };
    await expect(member.recordArtworkReturn(via)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(member.retainArtwork(ref)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await manager.retainArtwork(ref)).toMatchObject({
      ok: false,
      error: "results_not_published",
    });
    expect(await manager.recordArtworkReturn(via)).toMatchObject({
      ok: false,
      error: "no_return_request",
    });
    expect(await member.requestArtworkReturn(ref)).toMatchObject({
      ok: false,
      error: "return_window_not_open",
    });
    await expect(manager.requestArtworkReturn(ref)).rejects.toMatchObject({
      code: "forbidden",
    });
    await publish(h, w.competitionId);
    h.clock.advance({ days: 29 });
    expect(await member.requestArtworkReturn(ref)).toMatchObject({ ok: true });
    expect(await member.requestArtworkReturn(ref)).toMatchObject({
      ok: false,
      error: "return_already_requested",
    });
    h.clock.advance({ days: 1 });
    await h.drain();
    expect(await manager.getArtworkCustody(ref)).toMatchObject({
      ok: true,
      status: "verified",
      storageLocation: "Rack C",
      returnRequest: { fulfilledAt: null },
    });
    expect(await manager.retainArtwork(ref)).toMatchObject({
      ok: false,
      error: "return_requested",
    });
    expect(await manager.recordArtworkReturn(via)).toMatchObject({ ok: true });
    expect(await manager.getArtworkCustody(ref)).toMatchObject({
      ok: true,
      status: "returned",
      storageLocation: null,
      returnRequest: { fulfilledAt: expect.any(Date) },
    });
    expect(await isPhysicallyReadyForJudging(h.db, w.individual.entryId)).toBe(
      false
    );
  });

  it("retains unrequested work at the first actual results window close and refuses a late request", async () => {
    const h = await createHarness();
    const w = await receivedArtwork(h);
    const ref = { artworkId: w.artworkId };
    const photos = await conditionPhotos(h, w.verifier, w.artworkId);
    expect(
      await h
        .as(w.verifier)
        .verifyArtwork({ ...ref, ...verificationDetails, photos })
    ).toMatchObject({ ok: true });
    const opensAt = h.clock.now();
    await publish(h, w.competitionId);
    h.clock.advance({ days: 1 });
    await publish(h, w.competitionId);
    const [window] = await h.db
      .select()
      .from(artworkResultsWindow)
      .where(eq(artworkResultsWindow.competitionId, w.competitionId));
    expect(window?.resultsPublishedAt).toEqual(opensAt);
    h.clock.advance({ days: 29 });
    await h.drain();
    expect(
      await h.as(w.individual.actor).requestArtworkReturn(ref)
    ).toMatchObject({ ok: false, error: "return_window_closed" });
    const manager = h.as(w.manager);
    expect(await manager.getArtworkCustody(ref)).toMatchObject({
      ok: true,
      status: "retained",
      retainedAt: h.clock.now(),
    });
    expect(await isPhysicallyReadyForJudging(h.db, w.individual.entryId)).toBe(
      true
    );
    expect(
      await manager.exhibitArtwork({ ...ref, location: "Hall" })
    ).toMatchObject({ ok: true });
    expect(
      await manager.storeArtwork({ ...ref, location: "Store" })
    ).toMatchObject({ ok: true });
    expect(await manager.getArtworkCustody(ref)).toMatchObject({
      ok: true,
      status: "retained",
    });
  });
});

async function publish(
  h: Awaited<ReturnType<typeof createHarness>>,
  competitionId: string
) {
  await emit(h.db, h.clock, {
    type: "results.published",
    aggregate: { type: "competition", id: competitionId },
    payload: {
      competitionId,
      releaseId: uuidv7(h.clock.now()),
      publishedAt: h.clock.now().toISOString(),
    },
  });
  await h.drain();
}
