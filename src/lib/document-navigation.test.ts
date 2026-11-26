import { describe, expect, it } from "vitest";

import {
  crossesDirectoryBoundary,
  requiresDocumentNavigation,
} from "./document-navigation";

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

describe("staff home document boundary", () => {
  it.each([
    ["/dashboard", "/admin"],
    ["/account/sessions", "/admin"],
    ["/dashboard", "/admin/"],
  ])(
    "does not reuse a pre-factor client tree when opening the admin home from %s to %s",
    (from, to) => expect(requiresDocumentNavigation(from, to)).toBe(true)
  );
  it.each([
    ["/admin/reports", "/admin"],
    ["/admin", "/admin/reports"],
    ["/dashboard", "/dashboard"],
  ])(
    "keeps client navigation inside the staff area or other pages from %s to %s",
    (from, to) => expect(requiresDocumentNavigation(from, to)).toBe(false)
  );
});
