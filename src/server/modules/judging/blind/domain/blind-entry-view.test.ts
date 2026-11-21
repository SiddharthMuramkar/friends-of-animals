import { describe, expect, it } from "vitest";

import {
  BLIND_ENTRY_VIEW_KEY_PATHS,
  keyPaths,
  toBlindEntryView,
  type BlindEntrySource,
} from "./blind-entry-view";

const source: BlindEntrySource = {
  entryCode: "FOA27-E-7K2M9Q",
  discipline: "PAINTING",
  categoryLabel: "Wildlife",
  ageGroupLabel: "Ages 10 to 12",
  media: [
    {
      kind: "image",
      url: "https://storage.test/a?sig=1",
      width: 1600,
      height: 1200,
      thumbnailUrl: "https://storage.test/b?sig=2",
    },
    {
      kind: "video",
      url: "https://storage.test/c?sig=3",
      posterUrl: null,
      width: 1920,
      height: 1080,
      durationMs: 95_000,
    },
    { kind: "essay_text", html: "<p>Tigers need forests.</p>" },
    { kind: "document", url: "https://storage.test/d?sig=4" },
    { kind: "unavailable" },
  ],
};

describe("toBlindEntryView", () => {
  it("keeps the code, discipline, category, age group and the work", () => {
    expect(toBlindEntryView(source)).toEqual(source);
  });

  it("drops anything else the query happened to carry", () => {
    const leaky = {
      ...source,
      participantName: "Aarav Sharma",
      school: "St. Mary's",
      city: "Pune",
      guardian: { email: "guardian@example.test", phone: "+919800000000" },
      registrationNumber: "FOA27-R-000123",
      title: "Aarav's tiger",
      media: [
        {
          kind: "image" as const,
          url: "https://storage.test/a?sig=1",
          width: 1600,
          height: 1200,
          thumbnailUrl: null,
          originalFileName: "aarav-sharma-tiger.heic",
          storageKey: "pr-12/entry_image/01938a00",
        },
        { kind: "essay_text" as const, html: "<p>Hi</p>", authorName: "Aarav" },
      ],
    };

    const view = toBlindEntryView(leaky);
    const json = JSON.stringify(view);

    for (const personal of [
      "Aarav",
      "Sharma",
      "St. Mary",
      "Pune",
      "guardian@example.test",
      "+919800000000",
      "FOA27-R-000123",
      "heic",
      "storageKey",
    ]) {
      expect(json).not.toContain(personal);
    }
    expect(keyPaths(view)).toEqual([
      "ageGroupLabel",
      "categoryLabel",
      "discipline",
      "entryCode",
      "media",
      "media[].height",
      "media[].html",
      "media[].kind",
      "media[].thumbnailUrl",
      "media[].url",
      "media[].width",
    ]);
  });

  it("holds every allowed key path when every kind of work is present, and nothing more", () => {
    expect(keyPaths(toBlindEntryView(source))).toEqual(
      [...BLIND_ENTRY_VIEW_KEY_PATHS].sort()
    );
  });

  it("allows a competition without age groups", () => {
    expect(
      toBlindEntryView({ ...source, ageGroupLabel: null }).ageGroupLabel
    ).toBeNull();
  });
});

describe("keyPaths", () => {
  it("lists nested keys once, with arrays marked", () => {
    expect(
      keyPaths({ a: 1, b: { c: [{ d: 1 }, { d: 2, e: null }] }, f: [] })
    ).toEqual(["a", "b", "b.c", "b.c[].d", "b.c[].e", "f"]);
  });
});
