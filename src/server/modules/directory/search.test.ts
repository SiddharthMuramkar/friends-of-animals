import { describe, expect, it } from "vitest";

import { createHarness, type Harness } from "@/test/harness";

import { signedInStaff } from "./testing";

// Pin-code centres around central Pune. The distances from 411001 were
// worked out by hand with the haversine formula on earthdistance's sphere
// (radius 6378168 m), the same values as ./domain/geo.test.ts, and checked
// with an independent script; the search's SQL must agree to a millimetre.
const CENTRES = [
  { pinCode: "411001", place: "Pune GPO", latitude: 18.52, longitude: 73.86 },
  { pinCode: "411004", place: "Deccan", latitude: 18.52, longitude: 73.84 },
  { pinCode: "411038", place: "Kothrud", latitude: 18.51, longitude: 73.81 },
  {
    pinCode: "411014",
    place: "Viman Nagar",
    latitude: 18.57,
    longitude: 73.91,
  },
  { pinCode: "412105", place: "Alandi", latitude: 18.68, longitude: 73.9 },
  { pinCode: "410506", place: "Talegaon", latitude: 18.73, longitude: 73.68 },
  {
    pinCode: "400001",
    place: "Mumbai Fort",
    latitude: 18.94,
    longitude: 72.84,
  },
] as const;

const HAND_COMPUTED_METRES = {
  "411001": 0,
  "411004": 2111.1017,
  "411038": 5394.0274,
  "411014": 7669.8705,
  "412105": 18304.3521,
  "410506": 30117.1993,
  "400001": 117257.3178,
} as const;

async function puneWorld(h: Harness) {
  await h.seed.pincodeCentres(
    CENTRES.map(({ pinCode, latitude, longitude }) => ({
      pinCode,
      latitude,
      longitude,
      district: "Pune",
      state: "Maharashtra",
      postOffices: 1,
    }))
  );
  // Listed out of distance order, so the order can't come from insertion.
  const listings: Record<string, string> = {};
  for (const centre of [...CENTRES].reverse()) {
    const { slug } = await h.seed.directoryListing({
      name: `${centre.place} Paws`,
      pinCode: centre.pinCode,
      city: centre.place,
      services:
        centre.pinCode === "411038" ? ["shelter"] : ["rescue", "shelter"],
    });
    listings[centre.pinCode] = slug;
  }
  return listings;
}

