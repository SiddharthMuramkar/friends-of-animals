import { describe, expect, it } from "vitest";

import {
  identityKeyInput,
  matchKeys,
  normaliseNameForMatching,
} from "./identity-key";

const DOB = { year: 2016, month: 3, day: 9 };

describe("normaliseNameForMatching", () => {
  it.each([
    ["Aanya  Rao", "aanya rao"],
    [" aanyá rao ", "aanya rao"],
    ["AANYA\tRAO", "aanya rao"],
    ["Zoë Fernandes", "zoe fernandes"],
  ])("reads %j as %j", (name, normalised) => {
    expect(normaliseNameForMatching(name)).toBe(normalised);
  });

  it("keeps Indic vowel signs, which change the name", () => {
    expect(normaliseNameForMatching("राम")).not.toBe(
      normaliseNameForMatching("रम")
    );
  });
});

describe("identityKeyInput", () => {
  it("joins a purpose, the normalised name and the date of birth", () => {
    expect(identityKeyInput("Aanya  Rao", DOB)).toBe(
      "student-identity:v1:aanya rao|2016-03-09"
    );
  });

  it("matches spelling variants of the same child", () => {
    expect(identityKeyInput("aanyá rao", DOB)).toBe(
      identityKeyInput("Aanya Rao", DOB)
    );
  });

  it("differs for a different date of birth", () => {
    expect(identityKeyInput("Aanya Rao", DOB)).not.toBe(
      identityKeyInput("Aanya Rao", { ...DOB, day: 10 })
    );
  });
});

describe("matchKeys", () => {
  it("recognises a student by roll number first, then identity", () => {
    expect(matchKeys({ identityHash: "h1", studentRefKey: "4B-07" })).toEqual([
      "ref:4B-07",
      "id:h1",
    ]);
  });

  it("has only the identity without a roll number", () => {
    expect(matchKeys({ identityHash: "h1", studentRefKey: null })).toEqual([
      "id:h1",
    ]);
  });
});
