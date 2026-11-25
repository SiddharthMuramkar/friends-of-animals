import { describe, expect, it } from "vitest";

import { readZip } from "./read-zip";
import { zipStore } from "./zip";

const text = (value: string) => new TextEncoder().encode(value);

const modifiedAt = new Date("2027-01-15T04:30:00.000Z");

describe("zipStore", () => {
  it("stores each entry so an unzip tool gets the same names and bytes back", () => {
    const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

    const zip = readZip(
      zipStore(
        [
          { name: "data.json", bytes: text('{"tables":{}}') },
          { name: "files/photo.png", bytes: png },
          { name: "hello.txt", bytes: text("hello") },
        ],
        { modifiedAt }
      )
    );

    expect(zip.names).toEqual(["data.json", "files/photo.png", "hello.txt"]);
    expect(zip.text("data.json")).toBe('{"tables":{}}');
    expect(zip.entries[1]?.bytes).toEqual(png);
    // The CRC-32 of "hello" every implementation agrees on.
    expect(zip.entries[2]?.crc32).toBe(0x3610a686);
    expect(zip.entries.map((entry) => entry.method)).toEqual([0, 0, 0]);
  });
});