describe("searchListings", () => {
  it("lists verified listings within the radius, nearest first, at the hand-computed distances", async () => {
    const h = await createHarness();
    const slugs = await puneWorld(h);

    const result = await h
      .as(h.visitor())
      .searchListings({ pin: "411001", radius: "50" });

    expect(result).toMatchObject({
      ok: true,
      origin: { kind: "pin", pinCode: "411001", district: "Pune" },
      radiusKm: 50,
      service: null,
      truncated: false,
    });
    if (!result.ok) return;
    // Mumbai Fort, 117 km away, is outside 50 km.
    const order = [
      "411001",
      "411004",
      "411038",
      "411014",
      "412105",
      "410506",
    ] as const;
    expect(result.results.map((r) => r.listing.slug)).toEqual(
      order.map((pin) => slugs[pin])
    );
    result.results.forEach((found, index) => {
      expect(found.distanceMetres).toBeCloseTo(
        HAND_COMPUTED_METRES[order[index]!],
        3
      );
    });
    expect(result.results.map((r) => r.distance)).toEqual([
      { kind: "under", km: 1 },
      { kind: "about", km: 2.1 },
      { kind: "about", km: 5.4 },
      { kind: "about", km: 7.7 },
      { kind: "about", km: 18 },
      { kind: "about", km: 30 },
    ]);
  });

  it("leaves out listings beyond a smaller radius", async () => {
    const h = await createHarness();
    const slugs = await puneWorld(h);

    const result = await h
      .as(h.visitor())
      .searchListings({ pin: "411001", radius: "5" });

    expect(result.ok && result.results.map((r) => r.listing.slug)).toEqual([
      slugs["411001"],
      slugs["411004"],
    ]);
  });

  it("gives a pin-code search and a location search from the same point the same results", async () => {
    const h = await createHarness();
    await puneWorld(h);

    const byPin = await h
      .as(h.visitor())
      .searchListings({ pin: "411001", radius: "25", service: "rescue" });
    const byPoint = await h.as(h.visitor()).searchListings({
      lat: "18.520",
      lng: "73.860",
      radius: "25",
      service: "rescue",
    });

    expect(byPin.ok).toBe(true);
    expect(byPoint).toMatchObject({
      ok: true,
      origin: { kind: "point", latitude: 18.52, longitude: 73.86 },
    });
    if (!byPin.ok || !byPoint.ok) return;
    expect(byPoint.results).toEqual(byPin.results);
    expect(byPin.results).toHaveLength(4);
  });

  it("finds only listings offering the chosen service", async () => {
    const h = await createHarness();
    const slugs = await puneWorld(h);

    const rescue = await h
      .as(h.visitor())
      .searchListings({ pin: "411001", radius: "10", service: "rescue" });

    // Kothrud's listing is a shelter only.
    expect(rescue.ok && rescue.results.map((r) => r.listing.slug)).toEqual([
      slugs["411001"],
      slugs["411004"],
      slugs["411014"],
    ]);
  });

  it("never shows a listing that isn't verified, to anyone, staff included", async () => {
    const h = await createHarness();
    await h.seed.pincodeCentres([
      {
        pinCode: "411001",
        latitude: 18.52,
        longitude: 73.86,
        district: "Pune",
        state: "Maharashtra",
        postOffices: 1,
      },
    ]);
    const verified = await h.seed.directoryListing({
      name: "Verified Paws",
      pinCode: "411001",
    });
    for (const status of [
      "pending_verification",
      "rejected",
      "suspended",
      "withdrawn",
    ] as const) {
      await h.seed.directoryListing({
        name: `${status} Paws`,
        status,
        pinCode: "411001",
      });
    }
    const member = await h.signIn(await h.seed.member());
    const staff = await signedInStaff(h);

    for (const who of [h.visitor(), member, staff]) {
      const result = await h.as(who).searchListings({ pin: "411001" });
      expect(result.ok && result.results.map((r) => r.listing.slug)).toEqual([
        verified.slug,
      ]);
    }
  });

  it("shows each result's public details only: services, place and the contacts it chose", async () => {
    const h = await createHarness();
    await h.seed.pincodeCentres([
      {
        pinCode: "411001",
        latitude: 18.52,
        longitude: 73.86,
        district: "Pune",
        state: "Maharashtra",
        postOffices: 1,
      },
    ]);
    const { slug, owner, listingId } = await h.seed.directoryListing({
      name: "Shown Paws",
      pinCode: "411001",
      services: ["rescue", "ambulance"],
    });

    const result = await h.as(h.visitor()).searchListings({ pin: "411001" });

    expect(result.ok && result.results).toEqual([
      {
        listing: {
          slug,
          type: "ngo",
          name: "Shown Paws",
          description: expect.any(String),
          services: ["rescue", "ambulance"],
          city: "Pune",
          state: "Maharashtra",
          pinCode: "411001",
          contact: {
            phone: expect.stringMatching(/^\+91/),
            email: expect.stringContaining("@example.test"),
          },
        },
        distanceMetres: 0,
        distance: { kind: "under", km: 1 },
      },
    ]);
    const shown = JSON.stringify(result);
    expect(shown).not.toContain("Seed Lane");
    expect(shown).not.toContain(owner.id);
    expect(shown).not.toContain(listingId);
  });

  it("can't place a listing whose pin code has no known centre", async () => {
    const h = await createHarness();
    await h.seed.pincodeCentres([
      {
        pinCode: "411001",
        latitude: 18.52,
        longitude: 73.86,
        district: "Pune",
        state: "Maharashtra",
        postOffices: 1,
      },
    ]);
    await h.seed.directoryListing({ name: "Nowhere Paws", pinCode: "411002" });

    expect(
      await h.as(h.visitor()).searchListings({ pin: "411001", radius: "50" })
    ).toMatchObject({ ok: true, results: [] });
  });

  it("says when it doesn't know the pin code searched for", async () => {
    const h = await createHarness();
    await puneWorld(h);

    expect(await h.as(h.visitor()).searchListings({ pin: "799999" })).toEqual({
      ok: false,
      error: "unknown_pin_code",
    });
  });

  it("names every field at fault", async () => {
    const h = await createHarness();

    expect(
      await h
        .as(h.visitor())
        .searchListings({ pin: "12", service: "dancing", radius: "7" })
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["pin", "service", "radius"],
      problems: { pin: "invalid", service: "invalid", radius: "invalid" },
    });
    expect(
      await h.as(h.visitor()).searchListings({ lat: "51.5", lng: "-0.13" })
    ).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["location"],
      problems: { location: "outside_india" },
    });
    expect(await h.as(h.visitor()).searchListings({})).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["pin"],
      problems: { pin: "required" },
    });
  });

  it("stops at the result limit and says there are more", async () => {
    const h = await createHarness();
    await h.seed.pincodeCentres([
      {
        pinCode: "411001",
        latitude: 18.52,
        longitude: 73.86,
        district: "Pune",
        state: "Maharashtra",
        postOffices: 1,
      },
    ]);
    for (let n = 0; n < 51; n += 1) {
      await h.seed.directoryListing({ name: `Many Paws`, pinCode: "411001" });
    }

    const result = await h.as(h.visitor()).searchListings({ pin: "411001" });

    expect(result).toMatchObject({ ok: true, truncated: true });
    expect(result.ok && result.results).toHaveLength(50);
  });
});
