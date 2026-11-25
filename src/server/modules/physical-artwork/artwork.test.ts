import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness } from "@/test/harness";
import { auditLog, competition, entry } from "@/server/db/schema";
import {
  individualEntryAtFoa,
  signedInVerifier,
  schoolEntriesAtFoa,
  closeSubmissions,
  entryIdOf,
} from "../verification/testing";
import { confirmedChild, submittedImage } from "../entries/testing";
import { signedInWith, managerOf } from "../judging/testing";

describe("physical artwork", () => {
  it("requests only verified artwork, tells the responsible sender, tracks dispatch and acknowledges receipt", async () => {
    const h = await createHarness();
    const individual = await individualEntryAtFoa(h);
    const [row] = await h.db
      .select()
      .from(entry)
      .where(eq(entry.id, individual.entryId));
    const competitionId = row!.competitionId;
    await h.db
      .update(competition)
      .set({ physicalArtwork: "all_shortlisted" })
      .where(eq(competition.id, competitionId));
    const verifier = await signedInVerifier(h);
    const manager = await signedInWith(h, managerOf(competitionId));
    const input = { competitionId, entryIds: [individual.entryId] };
    await expect(
      h.as(individual.actor).requestPhysicalArtwork(input)
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await h.as(manager).requestPhysicalArtwork(input)).toMatchObject({
      ok: false,
      error: "entry_not_verified",
    });
    expect(
      await h.as(verifier).verifyEntry({ entryId: individual.entryId })
    ).toMatchObject({ ok: true });
    await h.db
      .update(competition)
      .set({ physicalArtwork: "not_required" })
      .where(eq(competition.id, competitionId));
    expect(await h.as(manager).requestPhysicalArtwork(input)).toMatchObject({
      ok: false,
      error: "physical_not_required",
    });
    await h.db
      .update(competition)
      .set({ physicalArtwork: "all_shortlisted" })
      .where(eq(competition.id, competitionId));
    await h.settings.set(
      "artwork.packagingInstructions",
      "Wrap in a firm card sleeve."
    );
    await h.settings.set(
      "org.foaFacilityAddress",
      "FOA sample testing address"
    );
    await h.settings.set("artwork.shippingPayer", true);
    const request = await h.as(manager).requestPhysicalArtwork(input);
    expect(request).toMatchObject({
      ok: true,
      artworks: [
        {
          artworkCode: expect.stringMatching(
            /^[A-Z]{3,6}\d{2}-A-[0-9A-HJKMNP-TV-Z]{6}$/
          ),
        },
      ],
    });
    if (!request.ok) throw new Error(JSON.stringify(request));
    const { artworkId, artworkCode } = request.artworks[0]!;
    expect(await h.as(manager).requestPhysicalArtwork(input)).toMatchObject({
      ok: false,
      error: "already_requested",
    });
    await h.settings.set("org.foaFacilityAddress", "Changed address");
    expect(await h.as(manager).getArtwork({ artworkCode })).toMatchObject({
      ok: true,
      artwork: {
        facilityAddress: "FOA sample testing address",
        shippingPayer: "foa",
        packagingInstructions: "Wrap in a firm card sleeve.",
      },
    });
    await h.drain();
    expect(
      h.email
        .inbox(individual.email)
        .some(
          (message) =>
            message.text.includes(artworkCode) &&
            message.subject.includes("dispatch")
        )
    ).toBe(true);
    expect(await h.as(individual.actor).listMyArtworks()).toMatchObject({
      ok: true,
      artworks: [{ artworkId, status: "requested" }],
    });
    await expect(
      h.as(individual.actor).listArtworks({ competitionId })
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      h.as(individual.actor).getArtwork({ artworkCode })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await h.as(manager).getArtwork({ artworkCode })).toMatchObject({
      ok: true,
      artwork: { artworkId },
    });
    const dispatch = {
      artworkIds: [artworkId],
      courierName: "  Blue Dart ",
      trackingNumber: " ab 1234 ",
    };
    expect(await h.as(manager).recordArtworkDispatch(dispatch)).toMatchObject({
      ok: false,
      error: "not_found",
    });
    expect(
      await h.as(individual.actor).recordArtworkDispatch(dispatch)
    ).toMatchObject({ ok: true });
    expect(await h.as(manager).listArtworks({ competitionId })).toMatchObject({
      ok: true,
      artworks: [
        {
          artworkId,
          status: "dispatched",
          courierName: "Blue Dart",
          trackingNumber: "AB1234",
        },
      ],
    });
    await expect(
      h.as(individual.actor).markArtworkReceived({ artworkId })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await h.as(verifier).markArtworkReceived({ artworkId })
    ).toMatchObject({ ok: true });
    await h.drain();
    expect(h.email.lastTo(individual.email)?.subject).toContain("received");
    expect(await h.as(individual.actor).listMyArtworks()).toMatchObject({
      ok: true,
      artworks: [{ artworkId, status: "received" }],
    });
    for (const action of [
      "physical_artwork.requested",
      "physical_artwork.dispatched",
      "physical_artwork.received",
    ]) {
      expect(
        await h.db.select().from(auditLog).where(eq(auditLog.action, action))
      ).toHaveLength(1);
    }
  });
});

