// What the public sees of adoption (#129): filters, keyset pages, one
// animal's page, the photo route's use case, and suspension of the
// organisation hiding everything at once.

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { fileAsset, fileDerivative } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { signedInStaff } from "../directory/testing";
import type { AdoptionListingDetailsInput } from "./domain/details";
import { ADOPTION_PAGE_SIZE } from "./domain/filters";
import { ADOPTION_PHOTO_KINDS } from "./domain/photos";
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

type Rep = Awaited<ReturnType<typeof representative>>;

/** A published animal without photos: straight through the writer. */
async function listed(
  h: Harness,
  rep: Rep,
  details: Partial<AdoptionListingDetailsInput>
) {
  const created = await draft(h, rep, details);
  await moveTo(h, created.adoptionListingId, "published");
  return created;
}

async function moveTo(
  h: Harness,
  listingId: string,
  to: "published" | "on_hold" | "withdrawn"
) {
  const result = await h.db.transaction((tx) =>
    transitionAdoptionListing(
      { clock: h.clock, actor: { kind: "system", process: "seed" } },
      tx,
      { listingId, to, by: "representative", actorRole: null }
    )
  );
  if (!result.ok) throw new Error(result.error);
}

async function browseSlugs(
  h: Harness,
  filters: Parameters<
    ReturnType<Harness["as"]>["browseAdoptableAnimals"]
  >[0] = {}
) {
  const page = await h.as(h.visitor()).browseAdoptableAnimals(filters);
  return page.animals.map((animal) => animal.slug);
}

/**
 * Ten animals, published a minute apart in this order, so newest first is
 * the reverse. Ages are as of the harness's January 2027.
 */
async function fixture(h: Harness) {
  const rep = await representative(h);
  const rows: [string, Partial<AdoptionListingDetailsInput>][] = [
    [
      "puppy",
      {
        species: "dog",
        age: { years: 0, months: 3 },
        sex: "female",
        size: "small",
        city: "Pune",
        sterilised: false,
      },
    ],
    [
      "kitten",
      {
        species: "cat",
        age: { years: 0, months: 4 },
        sex: "male",
        size: "small",
        city: "pune",
        sterilised: null,
      },
    ],
    [
      "young-dog",
      {
        species: "dog",
        age: { years: 1, months: 0 },
        sex: "male",
        size: "medium",
        city: "Mumbai",
        sterilised: true,
      },
    ],
    [
      "adult-cat",
      {
        species: "cat",
        age: { years: 3, months: 0 },
        sex: "female",
        size: "small",
        city: "Mumbai",
        sterilised: true,
      },
    ],
    [
      "adult-dog",
      {
        species: "dog",
        age: { years: 5, months: 0 },
        sex: "female",
        size: "large",
        city: "Pune",
        sterilised: true,
      },
    ],
    [
      "senior-dog",
      {
        species: "dog",
        age: { years: 9, months: 0 },
        sex: "male",
        size: "large",
        city: "Nagpur",
        sterilised: true,
      },
    ],
    [
      "rabbit",
      {
        species: "rabbit",
        age: { years: 1, months: 6 },
        sex: "unknown",
        size: "small",
        city: "Pune",
        sterilised: false,
      },
    ],
    [
      "parrot",
      {
        species: "bird",
        age: { years: 12, months: 0 },
        sex: "unknown",
        size: null,
        city: "Bengaluru",
        state: "karnataka",
        pinCode: "560001",
        sterilised: null,
      },
    ],
    [
      "goa-cat",
      {
        species: "cat",
        age: { years: 7, months: 11 },
        sex: "male",
        size: "medium",
        city: "Panaji",
        state: "goa",
        pinCode: "403001",
        sterilised: true,
      },
    ],
    [
      "calf",
      {
        species: "other",
        age: { years: 0, months: 8 },
        sex: "female",
        size: "large",
        city: "Nagpur",
        sterilised: false,
      },
    ],
  ];
  const slugs: Record<string, string> = {};
  for (const [name, details] of rows) {
    const created = await listed(h, rep, { ...BRUNO, name, ...details });
    slugs[name] = created.slug;
    h.clock.advance({ minutes: 1 });
  }
  const names = (...wanted: string[]) => wanted.map((name) => slugs[name]);
  return { rep, slugs, names };
}

