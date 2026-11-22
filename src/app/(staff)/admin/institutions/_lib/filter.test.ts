import { describe, expect, it } from "vitest";

import { filterHref, statusFilter } from "./filter";

describe("the institution queue's filter", () => {
  it("opens on the registrations waiting to be checked", () => {
    expect(statusFilter(undefined)).toBe("pending_verification");
  });

  it("reads a status, or all of them", () => {
    expect(statusFilter("suspended")).toBe("suspended");
    expect(statusFilter("all")).toBe("all");
  });

  it("falls back to the waiting ones for anything else", () => {
    expect(statusFilter("deleted")).toBe("pending_verification");
    expect(statusFilter(["verified", "rejected"])).toBe("verified");
  });

  it("links to each filter", () => {
    expect(filterHref("pending_verification")).toBe("/admin/institutions");
    expect(filterHref("all")).toBe("/admin/institutions?status=all");
    expect(filterHref("verified")).toBe("/admin/institutions?status=verified");
  });
});
