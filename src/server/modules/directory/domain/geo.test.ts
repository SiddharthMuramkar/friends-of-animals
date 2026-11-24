import { describe, expect, it } from "vitest";

import {
  EARTH_RADIUS_METRES,
  approximateDistance,
  coarsenLocation,
  earthDistanceMetres,
  isInIndia,
} from "./geo";

// Distances from a point in central Pune (18.52, 73.86). Each value was
// worked out by hand with the haversine formula on a sphere of radius
// 6378168 m, earthdistance's earth(), and is what
// `earth_distance(ll_to_earth(...), ll_to_earth(...))` returns. The search's
// SQL (../search.test.ts) is checked against the same values. A different
// radius (6371 km is common) drifts by about 0.1 %, so keep this one.
const ORIGIN = { latitude: 18.52, longitude: 73.86 };
const FIXTURE = [
  { name: "Deccan", latitude: 18.52, longitude: 73.84, metres: 2111.1017 },
  { name: "Kothrud", latitude: 18.51, longitude: 73.81, metres: 5394.0274 },
  { name: "Viman Nagar", latitude: 18.57, longitude: 73.91, metres: 7669.8705 },
  { name: "Alandi", latitude: 18.68, longitude: 73.9, metres: 18304.3521 },
  { name: "Talegaon", latitude: 18.73, longitude: 73.68, metres: 30117.1993 },
  {
    name: "Mumbai Fort",
    latitude: 18.94,
    longitude: 72.84,
    metres: 117257.3178,
  },
] as const;

describe("earthDistanceMetres", () => {
  it("uses earthdistance's sphere", () => {
    expect(EARTH_RADIUS_METRES).toBe(6378168);
  });

  it.each(FIXTURE)("puts $name $metres m from central Pune", (place) => {
    expect(earthDistanceMetres(ORIGIN, place)).toBeCloseTo(place.metres, 3);
  });

  it("orders the fixture nearest first", () => {
    const byDistance = [...FIXTURE]
      .reverse()
      .sort(
        (a, b) =>
          earthDistanceMetres(ORIGIN, a) - earthDistanceMetres(ORIGIN, b)
      )
      .map((place) => place.name);
    expect(byDistance).toEqual(FIXTURE.map((place) => place.name));
  });

  it("is zero from a point to itself and the same both ways", () => {
    expect(earthDistanceMetres(ORIGIN, ORIGIN)).toBe(0);
    const alandi = FIXTURE[3];
    expect(earthDistanceMetres(alandi, ORIGIN)).toBe(
      earthDistanceMetres(ORIGIN, alandi)
    );
  });

  it("gives half the circumference for opposite points", () => {
    expect(
      earthDistanceMetres(
        { latitude: 0, longitude: 0 },
        { latitude: 0, longitude: 180 }
      )
    ).toBeCloseTo(Math.PI * EARTH_RADIUS_METRES, 3);
  });
});

describe("isInIndia", () => {
  it.each([
    ["Pune", 18.52, 73.86],
    ["Indira Point", 6.75, 93.85],
    ["Leh", 34.16, 77.58],
    ["Kibithu", 28.28, 97.02],
    ["Koteshwar", 23.68, 68.53],
  ])("accepts %s", (_name, latitude, longitude) => {
    expect(isInIndia({ latitude, longitude })).toBe(true);
  });

  it.each([
    ["the null island", 0, 0],
    ["London", 51.5, -0.13],
    ["Colombo", 5.9, 79.86],
    ["Kabul", 34.53, 67.0],
    ["Yangon", 16.84, 98.0],
    ["Pune with latitude and longitude swapped", 73.86, 18.52],
  ])("refuses %s", (_name, latitude, longitude) => {
    expect(isInIndia({ latitude, longitude })).toBe(false);
  });
});

describe("coarsenLocation", () => {
  it("keeps two decimals, about a kilometre", () => {
    expect(
      coarsenLocation({ latitude: 18.520431, longitude: 73.856743 })
    ).toEqual({ latitude: 18.52, longitude: 73.86 });
  });

  it("leaves a point that is already coarse as it is", () => {
    for (const place of [ORIGIN, ...FIXTURE]) {
      expect(coarsenLocation(place)).toEqual({
        latitude: place.latitude,
        longitude: place.longitude,
      });
    }
  });

  it("returns a new point", () => {
    expect(coarsenLocation(ORIGIN)).not.toBe(ORIGIN);
  });
});

describe("approximateDistance", () => {
  it.each([
    [0, { kind: "under", km: 1 }],
    [351, { kind: "under", km: 1 }],
    [999.4, { kind: "under", km: 1 }],
    [1000, { kind: "about", km: 1 }],
    [2111.1, { kind: "about", km: 2.1 }],
    [5394, { kind: "about", km: 5.4 }],
    [9949, { kind: "about", km: 9.9 }],
    [9950, { kind: "about", km: 10 }],
    [18304.4, { kind: "about", km: 18 }],
    [30517, { kind: "about", km: 31 }],
  ])("reads %d m as %j", (metres, expected) => {
    expect(approximateDistance(metres)).toEqual(expected);
  });
});