describe("dispatch deadlines and sender scopes", () => {
  it("requests verified school artwork, reminds the coordinator still owing dispatch, and does not remind the dispatched sender", async () => {
    const h = await createHarness();
    const school = await schoolEntriesAtFoa(h);
    const verifier = await signedInVerifier(h);
    const ids = [school.entryIds[1]!, school.entryIds[2]!];
    const [row] = await h.db.select().from(entry).where(eq(entry.id, ids[0]!));
    const competitionId = row!.competitionId;
    await h.db
      .update(competition)
      .set({ physicalArtwork: "all_shortlisted" })
      .where(eq(competition.id, competitionId));
    const manager = await signedInWith(h, managerOf(competitionId));
    const coordinator = school.coordinator.actor;
    for (const entryId of ids)
      expect(await h.as(verifier).verifyEntry({ entryId })).toMatchObject({
        ok: true,
      });
    await expect(
      h.as(coordinator).requestPhysicalArtwork({ competitionId, entryIds: ids })
    ).rejects.toMatchObject({ code: "forbidden" });
    await h.db
      .update(competition)
      .set({ physicalArtwork: "top_n", physicalArtworkTopN: 1 })
      .where(eq(competition.id, competitionId));
    expect(
      await h
        .as(manager)
        .requestPhysicalArtwork({ competitionId, entryIds: ids })
    ).toMatchObject({ ok: false, error: "top_n_exceeded" });
    expect(await h.as(manager).listArtworks({ competitionId })).toEqual({
      ok: true,
      artworks: [],
    });
    await h.db
      .update(competition)
      .set({ physicalArtwork: "all_shortlisted", physicalArtworkTopN: null })
      .where(eq(competition.id, competitionId));
    const request = await h
      .as(manager)
      .requestPhysicalArtwork({ competitionId, entryIds: ids });
    if (!request.ok) throw new Error(JSON.stringify(request));
    const [a, b] = request.artworks;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    await h.drain();
    const stranger = await signedInWith(h);
    expect(await h.as(stranger).listMyArtworks()).toEqual({
      ok: true,
      artworks: [],
    });
    await expect(h.as(h.visitor()).listMyArtworks()).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      h.as(coordinator).listArtworkCompetitions()
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await h.as(manager).listArtworkCompetitions()).toContainEqual(
      expect.objectContaining({ id: competitionId })
    );
    await expect(
      h.as(coordinator).listArtworkCandidates({ competitionId })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await h.as(manager).listArtworkCandidates({ competitionId })
    ).toMatchObject({ mayRequest: true, entries: [] });
    expect(
      await h.as(coordinator).recordArtworkDispatch({
        artworkIds: [a!.artworkId],
        courierName: "India Post",
        trackingNumber: " IN 1234 ",
      })
    ).toMatchObject({ ok: true });
    h.clock.set(new Date(b!.dispatchDeadline.getTime() - 72 * 3600000));
    await h.drain();
    const sent = h.email.sent.filter((message) =>
      message.subject.includes("Reminder: dispatch artwork")
    );
    expect(
      sent.some((message) => message.subject.includes(b!.artworkCode))
    ).toBe(true);
    expect(
      sent.some((message) => message.subject.includes(a!.artworkCode))
    ).toBe(false);
    await h.drain();
    expect(
      h.email.sent.filter((message) =>
        message.subject.includes("Reminder: dispatch artwork")
      )
    ).toEqual(sent);
    expect(
      await h.as(manager).markArtworkReceived({ artworkId: b!.artworkId })
    ).toMatchObject({ ok: true });
    expect(
      await h.as(manager).getArtwork({ artworkCode: b!.artworkCode })
    ).toMatchObject({ ok: true, artwork: { receivedWithoutDispatch: true } });
  });
});

describe("family dispatch", () => {
  it("routes a child's request to the verified guardian and permits their dispatch", async () => {
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
    expect(
      await h
        .as(manager)
        .requestPhysicalArtwork({ competitionId, entryIds: [entryId] })
    ).toMatchObject({ ok: true });
    await h.drain();
    expect(
      h.email
        .inbox(child.email)
        .some((msg) => msg.subject.includes("Please dispatch your artwork"))
    ).toBe(true);
    const works = await h.as(child.actor).listMyArtworks();
    const work = works.artworks[0]!;
    const input = {
      artworkIds: [work.artworkId],
      courierName: "India Post",
      trackingNumber: "POST123",
    };
    const stranger = await signedInWith(h);
    expect(await h.as(stranger).recordArtworkDispatch(input)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await h.as(child.actor).recordArtworkDispatch(input)).toEqual({
      ok: true,
    });
    expect(
      await h.as(manager).markArtworkReceived({ artworkId: work.artworkId })
    ).toEqual({ ok: true });
    await h.drain();
    expect(
      h.email
        .inbox(child.email)
        .some((msg) => msg.subject.includes("received your artwork"))
    ).toBe(true);
  });
});
