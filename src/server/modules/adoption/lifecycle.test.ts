// An adoption listing's photos and moves (#129): publish needs a ready
// photo and a verified directory listing; every move goes through the one
// writer and its transition table, with an audit row.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { adoptionListing, auditLog } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { signedInStaff } from "../directory/testing";
import {
  addPhoto,
  BRUNO,
  draft,
  member,
  published,
  representative,
  staffAdmin,
} from "./testing";
import { transitionAdoptionListing } from "./transition";

async function statusOf(h: Harness, id: string) {
  const [row] = await h.db
    .select({
      status: adoptionListing.status,
      publishedAt: adoptionListing.publishedAt,
      closedAt: adoptionListing.closedAt,
    })
    .from(adoptionListing)
    .where(eq(adoptionListing.id, id));
  return row;
}

async function auditActions(h: Harness, id: string) {
  const rows = await h.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.entityId, id))
    .orderBy(auditLog.id);
  return rows.map((row) => row.action);
}

describe("photos", () => {
  it("presigns a photo upload, places it last and makes its copies", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await draft(h, rep);

    await addPhoto(h, rep, adoptionListingId, { altText: "Bruno, front" });
    await addPhoto(h, rep, adoptionListingId, {
      altText: "Bruno, asleep",
      process: false,
    });

    const mine = await h
      .as(rep.actor)
      .getAdoptionListingForOwner({ adoptionListingId });
    if (!mine.ok) throw new Error(mine.error);
    expect(
      mine.listing.photos.map(({ position, altText, state, processing }) => ({
        position,
        altText,
        state,
        processing,
      }))
    ).toEqual([
      {
        position: 1,
        altText: "Bruno, front",
        state: "ready",
        processing: "done",
      },
      {
        position: 2,
        altText: "Bruno, asleep",
        state: "scanning",
        processing: "queued",
      },
    ]);
    expect(mine.listing.photos[0]?.variants.map((v) => v.kind)).toEqual([
      "thumb_320",
      "display_800",
      "display_1600",
    ]);
    expect(mine.listing.publishBlockers).toEqual([]);
  });

  it("needs a text alternative of at most 150 characters", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await draft(h, rep);
    const ask = (altText: string) =>
      h.as(rep.actor).requestAdoptionPhotoUpload({
        adoptionListingId,
        altText,
        contentType: "image/jpeg",
        sizeBytes: 1000,
      });
    expect(await ask("   ")).toEqual({ ok: false, error: "alt_required" });
    expect(await ask("a".repeat(151))).toEqual({
      ok: false,
      error: "alt_too_long",
    });
  });

  it("refuses a ninth photo and a type that isn't an image", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await draft(h, rep);
    const ask = (contentType = "image/jpeg") =>
      h.as(rep.actor).requestAdoptionPhotoUpload({
        adoptionListingId,
        altText: "Bruno",
        contentType,
        sizeBytes: 1000,
      });
    expect(await ask("application/pdf")).toEqual({
      ok: false,
      error: "type_not_allowed",
    });
    for (let i = 0; i < 8; i++) expect((await ask()).ok).toBe(true);
    expect(await ask()).toEqual({ ok: false, error: "too_many_photos" });
  });

  it("changes a text alternative, and removes a photo", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await draft(h, rep);
    const first = await addPhoto(h, rep, adoptionListingId);
    const second = await addPhoto(h, rep, adoptionListingId);

    expect(
      await h.as(rep.actor).describeAdoptionPhoto({
        photoId: first.photoId,
        altText: "Bruno, up close",
      })
    ).toMatchObject({ ok: true });
    expect(
      await h.as(rep.actor).removeAdoptionPhoto({ photoId: second.photoId })
    ).toMatchObject({ ok: true });

    const mine = await h
      .as(rep.actor)
      .getAdoptionListingForOwner({ adoptionListingId });
    expect(mine.ok && mine.listing.photos.map((p) => p.altText)).toEqual([
      "Bruno, up close",
    ]);
  });

  it("keeps a public animal's last ready photo", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const animal = await published(h, rep);
    expect(
      await h.as(rep.actor).removeAdoptionPhoto({ photoId: animal.photoId })
    ).toEqual({ ok: false, error: "last_photo" });
    await addPhoto(h, rep, animal.adoptionListingId);
    expect(
      await h.as(rep.actor).removeAdoptionPhoto({ photoId: animal.photoId })
    ).toMatchObject({ ok: true });
  });

  it.each([
    ["another listing's representative", "other"],
    ["a member", "member"],
    ["a staff admin", "staff"],
    ["a visitor", "visitor"],
  ] as const)("refuses %s every photo change", async (_, who) => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await draft(h, rep);
    const photo = await addPhoto(h, rep, adoptionListingId);
    const actor =
      who === "other"
        ? (await representative(h)).actor
        : who === "member"
          ? await member(h)
          : who === "staff"
            ? await staffAdmin(h)
            : h.visitor();
    const as = h.as(actor);
    await expect(
      as.requestAdoptionPhotoUpload({
        adoptionListingId,
        altText: "x",
        contentType: "image/jpeg",
        sizeBytes: 10,
      })
    ).rejects.toThrow(DomainError);
    await expect(
      as.describeAdoptionPhoto({ photoId: photo.photoId, altText: "x" })
    ).rejects.toThrow(DomainError);
    await expect(
      as.removeAdoptionPhoto({ photoId: photo.photoId })
    ).rejects.toThrow(DomainError);
  });
});

