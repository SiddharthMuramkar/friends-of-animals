import { describe, expect, it } from "vitest";

import {
  DEFAULT_RADIUS_KM,
  RADIUS_OPTIONS_KM,
  parseDirectorySearch,
} from "./search-input";

const SERVICES = ["rescue", "shelter", "veterinary_care"] as const;

const parse = (raw: unknown) => parseDirectorySearch(raw, SERVICES);

describe("parseDirectorySearch: where from", () => {
  it("searches from a pin code", () => {
    expect(parse({ pin: "411001" })).toEqual({
      ok: true,
      value: {
        origin: { kind: "pin", pinCode: "411001" },
        service: null,
        radiusKm: DEFAULT_RADIUS_KM,
      },
    });
  });

  it("reads a pin code typed with spaces", () => {
    expect(parse({ pin: " 411 001 " })).toMatchObject({
      ok: true,
      value: { origin: { kind: "pin", pinCode: "411001" } },
    });
  });

  it.each(["41100", "4110012", "011001", "41100a", "411-001"])(
    "refuses the pin code %j",
    (pin) => {
      expect(parse({ pin })).toEqual({ ok: false, errors: { pin: "invalid" } });
    }
  );

  it("searches from a location, rounded to about a kilometre", () => {
    expect(parse({ lat: "18.520431", lng: "73.856743" })).toEqual({
      ok: true,
      value: {
        origin: { kind: "point", point: { latitude: 18.52, longitude: 73.86 } },
        service: null,
        radiusKm: DEFAULT_RADIUS_KM,
      },
    });
  });

  it("prefers a typed pin code over a location left in the form", () => {
    expect(parse({ pin: "411038", lat: "18.52", lng: "73.86" })).toMatchObject({
      ok: true,
      value: { origin: { kind: "pin", pinCode: "411038" } },
    });
  });

  it.each([
    [{ lat: "18.52" }],
    [{ lng: "73.86" }],
    [{ lat: "north", lng: "73.86" }],
    [{ lat: "18.52", lng: "1e2" }],
    [{ lat: "91", lng: "73.86" }],
    [{ lat: "18.52", lng: "-181" }],
    [{ lat: "Infinity", lng: "73.86" }],
    [{ lat: ["18.52", "19"], lng: "73.86" }],
  ])("refuses the location %j", (raw) => {
    expect(parse(raw)).toEqual({ ok: false, errors: { location: "invalid" } });
  });

  it.each([[{ lat: "51.5", lng: "-0.13" }], [{ lat: "73.86", lng: "18.52" }]])(
    "tells a location outside India apart: %j",
    (raw) => {
      expect(parse(raw)).toEqual({
        ok: false,
        errors: { location: "outside_india" },
      });
    }
  );

  it.each([[{}], [{ pin: "", lat: "", lng: "" }], [null], ["411001"]])(
    "asks for a pin code when given neither: %j",
    (raw) => {
      expect(parse(raw)).toEqual({ ok: false, errors: { pin: "required" } });
    }
  );
});

describe("parseDirectorySearch: service", () => {
  it("narrows to one service", () => {
    expect(parse({ pin: "411001", service: "shelter" })).toMatchObject({
      ok: true,
      value: { service: "shelter" },
    });
  });

  it("treats an empty service as any", () => {
    expect(parse({ pin: "411001", service: "" })).toMatchObject({
      ok: true,
      value: { service: null },
    });
  });

  it.each(["ambulance", "Shelter", ["rescue", "shelter"]])(
    "refuses the service %j",
    (service) => {
      expect(parse({ pin: "411001", service })).toEqual({
        ok: false,
        errors: { service: "invalid" },
      });
    }
  );
});

describe("parseDirectorySearch: radius", () => {
  it("offers 5, 10, 25 and 50 km, 10 by default", () => {
    expect(RADIUS_OPTIONS_KM).toEqual([5, 10, 25, 50]);
    expect(DEFAULT_RADIUS_KM).toBe(10);
  });

  it.each(RADIUS_OPTIONS_KM)("accepts %d km", (radiusKm) => {
    expect(parse({ pin: "411001", radius: String(radiusKm) })).toMatchObject({
      ok: true,
      value: { radiusKm },
    });
  });

  it("uses the default when the radius is empty", () => {
    expect(parse({ pin: "411001", radius: "" })).toMatchObject({
      ok: true,
      value: { radiusKm: DEFAULT_RADIUS_KM },
    });
  });

  it.each(["15", "1000", "10.0", "-5", "ten", ["5", "10"]])(
    "refuses a radius it doesn't offer: %j",
    (radius) => {
      expect(parse({ pin: "411001", radius })).toEqual({
        ok: false,
        errors: { radius: "invalid" },
      });
    }
  );
});

it("reports every bad field at once", () => {
  expect(parse({ pin: "12", service: "zoo", radius: "7" })).toEqual({
    ok: false,
    errors: { pin: "invalid", service: "invalid", radius: "invalid" },
  });
});
