import { describe, expect, it } from "vitest";

import { afterFilter, filterHref, statusFilter } from "./filter";

const ID = "01938a00-0000-7000-8000-000000012701";

describe("the directory queue's filter", () => {
  it("opens on pending listings and ignores anything it doesn't know", () => {
    expect(statusFilter(undefined)).toBe("pending_verification");
    expect(statusFilter("verified")).toBe("verified");
    expect(statusFilter(["suspended", "x"])).toBe("suspended");
    expect(statusFilter("everything")).toBe("pending_verification");
    expect(afterFilter(ID)).toBe(ID);
    expect(afterFilter("drop table")).toBeUndefined();
  });

  it("links each status and page", () => {
    expect(filterHref("pending_verification")).toBe("/admin/directory");
    expect(filterHref("verified", ID)).toBe(
      `/admin/directory?status=verified&after=${ID}`
    );
  });
});