describe("publishing and the other moves", () => {
  it("won't publish a draft without a ready photo", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await draft(h, rep);
    await addPhoto(h, rep, adoptionListingId, { process: false });

    expect(
      await h.as(rep.actor).publishAdoptionListing({ adoptionListingId })
    ).toEqual({ ok: false, error: "publish_blocked", blockers: ["no_photo"] });
    expect((await statusOf(h, adoptionListingId))?.status).toBe("draft");
  });

  it("publishes, holds, resumes and withdraws, with times and audit rows", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId, slug } = await draft(h, rep);
    await addPhoto(h, rep, adoptionListingId);
    const as = h.as(rep.actor);

    const publishedAt = h.clock.now();
    expect(await as.publishAdoptionListing({ adoptionListingId })).toEqual({
      ok: true,
      slug,
      directoryListingId: rep.listingId,
      status: "published",
    });
    h.clock.advance({ days: 1 });
    expect(await as.holdAdoptionListing({ adoptionListingId })).toMatchObject({
      ok: true,
      status: "on_hold",
    });
    h.clock.advance({ days: 1 });
    expect(await as.resumeAdoptionListing({ adoptionListingId })).toMatchObject(
      {
        ok: true,
        status: "published",
      }
    );
    // A resume keeps its first publication's place in browse.
    expect(await statusOf(h, adoptionListingId)).toEqual({
      status: "published",
      publishedAt,
      closedAt: null,
    });
    h.clock.advance({ days: 1 });
    expect(
      await as.withdrawAdoptionListing({ adoptionListingId })
    ).toMatchObject({ ok: true, status: "withdrawn" });
    expect(await statusOf(h, adoptionListingId)).toEqual({
      status: "withdrawn",
      publishedAt,
      closedAt: h.clock.now(),
    });
    expect(await auditActions(h, adoptionListingId)).toEqual([
      "adoption.listing_created",
      "adoption.photo_added",
      "adoption.listing_published",
      "adoption.listing_held",
      "adoption.listing_resumed",
      "adoption.listing_withdrawn",
    ]);
  });

  it("refuses a move the table doesn't allow and leaves the row", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await draft(h, rep);
    const as = h.as(rep.actor);

    expect(await as.holdAdoptionListing({ adoptionListingId })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(await as.resumeAdoptionListing({ adoptionListingId })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    await as.withdrawAdoptionListing({ adoptionListingId });
    expect(await as.publishAdoptionListing({ adoptionListingId })).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect((await statusOf(h, adoptionListingId))?.status).toBe("withdrawn");
  });

  it("lets only the coordinator record an adoption, through the writer", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await published(h, rep);
    const move = (by: "representative" | "coordinator") =>
      h.db.transaction((tx) =>
        transitionAdoptionListing(
          { clock: h.clock, actor: { kind: "system", process: "worker" } },
          tx,
          {
            listingId: adoptionListingId,
            to: "adopted",
            by,
            actorRole: null,
          }
        )
      );
    expect(await move("representative")).toEqual({
      ok: false,
      error: "invalid_transition",
    });
    expect(await move("coordinator")).toMatchObject({
      ok: true,
      from: "published",
      to: "adopted",
    });
    expect(await statusOf(h, adoptionListingId)).toMatchObject({
      status: "adopted",
      closedAt: h.clock.now(),
    });
  });

  it("re-checks the directory listing when publishing and resuming", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const ready = await draft(h, rep);
    await addPhoto(h, rep, ready.adoptionListingId);
    const held = await published(h, rep, { name: "Kalu" });
    await h.as(rep.actor).holdAdoptionListing({
      adoptionListingId: held.adoptionListingId,
    });
    const staff = await signedInStaff(h);
    await h
      .as(staff)
      .suspendListing({ listingId: rep.listingId, reason: "A complaint" });

    expect(
      await h
        .as(rep.actor)
        .publishAdoptionListing({ adoptionListingId: ready.adoptionListingId })
    ).toEqual({
      ok: false,
      error: "publish_blocked",
      blockers: ["directory_not_verified"],
    });
    expect(
      await h
        .as(rep.actor)
        .resumeAdoptionListing({ adoptionListingId: held.adoptionListingId })
    ).toEqual({ ok: false, error: "directory_not_verified" });
    // Taking an animal down is always allowed.
    expect(
      await h
        .as(rep.actor)
        .withdrawAdoptionListing({ adoptionListingId: held.adoptionListingId })
    ).toMatchObject({ ok: true });
  });

  it.each([
    ["another listing's representative", "other"],
    ["a member", "member"],
    ["a staff admin", "staff"],
    ["a visitor", "visitor"],
  ] as const)("refuses %s every move and owner read", async (_, who) => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await published(h, rep);
    const actor =
      who === "other"
        ? (await representative(h)).actor
        : who === "member"
          ? await member(h)
          : who === "staff"
            ? await staffAdmin(h)
            : h.visitor();
    const as = h.as(actor);
    for (const call of [
      () => as.publishAdoptionListing({ adoptionListingId }),
      () => as.holdAdoptionListing({ adoptionListingId }),
      () => as.resumeAdoptionListing({ adoptionListingId }),
      () => as.withdrawAdoptionListing({ adoptionListingId }),
      () => as.getAdoptionListingForOwner({ adoptionListingId }),
      () => as.listAdoptionListings({ directoryListingId: rep.listingId }),
      () => as.updateAdoptionListing({ adoptionListingId, ...BRUNO }),
    ]) {
      await expect(call()).rejects.toThrow(DomainError);
    }
    expect((await statusOf(h, adoptionListingId))?.status).toBe("published");
  });
});

