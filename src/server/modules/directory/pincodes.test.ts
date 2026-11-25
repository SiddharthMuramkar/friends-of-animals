import { readFileSync } from "node:fs";

import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { pincodeLocation } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { importPincodeCsv } from "./pincodes";

// A hand-written sample in India Post's layout (not its data, which waits
// on HR-59): two offices for 411001, one quoted name with a comma, one
// office without coordinates, one with them swapped, one bad pin code.
const SAMPLE = readFileSync(
  new URL("./fixtures/pincodes-sample.csv", import.meta.url),
  "utf8"
);

describe("importPincodeCsv", () => {
  it("saves one centre per pin code and counts what it skipped", async () => {
    const h = await createHarness();

    const result = await importPincodeCsv(h.deps, SAMPLE);

    expect(result).toEqual({
      ok: true,
      rows: 9,
      saved: 5,
      skipped: { bad_pin: 1, no_coordinates: 1, outside_india: 1 },
    });
    const rows = await h.db
      .select()
      .from(pincodeLocation)
      .orderBy(asc(pincodeLocation.pinCode));
    expect(rows.map((row) => row.pinCode)).toEqual([
      "400001",
      "411001",
      "411004",
      "411014",
      "411038",
    ]);
    expect(rows[1]).toMatchObject({
      pinCode: "411001",
      latitude: 18.519,
      longitude: 73.862,
      district: "Pune",
      state: "Maharashtra",
      postOffices: 2,
    });
  });

  it("changes nothing but the time when the same file is imported again", async () => {
    const h = await createHarness();
    await importPincodeCsv(h.deps, SAMPLE);
    const first = await h.db
      .select()
      .from(pincodeLocation)
      .orderBy(asc(pincodeLocation.pinCode));
    h.clock.advance({ days: 1 });

    expect(await importPincodeCsv(h.deps, SAMPLE)).toMatchObject({
      ok: true,
      saved: 5,
    });
    const again = await h.db
      .select()
      .from(pincodeLocation)
      .orderBy(asc(pincodeLocation.pinCode));
    const withoutTime = (rows: typeof first) =>
      rows.map((row) => ({ ...row, updatedAt: null }));
    expect(withoutTime(again)).toEqual(withoutTime(first));
    expect(again[0]?.updatedAt).toEqual(h.clock.now());
  });

  it("saves nothing from a file without coordinates", async () => {
    const h = await createHarness();

    expect(
      await importPincodeCsv(h.deps, "officename,pincode\nPune GPO,411001\n")
    ).toEqual({ ok: false, reason: "missing_column", column: "latitude" });
    expect(await h.db.select().from(pincodeLocation)).toEqual([]);
  });

  it("makes the imported pin codes searchable", async () => {
    const h = await createHarness();
    await importPincodeCsv(h.deps, SAMPLE);
    const near = await h.seed.directoryListing({
      name: "Deccan Paws",
      pinCode: "411004",
    });
    await h.seed.directoryListing({ name: "Fort Paws", pinCode: "400001" });

    const result = await h
      .as(h.visitor())
      .searchListings({ pin: "411001", radius: "10" });

    expect(result.ok && result.results.map((r) => r.listing.slug)).toEqual([
      near.slug,
    ]);
  });
});
