import { describe, expect, it } from "vitest";

import { decideExportLink, exportLifetimes } from "./export-link";

const readyAt = new Date("2027-01-15T04:30:00.000Z");

describe("exportLifetimes", () => {
  it("ends the link after the link hours and the file after the retention days", () => {
    expect(
      exportLifetimes(readyAt, { linkHours: 72, retentionDays: 7 })
    ).toEqual({
      linkExpiresAt: new Date("2027-01-18T04:30:00.000Z"),
      deleteAt: new Date("2027-01-22T04:30:00.000Z"),
    });
  });

  it("never lets the link outlive the file", () => {
    expect(() =>
      exportLifetimes(readyAt, { linkHours: 24 * 8, retentionDays: 7 })
    ).toThrow(RangeError);
  });
});

describe("decideExportLink", () => {
  const linkExpiresAt = new Date("2027-01-18T04:30:00.000Z");
  const ready = { state: "ready" as const, fileId: "f1", linkExpiresAt };

  it("hands out the file while the link is live, up to its last millisecond", () => {
    expect(decideExportLink({ now: readyAt, export: ready })).toEqual({
      ok: true,
      fileId: "f1",
    });
    expect(
      decideExportLink({
        now: new Date(linkExpiresAt.getTime() - 1),
        export: ready,
      }).ok
    ).toBe(true);
  });

  it("refuses once the link has expired", () => {
    expect(decideExportLink({ now: linkExpiresAt, export: ready })).toEqual({
      ok: false,
      reason: "link_expired",
    });
  });

  it("says why there is nothing to download yet or any more", () => {
    expect(
      decideExportLink({ now: readyAt, export: { state: "none" } })
    ).toEqual({ ok: false, reason: "export_not_ready" });
    expect(
      decideExportLink({ now: readyAt, export: { state: "deleted" } })
    ).toEqual({ ok: false, reason: "export_deleted" });
  });
});
