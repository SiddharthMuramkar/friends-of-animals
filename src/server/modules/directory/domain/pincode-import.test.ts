import { describe, expect, it } from "vitest";

import { pincodeCentres } from "./pincode-import";

// The current India Post layout on data.gov.in.
const HEADER = [
  "circlename",
  "regionname",
  "divisionname",
  "officename",
  "pincode",
  "officetype",
  "delivery",
  "district",
  "statename",
  "latitude",
  "longitude",
];

const office = (
  officename: string,
  pincode: string,
  latitude: string,
  longitude: string,
  district = "PUNE",
  statename = "MAHARASHTRA"
) => [
  "Maharashtra Circle",
  "Pune Region",
  "Pune City East Division",
  officename,
  pincode,
  "BO",
  "Delivery",
  district,
  statename,
  latitude,
  longitude,
];

describe("pincodeCentres", () => {
  it("makes one centre per pin code from all its post offices", () => {
    const result = pincodeCentres([
      HEADER,
      office("Pune GPO", "411001", "18.5196", "73.8553"),
      office("Pune Camp", "411001", "18.5144", "73.8794"),
      office("Kothrud", "411038", "18.5074", "73.8077"),
    ]);
    expect(result).toEqual({
      ok: true,
      rows: 3,
      skipped: { bad_pin: 0, no_coordinates: 0, outside_india: 0 },
      centres: [
        {
          pinCode: "411001",
          latitude: 18.517,
          longitude: 73.86735,
          district: "Pune",
          state: "Maharashtra",
          postOffices: 2,
        },
        {
          pinCode: "411038",
          latitude: 18.5074,
          longitude: 73.8077,
          district: "Pune",
          state: "Maharashtra",
          postOffices: 1,
        },
      ],
    });
  });

  it("takes the median, so one mistyped post office can't drag the centre", () => {
    const result = pincodeCentres([
      HEADER,
      office("A", "411014", "18.5679", "73.9143"),
      office("B", "411014", "18.5601", "73.9110"),
      office("C (typo)", "411014", "28.5601", "77.2110"),
    ]);
    expect(result.ok && result.centres[0]).toMatchObject({
      latitude: 18.5679,
      longitude: 73.9143,
      postOffices: 3,
    });
  });

  it("drops post offices without usable coordinates and counts why", () => {
    const result = pincodeCentres([
      HEADER,
      office("Good", "412105", "18.6770", "73.8970"),
      office("No data", "412105", "NA", "NA"),
      office("Blank", "412105", "", ""),
      office("Half", "412105", "18.67", ""),
      office("Degrees", "412105", "18°40'N", "73°53'E"),
      office("Swapped", "412105", "73.8970", "18.6770"),
      office("London", "412105", "51.5", "-0.12"),
      office("Short pin", "41210", "18.6770", "73.8970"),
      office("Spreadsheet pin", "412105.0", "18.6770", "73.8970"),
    ]);
    expect(result).toMatchObject({
      ok: true,
      rows: 9,
      skipped: { bad_pin: 2, no_coordinates: 4, outside_india: 2 },
    });
    expect(result.ok && result.centres).toEqual([
      expect.objectContaining({ pinCode: "412105", postOffices: 1 }),
    ]);
  });

  it("leaves out a pin code whose post offices all lack coordinates", () => {
    const result = pincodeCentres([
      HEADER,
      office("Nowhere", "799001", "NA", "NA", "WEST TRIPURA", "TRIPURA"),
    ]);
    expect(result).toMatchObject({ ok: true, centres: [] });
  });

  it("reads the older layout, with other column names in another order", () => {
    const result = pincodeCentres([
      [
        "officename",
        "pincode",
        "officeType",
        "Deliverystatus",
        "divisionname",
        "regionname",
        "circlename",
        "Taluk",
        "Districtname",
        "statename",
        "Telephone",
        "Related Suboffice",
        "Related Headoffice",
        "longitude",
        "latitude",
      ],
      [
        "Alandi B.O",
        "412105",
        "B.O",
        "Delivery",
        "Pune Rural",
        "Pune",
        "Maharashtra",
        "Khed",
        "PUNE",
        "MAHARASHTRA",
        "NA",
        "NA",
        "Alandi H.O",
        "73.897",
        "18.677",
      ],
    ]);
    expect(result.ok && result.centres).toEqual([
      {
        pinCode: "412105",
        latitude: 18.677,
        longitude: 73.897,
        district: "Pune",
        state: "Maharashtra",
        postOffices: 1,
      },
    ]);
  });

  it("names places as people write them", () => {
    const result = pincodeCentres([
      HEADER,
      office(
        "Srinagar",
        "190001",
        "34.08",
        "74.80",
        "SRINAGAR",
        "JAMMU AND KASHMIR"
      ),
      office(
        "Silvassa",
        "396230",
        "20.27",
        "73.01",
        " DADRA  AND NAGAR HAVELI ",
        "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU"
      ),
      office("Leh", "194101", "34.16", "77.58", "Leh", "Ladakh"),
      office("Unknown", "560001", "12.97", "77.59", "NA", ""),
    ]);
    expect(
      result.ok &&
        result.centres.map(({ pinCode, district, state }) => ({
          pinCode,
          district,
          state,
        }))
    ).toEqual([
      { pinCode: "190001", district: "Srinagar", state: "Jammu and Kashmir" },
      { pinCode: "194101", district: "Leh", state: "Ladakh" },
      {
        pinCode: "396230",
        district: "Dadra and Nagar Haveli",
        state: "The Dadra and Nagar Haveli and Daman and Diu",
      },
      { pinCode: "560001", district: null, state: null },
    ]);
  });

  it("names a pin code after the district most of its post offices give", () => {
    const result = pincodeCentres([
      HEADER,
      office("A", "410507", "18.73", "73.68", "PUNE"),
      office("B", "410507", "18.74", "73.67", "MAVAL"),
      office("C", "410507", "18.72", "73.69", "MAVAL"),
    ]);
    expect(result.ok && result.centres[0]?.district).toBe("Maval");
  });

  it("gives the same centres whatever order the rows come in", () => {
    const rows = [
      office("A", "411001", "18.5196", "73.8553"),
      office("B", "411038", "18.5074", "73.8077"),
      office("C", "411001", "18.5144", "73.8794"),
      office("D", "411001", "18.5170", "73.8600"),
    ];
    expect(pincodeCentres([HEADER, ...[...rows].reverse()])).toEqual(
      pincodeCentres([HEADER, ...rows])
    );
  });

  it("skips blank lines without counting them", () => {
    const result = pincodeCentres([
      HEADER,
      [""],
      office("A", "411001", "18.5196", "73.8553"),
      [],
      [""],
    ]);
    expect(result).toMatchObject({ ok: true, rows: 1 });
  });

  it("treats a short row's missing cells as empty", () => {
    const result = pincodeCentres([
      HEADER,
      ["Maharashtra Circle", "", "", "X", "411001"],
    ]);
    expect(result).toMatchObject({
      ok: true,
      rows: 1,
      skipped: { no_coordinates: 1 },
      centres: [],
    });
  });

  it.each([
    ["pincode", ["officename", "latitude", "longitude"]],
    ["latitude", ["pincode", "lat_long", "longitude"]],
    ["longitude", ["pincode", "latitude"]],
  ])("refuses a file with no %s column", (column, header) => {
    expect(pincodeCentres([header])).toEqual({
      ok: false,
      reason: "missing_column",
      column,
    });
  });

  it("refuses an empty file", () => {
    expect(pincodeCentres([])).toEqual({
      ok: false,
      reason: "missing_column",
      column: "pincode",
    });
  });
});
