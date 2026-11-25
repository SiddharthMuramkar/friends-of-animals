import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROUND_SETTINGS,
  JUDGING_LEVELS,
  ROUND_ENTRY_SOURCES,
  roundNameKey,
  roundSettingsSchema,
} from "./round-settings";

describe("round settings", () => {
  it("knows the four levels, smallest first", () => {
    expect(JUDGING_LEVELS).toEqual([
      "city_district",
      "state",
      "national",
      "global",
    ]);
  });

  it("defines both entry sources up front", () => {
    expect(ROUND_ENTRY_SOURCES).toEqual([
      "verified_entries",
      "round_finalists",
    ]);
  });

  it("defaults to the pilot: one national round on the physical artwork", () => {
    expect(DEFAULT_ROUND_SETTINGS).toEqual({
      level: "national",
      judgesPhysical: true,
      entrySource: "verified_entries",
    });
  });

  it("fills the defaults when only a name is given", () => {
    expect(roundSettingsSchema.parse({ name: "  All India final " })).toEqual({
      name: "All India final",
      level: "national",
      judgesPhysical: true,
      entrySource: "verified_entries",
    });
  });

  it("keeps the choices it is given", () => {
    expect(
      roundSettingsSchema.parse({
        name: "Maharashtra state round",
        level: "state",
        judgesPhysical: false,
      })
    ).toMatchObject({ level: "state", judgesPhysical: false });
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a name over 120 characters", { name: "x".repeat(121) }],
    ["an unknown level", { name: "Final", level: "district" }],
    [
      "a judging rule that isn't true or false",
      { name: "Final", judgesPhysical: "yes" },
    ],
    ["an unknown field", { name: "Final", sequence: 2 }],
  ])("refuses %s", (_, input) => {
    expect(roundSettingsSchema.safeParse(input).success).toBe(false);
  });

  it("refuses finalists of another round until chained levels arrive", () => {
    expect(
      roundSettingsSchema.safeParse({
        name: "National final",
        entrySource: "round_finalists",
      }).success
    ).toBe(false);
  });
});

describe("round names", () => {
  it("compare without case or extra spaces", () => {
    expect(roundNameKey("  All  India Final ")).toBe(
      roundNameKey("all india final")
    );
  });

  it("tell different names apart", () => {
    expect(roundNameKey("State round")).not.toBe(
      roundNameKey("National round")
    );
  });
});