describe("browseAdoptableAnimals", () => {
  it("lists published animals newest first, and each filter returns the right ones", async () => {
    const h = await createHarness();
    const { names } = await fixture(h);

    expect(await browseSlugs(h)).toEqual(
      names(
        "calf",
        "goa-cat",
        "parrot",
        "rabbit",
        "senior-dog",
        "adult-dog",
        "adult-cat",
        "young-dog",
        "kitten",
        "puppy"
      )
    );
    const cases: [Parameters<typeof browseSlugs>[1], string[]][] = [
      [
        { filters: { species: "dog" } },
        ["senior-dog", "adult-dog", "young-dog", "puppy"],
      ],
      [{ filters: { age: "baby" } }, ["kitten", "puppy"]],
      [{ filters: { age: "young" } }, ["calf", "rabbit", "young-dog"]],
      [{ filters: { age: "adult" } }, ["goa-cat", "adult-dog", "adult-cat"]],
      [{ filters: { age: "senior" } }, ["parrot", "senior-dog"]],
      [
        { filters: { sex: "female" } },
        ["calf", "adult-dog", "adult-cat", "puppy"],
      ],
      [{ filters: { size: "medium" } }, ["goa-cat", "young-dog"]],
      [{ filters: { state: "goa" } }, ["goa-cat"]],
      // Without case or extra spaces.
      [
        { filters: { city: "  PUNE " } },
        ["rabbit", "adult-dog", "kitten", "puppy"],
      ],
      [{ filters: { pin: "560001" } }, ["parrot"]],
      [
        { filters: { sterilised: true } },
        ["goa-cat", "senior-dog", "adult-dog", "adult-cat", "young-dog"],
      ],
      [
        { filters: { species: "cat", sterilised: true } },
        ["goa-cat", "adult-cat"],
      ],
      [
        { filters: { species: "dog", age: "adult", city: "pune" } },
        ["adult-dog"],
      ],
    ];
    for (const [input, expected] of cases) {
      expect(await browseSlugs(h, input), JSON.stringify(input)).toEqual(
        names(...expected)
      );
    }
  });

  it("moves an animal across age bands as the months pass", async () => {
    const h = await createHarness();
    const { names } = await fixture(h);
    h.clock.advance({ days: 31 * 4 });
    // The goa cat turns 8 in February; the puppy turns 6 months in April.
    expect(await browseSlugs(h, { filters: { age: "senior" } })).toEqual(
      names("goa-cat", "parrot", "senior-dog")
    );
    expect(await browseSlugs(h, { filters: { age: "baby" } })).toEqual([]);
  });

  it("leaves out drafts, held, withdrawn and adopted animals", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const shown = await listed(h, rep, { name: "Shown" });
    await draft(h, rep, { name: "Drafted" });
    const held = await listed(h, rep, { name: "Held" });
    await moveTo(h, held.adoptionListingId, "on_hold");
    const gone = await listed(h, rep, { name: "Gone" });
    await moveTo(h, gone.adoptionListingId, "withdrawn");
    const adopted = await listed(h, rep, { name: "Adopted" });
    await h.db.transaction((tx) =>
      transitionAdoptionListing(
        { clock: h.clock, actor: { kind: "system", process: "seed" } },
        tx,
        {
          listingId: adopted.adoptionListingId,
          to: "adopted",
          by: "coordinator",
          actorRole: null,
        }
      )
    );
    expect(await browseSlugs(h)).toEqual([shown.slug]);
  });

  it("pages by cursor with no animal missed or repeated", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const made: string[] = [];
    for (let i = 0; i < ADOPTION_PAGE_SIZE + 3; i++) {
      // Pairs published in the same instant: the id breaks the tie.
      if (i % 2 === 0) h.clock.advance({ minutes: 1 });
      made.push((await listed(h, rep, { name: `Animal ${i}` })).slug);
    }
    const visitor = h.as(h.visitor());
    const first = await visitor.browseAdoptableAnimals();
    expect(first.animals).toHaveLength(ADOPTION_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    // A newer animal published between the pages changes nothing.
    h.clock.advance({ minutes: 1 });
    await listed(h, rep, { name: "Latecomer" });
    const second = await visitor.browseAdoptableAnimals({
      cursor: first.nextCursor,
    });
    expect(second.nextCursor).toBeNull();
    const seen = [...first.animals, ...second.animals].map((a) => a.slug);
    expect(seen).toHaveLength(made.length);
    expect(new Set(seen)).toEqual(new Set(made));
    // A cursor that isn't one gives the first page.
    expect(
      (await visitor.browseAdoptableAnimals({ cursor: "not-a-cursor" }))
        .animals[0]?.name
    ).toBe("Latecomer");
  });

  it("is open to anyone: a visitor, a member, staff", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { slug } = await listed(h, rep, { name: "Open" });
    for (const actor of [h.visitor(), await member(h), await staffAdmin(h)]) {
      const page = await h.as(actor).browseAdoptableAnimals();
      expect(page.animals.map((a) => a.slug)).toEqual([slug]);
    }
  });
});

