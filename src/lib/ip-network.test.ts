import { describe, expect, it } from "vitest";

import { ipNetwork } from "./ip-network";

describe("ipNetwork", () => {
  it("keeps an IPv4 address as it is", () => {
    expect(ipNetwork("203.0.113.10")).toBe("203.0.113.10");
  });

  it("gives an IPv6 address's /64 network, compressed", () => {
    expect(ipNetwork("2409:4060:2e0f:8a2b:1c3d:5e7f:9a0b:cd12")).toBe(
      "2409:4060:2e0f:8a2b::/64"
    );
    expect(ipNetwork("2001:DB8::1")).toBe("2001:db8::/64");
    expect(ipNetwork("2001:0db8:0000:0001:0000:0000:0000:0001")).toBe(
      "2001:db8:0:1::/64"
    );
  });

  it("puts two addresses in one /64 together", () => {
    expect(ipNetwork("2001:db8:1:2::a")).toBe(
      ipNetwork("2001:db8:1:2:ffff:ffff:ffff:b")
    );
    expect(ipNetwork("2001:db8:1:2::a")).not.toBe(ipNetwork("2001:db8:1:3::a"));
  });

  it("reads Better Auth's stored form, the zero-padded /64", () => {
    expect(ipNetwork("2409:4060:2e0f:8a2b:0000:0000:0000:0000")).toBe(
      "2409:4060:2e0f:8a2b::/64"
    );
  });

  it("turns an IPv4-mapped IPv6 address into its IPv4 address", () => {
    expect(ipNetwork("::ffff:198.51.100.7")).toBe("198.51.100.7");
    expect(ipNetwork("::FFFF:c633:6407")).toBe("198.51.100.7");
  });

  it("leaves anything that isn't an IP address alone", () => {
    expect(ipNetwork("unknown")).toBe("unknown");
    expect(ipNetwork("")).toBe("");
  });
});
