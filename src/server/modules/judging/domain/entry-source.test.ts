import { describe, expect, it } from "vitest";

import { entrySourceInputSchema } from "./entry-source";

const ROUND = "01938a7e-8f4c-7a2b-9c3d-4e5f6a7b8c9d";
const SOURCE = "01938a7e-9000-7b2b-8c3d-4e5f6a7b8c9e";

const parse = (input: unknown) => entrySourceInputSchema.safeParse(input);

describe("entrySourceInputSchema", () => {
  it("takes FOA-verified entries with no source round", () => {
    expect(
      parse({ roundId: ROUND, entrySource: "verified_entries" }).data
    ).toEqual({
      roundId: ROUND,
      entrySource: "verified_entries",
    });
  });

  it("takes another round's finalists with that round's id", () => {
    const input = {
      roundId: ROUND,
      entrySource: "round_finalists",
      sourceRoundId: SOURCE,
    };
    expect(parse(input).data).toEqual(input);
  });

  it.each([
    [
      "finalists without a source round",
      { roundId: ROUND, entrySource: "round_finalists" },
    ],
    [
      "verified entries with a source round",
      {
        roundId: ROUND,
        entrySource: "verified_entries",
        sourceRoundId: SOURCE,
      },
    ],
    ["an unknown entry source", { roundId: ROUND, entrySource: "everyone" }],
    [
      "a source round id that isn't a UUID",
      { roundId: ROUND, entrySource: "round_finalists", sourceRoundId: "R-1" },
    ],
    [
      "a round id that isn't a UUID",
      { roundId: "1", entrySource: "verified_entries" },
    ],
    [
      "extra fields",
      { roundId: ROUND, entrySource: "verified_entries", level: "global" },
    ],
  ])("refuses %s", (_case, input) => {
    expect(parse(input).success).toBe(false);
  });
});