describe("photos are public only as derived copies", () => {
  it("never names a storage key, and every image is a /media/adoption copy", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const animal = await published(h, rep);
    await addPhoto(h, rep, animal.adoptionListingId, { altText: "Second" });

    const visitor = h.as(h.visitor());
    const browse = await visitor.browseAdoptableAnimals();
    const page = await visitor.getAdoptableAnimal({ slug: animal.slug });
    const json = JSON.stringify({ browse, page });
    const keys = [
      ...(await h.db.select({ key: fileAsset.storageKey }).from(fileAsset)),
      ...(await h.db
        .select({ key: fileDerivative.storageKey })
        .from(fileDerivative)),
    ].map((row) => row.key);
    expect(keys.length).toBeGreaterThan(2);
    for (const key of keys) expect(json).not.toContain(key);

    if (!page.ok) throw new Error(page.error);
    const urls = page.animal.photos.flatMap((p) =>
      p.variants.map((v) => v.url)
    );
    expect(urls).toHaveLength(2 * ADOPTION_PHOTO_KINDS.length);
    for (const url of urls) {
      expect(url).toMatch(
        /^\/media\/adoption\/[0-9a-f-]{36}\/(thumb_320|display_800|display_1600)$/
      );
    }
    expect(page.animal.photos.map((p) => p.alt)).toEqual([
      "Bruno sitting on a step",
      "Second",
    ]);
  });

  it("serves a public animal's copy, and nothing else", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const animal = await published(h, rep);
    const visitor = h.as(h.visitor());

    const read = await visitor.readAdoptionPhoto({
      photoId: animal.photoId,
      kind: "display_800",
    });
    if (!read.ok) throw new Error(read.error);
    expect(read).toMatchObject({ contentType: "image/webp", cacheable: true });
    const [copy] = await h.db
      .select()
      .from(fileDerivative)
      .where(eqKind(animal.fileId, "display_800"));
    const stored = await h.storage.read({
      bucket: copy!.bucket,
      key: copy!.storageKey,
    });
    expect(await bytesOf(read.body)).toEqual(await bytesOf(stored));

    for (const kind of ["original", "thumb_999", ""]) {
      expect(
        await visitor.readAdoptionPhoto({ photoId: animal.photoId, kind })
      ).toEqual({ ok: false, error: "not_found" });
    }
    expect(
      await visitor.readAdoptionPhoto({
        photoId: "01938a00-0000-7000-8000-000000000000",
        kind: "thumb_320",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("hides an unprocessed photo, and a draft's photos from everyone but its people", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const { adoptionListingId } = await draft(h, rep);
    const ready = await addPhoto(h, rep, adoptionListingId);
    const pending = await addPhoto(h, rep, adoptionListingId, {
      process: false,
    });

    const ask = (actor: Parameters<Harness["as"]>[0], photoId: string) =>
      h.as(actor).readAdoptionPhoto({ photoId, kind: "thumb_320" });
    expect(await ask(h.visitor(), ready.photoId)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await ask(await member(h), ready.photoId)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await ask(rep.actor, ready.photoId)).toMatchObject({
      ok: true,
      cacheable: false,
    });
    expect(await ask(rep.actor, pending.photoId)).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("getAdoptableAnimal", () => {
  it("opens a published, held or adopted animal's page, not a draft's or withdrawn one's", async () => {
    const h = await createHarness();
    const rep = await representative(h, "verified", { name: "Paws Trust" });
    const animal = await published(h, rep);
    const visitor = h.as(h.visitor());

    const page = await visitor.getAdoptableAnimal({ slug: animal.slug });
    expect(page).toMatchObject({
      ok: true,
      animal: {
        name: "Bruno",
        status: "published",
        age: { years: 2, months: 1 },
        ageBand: "adult",
        conditions: BRUNO.conditions,
        organisation: { name: "Paws Trust", slug: rep.slug },
      },
    });
    await h
      .as(rep.actor)
      .holdAdoptionListing({ adoptionListingId: animal.adoptionListingId });
    expect(
      await visitor.getAdoptableAnimal({ slug: animal.slug })
    ).toMatchObject({
      ok: true,
      animal: { status: "on_hold" },
    });
    expect(await visitor.adoptableAnimalSlugs()).toEqual([animal.slug]);
    await h
      .as(rep.actor)
      .withdrawAdoptionListing({ adoptionListingId: animal.adoptionListingId });
    expect(await visitor.getAdoptableAnimal({ slug: animal.slug })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await visitor.adoptableAnimalSlugs()).toEqual([]);
    expect(await visitor.getAdoptableAnimal({ slug: "../etc" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("a suspended directory listing", () => {
  it("hides its animals, pages and photos, and reinstating brings them back unchanged", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const animal = await published(h, rep);
    const staff = await signedInStaff(h);
    const visitor = h.as(h.visitor());
    const photo = { photoId: animal.photoId, kind: "thumb_320" };

    await h
      .as(staff)
      .suspendListing({ listingId: rep.listingId, reason: "Complaint" });
    expect((await visitor.browseAdoptableAnimals()).animals).toEqual([]);
    expect(await visitor.getAdoptableAnimal({ slug: animal.slug })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await visitor.adoptableAnimalSlugs()).toEqual([]);
    expect(await visitor.readAdoptionPhoto(photo)).toEqual({
      ok: false,
      error: "not_found",
    });

    await h
      .as(staff)
      .reinstateListing({ listingId: rep.listingId, reason: "Cleared" });
    expect(
      (await visitor.browseAdoptableAnimals()).animals.map((a) => a.slug)
    ).toEqual([animal.slug]);
    expect(await visitor.readAdoptionPhoto(photo)).toMatchObject({ ok: true });
    const mine = await h.as(rep.actor).getAdoptionListingForOwner({
      adoptionListingId: animal.adoptionListingId,
    });
    expect(mine.ok && mine.listing.status).toBe("published");
  });
});

function eqKind(fileId: string, kind: string) {
  return and(
    eq(fileDerivative.fileAssetId, fileId),
    eq(fileDerivative.kind, kind)
  );
}

async function bytesOf(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
