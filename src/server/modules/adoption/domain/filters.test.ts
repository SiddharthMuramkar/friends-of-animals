import { describe, expect, it } from "vitest";

import {
  ADOPTION_PAGE_SIZE,
  cityKey,
  decodeBrowseCursor,
  encodeBrowseCursor,
  filtersToSearchParams,
  parseAdoptionFilters,
} from "./filters";

const ID = "01938a00-0000-7000-8000-000000000201";

describe("parseAdoptionFilters", () => {
  it("reads every filter from the query string", () => {
    expect(
      parseAdoptionFilters({
        species: "cat",
        age: "young",
        sex: "female",
        size: "small",
        state: "karnataka",
        city: "  Bengaluru ",
        pin: "560001",
        sterilised: "yes",
      })
    ).toEqual({
      species: "cat",
      age: "young",
      sex: "female",
      size: "small",
      state: "karnataka",
      city: "Bengaluru",
      pin: "560001",
      sterilised: true,
    });
  });

  it("drops values it doesn't know instead of failing the page", () => {
    expect(
      parseAdoptionFilters({
        species: "tiger",
        age: "ancient",
        sex: "unknown",
        size: "",
        state: "Karnataka",
        city: "   ",
        pin: "56000",
        sterilised: "maybe",
        utm_source: "x",
      })
    ).toEqual({});
  });

  it("takes the first of repeated values", () => {
    expect(parseAdoptionFilters({ species: ["dog", "cat"] })).toEqual({
      species: "dog",
    });
  });

  it("bounds the city to the stored length", () => {
    expect(parseAdoptionFilters({ city: "a".repeat(200) }).city).toHaveLength(
      80
    );
  });
});

describe("filtersToSearchParams", () => {
  it("writes filters in one fixed order, so equal filters give equal links", () => {
    expect(
      filtersToSearchParams({
        sterilised: true,
        city: "Navi Mumbai",
        species: "dog",
      })
    ).toBe("species=dog&city=Navi+Mumbai&sterilised=yes");
  });

  it("round-trips through parseAdoptionFilters", () => {
    const filters = {
      species: "rabbit",
      age: "adult",
      sex: "male",
      size: "large",
      state: "goa",
      city: "Panaji",
      pin: "403001",
      sterilised: true,
    } as const;
    const params = new URLSearchParams(filtersToSearchParams(filters));
    expect(parseAdoptionFilters(Object.fromEntries(params))).toEqual(filters);
  });

  it("is empty with no filters", () => {
    expect(filtersToSearchParams({})).toBe("");
  });
});

describe("cityKey", () => {
  it("compares cities without case or extra spaces", () => {
    expect(cityKey("  Navi   MUMBAI ")).toBe(cityKey("navi mumbai"));
  });
});

describe("browse cursor", () => {
  it("round-trips the last row's publication time and id", () => {
    const publishedAt = new Date("2027-01-10T08:00:00.123Z");
    const cursor = encodeBrowseCursor({ publishedAt, id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeBrowseCursor(cursor)).toEqual({ publishedAt, id: ID });
  });

  it.each(["", "not-a-cursor", "MTIz", encodeURIComponent("1.x")])(
    "reads %j as the first page",
    (cursor) => {
      expect(decodeBrowseCursor(cursor)).toBeNull();
    }
  );

  it("pages 24 animals at a time", () => {
    expect(ADOPTION_PAGE_SIZE).toBe(24);
  });
});
