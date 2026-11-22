import { describe, expect, it } from "vitest";

import { individualLink } from "./individual-link";

describe("individualLink", () => {
  it("leads to the competition's register form when the chooser names one", () => {
    expect(individualLink("neighbours-on-my-street")).toEqual({
      kind: "register",
      href: "/participant/register/neighbours-on-my-street",
    });
  });

  it("asks for a competition first when none is named", () => {
    expect(individualLink(undefined)).toEqual({
      kind: "choose",
      href: "/competitions",
    });
  });

  it.each([
    ["two competitions", ["a-bowl-of-water", "kinder-skies"]],
    ["an empty name", ""],
    ["capital letters", "Kinder-Skies"],
    ["a path", "../account/sessions"],
    ["an encoded path", "kinder-skies%2Fregister"],
  ])("asks for a competition when given %s", (_, competition) => {
    expect(individualLink(competition)).toEqual({
      kind: "choose",
      href: "/competitions",
    });
  });
});
