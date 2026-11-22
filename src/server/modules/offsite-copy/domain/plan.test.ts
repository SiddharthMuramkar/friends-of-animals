import { describe, expect, it } from "vitest";

import { planOffsiteCopy, type ManifestEntry, type SourceObject } from "./plan";

const NOW = new Date("2027-01-15T20:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const THIRTY_DAYS = { days: 30 };

function object(key: string, etag = "e1", sizeBytes = 100): SourceObject {
  return {
    key,
    etag,
    sizeBytes,
    lastModified: new Date("2027-01-10T00:00:00.000Z"),
  };
}

function copied(
  key: string,
  etag = "e1",
  sizeBytes = 100,
  deletedInSourceAt: Date | null = null
): ManifestEntry {
  return { key, etag, sizeBytes, deletedInSourceAt };
}

function plan(source: SourceObject[], manifest: ManifestEntry[], now = NOW) {
  return planOffsiteCopy({ source, manifest, now, retention: THIRTY_DAYS });
}

describe("planOffsiteCopy: what gets copied", () => {
  it("copies an object the manifest has never seen", () => {
    const fresh = object("general/a");
    expect(plan([fresh], []).copy).toEqual([{ object: fresh, reason: "new" }]);
  });

  it("copies an object again when its etag or its size changed", () => {
    const newEtag = object("general/a", "e2");
    const newSize = object("general/b", "e1", 200);
    expect(
      plan([newEtag, newSize], [copied("general/a"), copied("general/b")]).copy
    ).toEqual([
      { object: newEtag, reason: "changed" },
      { object: newSize, reason: "changed" },
    ]);
  });

  it("leaves an unchanged object alone and counts it", () => {
    const result = plan([object("general/a")], [copied("general/a")]);
    expect(result.copy).toEqual([]);
    expect(result.unchanged).toBe(1);
  });

  it("never copies a key under a non-production prefix", () => {
    const result = plan(
      [
        object("staging/general/a"),
        object("pr-12/general/b"),
        object("general/c"),
      ],
      []
    );
    expect(result.copy.map((c) => c.object.key)).toEqual(["general/c"]);
    expect(result.skippedNonProduction).toBe(2);
  });

  it("refuses a listing that names a key twice", () => {
    expect(() => plan([object("general/a"), object("general/a")], [])).toThrow(
      /general\/a/
    );
  });
});

describe("planOffsiteCopy: the retention rule", () => {
  it("marks an object that left R2 and keeps its copy", () => {
    const result = plan(
      [object("general/a")],
      [copied("general/a"), copied("general/b")]
    );
    expect(result.markDeleted).toEqual(["general/b"]);
    expect(result.purge).toEqual([]);
  });

  it("keeps the copy until the retention window has passed", () => {
    const goneAt = new Date(NOW.getTime() - 30 * DAY + 1);
    const result = plan(
      [object("general/a")],
      [copied("general/a"), copied("general/b", "e1", 100, goneAt)]
    );
    expect(result.markDeleted).toEqual([]);
    expect(result.purge).toEqual([]);
    expect(result.held).toBe(1);
  });

  it("purges the copy once the window has passed", () => {
    const goneAt = new Date(NOW.getTime() - 30 * DAY);
    const result = plan(
      [object("general/a")],
      [copied("general/a"), copied("general/b", "e1", 100, goneAt)]
    );
    expect(result.purge).toEqual(["general/b"]);
    expect(result.held).toBe(0);
  });

  it("clears the mark when the object comes back unchanged, without copying", () => {
    const goneAt = new Date(NOW.getTime() - 3 * DAY);
    const result = plan(
      [object("general/a")],
      [copied("general/a", "e1", 100, goneAt)]
    );
    expect(result.clearDeleted).toEqual(["general/a"]);
    expect(result.copy).toEqual([]);
    expect(result.unchanged).toBe(0);
  });

  it("copies an object that came back changed (the copy clears its mark)", () => {
    const goneAt = new Date(NOW.getTime() - 3 * DAY);
    const back = object("general/a", "e2");
    const result = plan([back], [copied("general/a", "e1", 100, goneAt)]);
    expect(result.copy).toEqual([{ object: back, reason: "changed" }]);
    expect(result.clearDeleted).toEqual([]);
  });

  it("refuses a retention window that isn't a whole number of days from 1", () => {
    for (const days of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        planOffsiteCopy({
          source: [],
          manifest: [],
          now: NOW,
          retention: { days },
        })
      ).toThrow(/retention/i);
    }
  });
});

describe("planOffsiteCopy: guards against a bad listing", () => {
  const live = Array.from({ length: 50 }, (_, n) => copied(`general/${n}`));

  it("refuses an empty listing while B2 holds live copies: nothing is marked or purged", () => {
    const longGone = copied(
      "general/old",
      "e1",
      100,
      new Date(NOW.getTime() - 90 * DAY)
    );
    const result = plan([], [...live, longGone]);
    expect(result.refused).toBe("empty_listing");
    expect(result.markDeleted).toEqual([]);
    expect(result.purge).toEqual([]);
  });

  it("treats a listing of only non-production keys as empty", () => {
    expect(plan([object("staging/general/a")], live).refused).toBe(
      "empty_listing"
    );
  });

  it("accepts an empty listing when every copy is already marked", () => {
    const gone = copied("general/a", "e1", 100, new Date(NOW.getTime() - DAY));
    expect(plan([], [gone]).refused).toBeNull();
    expect(plan([], []).refused).toBeNull();
  });

  it("flags a run that marks more than a tenth of the live copies, at least 10", () => {
    const keep = live.slice(0, 39).map((row) => object(row.key));
    const flagged = plan(keep, live);
    expect(flagged.markDeleted).toHaveLength(11);
    expect(flagged.massDeletion).toBe(true);

    const many = Array.from({ length: 200 }, (_, n) => copied(`general/${n}`));
    const exactlyATenth = plan(
      many.slice(20).map((row) => object(row.key)),
      many
    );
    expect(exactlyATenth.markDeleted).toHaveLength(20);
    expect(exactlyATenth.massDeletion).toBe(false);
  });

  it("doesn't flag a few deletions from a small bucket", () => {
    const small = live.slice(0, 5);
    const result = plan([object("general/0")], small);
    expect(result.markDeleted).toHaveLength(4);
    expect(result.massDeletion).toBe(false);
  });
});
