import { describe, expect, it } from "vitest";

import { sessionAddress } from "./address";

describe("sessionAddress", () => {
  it("shows an IPv4 address as it is", () => {
    expect(sessionAddress("203.0.113.10")).toEqual({
      kind: "ip",
      text: "203.0.113.10",
    });
  });

  it("shows an IPv6 address as its /64 network, compressed", () => {
    // Better Auth stores an IPv6 address as its zero-padded /64.
    expect(sessionAddress("2409:4060:2e0f:8a2b:0000:0000:0000:0000")).toEqual({
      kind: "network",
      text: "2409:4060:2e0f:8a2b::/64",
    });
    expect(sessionAddress("2001:db8::1")).toEqual({
      kind: "network",
      text: "2001:db8::/64",
    });
  });

  it("shows an IPv4-mapped IPv6 address as its IPv4 address", () => {
    expect(sessionAddress("::ffff:198.51.100.7")).toEqual({
      kind: "ip",
      text: "198.51.100.7",
    });
  });

  it("shows nothing for no address, or one that isn't an IP", () => {
    expect(sessionAddress(null)).toBeUndefined();
    expect(sessionAddress("")).toBeUndefined();
    expect(sessionAddress("unknown")).toBeUndefined();
  });
});
