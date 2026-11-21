import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { findAdoptionListingForOwner } from "./owner-read";
import { SHELTER_A, draftListing } from "./testing";

describe("insertAdoptionListingDraft", () => {
  it("creates a draft under the directory listing, with every detail as entered", async () => {
    const h = await createHarness();

    const { id, slug } = await draftListing(h);

    expect(await findAdoptionListingForOwner(h.deps, id)).toEqual({
      id,
      slug,
      directoryListingId: SHELTER_A,
      status: "draft",
      name: "Bruno",
      species: "dog",
      breed: "Indie",
      sex: "male",
      size: "medium",
      colour: "Brown and white",
      birthMonth: "2024-12",
      age: { years: 2, months: 1 },
      sterilised: true,
      about: "Calm, loves long walks.",
      healthNotes: "Healthy. Dewormed in December.",
      vaccinationNotes: "Anti-rabies and DHPPi, December 2026.",
      conditions: "Indoor home only. Home visit before adoption.",
      state: "maharashtra",
      city: "Pune",
      pinCode: "411001",
      publishedAt: null,
      closedAt: null,
      createdAt: new Date("2027-01-15T04:30:00.000Z"),
      updatedAt: new Date("2027-01-15T04:30:00.000Z"),
    });
  });

  it("makes the slug from the name, species and city", async () => {
    const h = await createHarness();

    const { slug } = await draftListing(h, { name: "Rani", city: "New Delhi" });

    expect(slug).toBe("rani-dog-new-delhi");
  });

  it("numbers the slug when other animals already hold it", async () => {
    const h = await createHarness();

    const first = await draftListing(h);
    const second = await draftListing(h);
    const third = await draftListing(h);

    expect([first.slug, second.slug, third.slug]).toEqual([
      "bruno-dog-pune",
      "bruno-dog-pune-2",
      "bruno-dog-pune-3",
    ]);
  });

  it("stores a birth month, never an age, so the age shown follows the clock", async () => {
    const h = await createHarness();
    const { id } = await draftListing(h, { age: { years: 0, months: 3 } });

    h.clock.advance({ days: 90 });

    expect(await findAdoptionListingForOwner(h.deps, id)).toMatchObject({
      birthMonth: "2026-10",
      age: { years: 0, months: 6 },
    });
  });

  it("finds nothing for an id no listing has", async () => {
    const h = await createHarness();

    expect(
      await findAdoptionListingForOwner(
        h.deps,
        "01950000-0000-7000-8000-0000000000ff"
      )
    ).toBeNull();
  });
});
