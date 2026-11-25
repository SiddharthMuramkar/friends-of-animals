import { describe, expect, it } from "vitest";

import { crossesDirectoryBoundary } from "./document-navigation";

describe("directory document boundary", () => {
  it.each([
    ["/", "/ngos"],
    ["/ngos", "/"],
    ["/ngos/", "/ngos/seed-paws-trust"],
    ["/ngos/register", "/ngos"],
  ])("requires a document navigation from %s to %s", (from, to) => {
    expect(crossesDirectoryBoundary(from, to)).toBe(true);
  });
  it.each([
    ["/ngos", "/ngos"],
    ["/ngos/", "/ngos"],
    ["/ngos/seed-paws-trust", "/adopt"],
    ["/about", "/contact"],
  ])("permits a client navigation from %s to %s", (from, to) => {
    expect(crossesDirectoryBoundary(from, to)).toBe(false);
  });
});
