import { describe, expect, it } from "vitest";

import { uuidv7 } from "./ids";

const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidv7", () => {
  it("is a version 7, RFC 9562 variant UUID", () => {
    expect(uuidv7(new Date("2027-01-15T04:30:00.000Z"))).toMatch(UUID_V7);
  });

  it("starts with the instant in milliseconds", () => {
    // 2027-01-15T04:30:00.000Z is 1799987400000 ms = 0x01a3179c0d40.
    const zeros = () => new Uint8Array(10);
    expect(uuidv7(new Date("2027-01-15T04:30:00.000Z"), zeros)).toBe(
      "01a3179c-0d40-7000-8000-000000000000"
    );
  });

  it("sorts ids made later after earlier ones", () => {
    const earlier = uuidv7(new Date("2027-01-15T04:30:00.000Z"));
    const later = uuidv7(new Date("2027-01-15T04:30:00.001Z"));
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it("differs between ids made in the same millisecond", () => {
    const at = new Date("2027-01-15T04:30:00.000Z");
    expect(uuidv7(at)).not.toBe(uuidv7(at));
  });
});