describe("updateAdoptionListing", () => {
  it("edits a draft, a published and an on-hold animal, keeping the slug", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const animal = await published(h, rep);
    const as = h.as(rep.actor);

    const result = await as.updateAdoptionListing({
      adoptionListingId: animal.adoptionListingId,
      ...BRUNO,
      name: "Bruno the Brave",
      city: "Mumbai",
    });
    expect(result).toMatchObject({
      ok: true,
      slug: animal.slug,
      status: "published",
      changed: true,
    });
    const page = await h
      .as(h.visitor())
      .getAdoptableAnimal({ slug: animal.slug });
    expect(page.ok && [page.animal.name, page.animal.city]).toEqual([
      "Bruno the Brave",
      "Mumbai",
    ]);
    const [audit] = await h.db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.action, "adoption.listing_updated"));
    expect(audit?.after).toEqual({ fields: ["city", "cityKey", "name"] });

    await as.holdAdoptionListing({
      adoptionListingId: animal.adoptionListingId,
    });
    expect(
      await as.updateAdoptionListing({
        adoptionListingId: animal.adoptionListingId,
        ...BRUNO,
      })
    ).toMatchObject({ ok: true, status: "on_hold", changed: true });
    expect(
      await as.updateAdoptionListing({
        adoptionListingId: animal.adoptionListingId,
        ...BRUNO,
      })
    ).toMatchObject({ ok: true, changed: false });
  });

  it("refuses edits and photos once the listing is closed", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await draft(h, rep);
    await h.as(rep.actor).withdrawAdoptionListing({ adoptionListingId });
    expect(
      await h
        .as(rep.actor)
        .updateAdoptionListing({ adoptionListingId, ...BRUNO })
    ).toEqual({ ok: false, error: "listing_closed" });
    expect(
      await h.as(rep.actor).requestAdoptionPhotoUpload({
        adoptionListingId,
        altText: "Bruno",
        contentType: "image/jpeg",
        sizeBytes: 100,
      })
    ).toEqual({ ok: false, error: "listing_closed" });
  });
});

describe("listAdoptionListings", () => {
  it("lists a directory listing's animals in every status, newest first", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const first = await published(h, rep, { name: "Bruno" });
    h.clock.advance({ minutes: 1 });
    const second = await draft(h, rep, { name: "Kalu", species: "cat" });
    await draft(h, await representative(h), { name: "Not mine" });

    const result = await h
      .as(rep.actor)
      .listAdoptionListings({ directoryListingId: rep.listingId });
    if (!result.ok) throw new Error(result.error);
    expect(
      result.listings.map(({ id, name, status, photoCount }) => ({
        id,
        name,
        status,
        photoCount,
      }))
    ).toEqual([
      {
        id: second.adoptionListingId,
        name: "Kalu",
        status: "draft",
        photoCount: 0,
      },
      {
        id: first.adoptionListingId,
        name: "Bruno",
        status: "published",
        photoCount: 1,
      },
    ]);
    expect(result.listings[1]?.cover?.url).toBe(
      `/media/adoption/${first.photoId}/thumb_320`
    );
  });
});
