import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { adoptionListing, adoptionListingPhoto } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_ADOPTION } from "./adoption";
import { SEED_DIRECTORY } from "./directory";

describe("seedAdoption", () => {
  it("leaves the same animals however often it runs", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const first = await h.db
      .select({ id: adoptionListing.id, status: adoptionListing.status })
      .from(adoptionListing)
      .orderBy(asc(adoptionListing.id));
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    expect(
      await h.db
        .select({ id: adoptionListing.id, status: adoptionListing.status })
        .from(adoptionListing)
        .orderBy(asc(adoptionListing.id))
    ).toEqual(first);
    expect(first.map((row) => row.status).toSorted()).toEqual([
      "adopted",
      "draft",
      "on_hold",
      "published",
      "published",
      "published",
      "published",
      "published",
      "published",
      "published",
    ]);
    expect(await h.db.select().from(adoptionListingPhoto)).toHaveLength(10);
  });

  it("gives /adopt six animals over three species and three cities, with photos", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const visitor = h.as(h.visitor());

    const { animals } = await visitor.browseAdoptableAnimals();
    expect(animals).toHaveLength(6);
    expect(new Set(animals.map((a) => a.species)).size).toBeGreaterThanOrEqual(
      3
    );
    expect(new Set(animals.map((a) => a.city)).size).toBeGreaterThanOrEqual(3);
    expect(animals.every((a) => a.cover !== null)).toBe(true);
    // The suspended foster home's animal stays hidden.
    expect(animals.map((a) => a.slug)).not.toContain(SEED_ADOPTION.hidden);
    expect(
      await visitor.getAdoptableAnimal({ slug: SEED_ADOPTION.hidden })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await visitor.getAdoptableAnimal({ slug: SEED_ADOPTION.onHold })
    ).toMatchObject({ ok: true, animal: { status: "on_hold" } });

    const cover = animals[0]?.cover?.variants[0];
    if (!cover) throw new Error("no cover");
    const [, , , photoId, kind] = cover.url.split("/");
    expect(
      await visitor.readAdoptionPhoto({ photoId: photoId!, kind: kind! })
    ).toMatchObject({ ok: true, contentType: "image/webp" });
  });

  it("lets the NGO's representative finish and publish its draft", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const rep = await h.signIn(SEED_DIRECTORY.ngo.representative);

    const list = await h
      .as(rep)
      .listAdoptionListings({ directoryListingId: SEED_DIRECTORY.ngo.id });
    expect(list.ok && list.listings.map((l) => l.status).toSorted()).toEqual([
      "adopted",
      "draft",
      "on_hold",
      "published",
      "published",
      "published",
    ]);
    expect(
      await h
        .as(rep)
        .publishAdoptionListing({ adoptionListingId: SEED_ADOPTION.draftId })
    ).toMatchObject({ ok: true, status: "published" });
  });
});
