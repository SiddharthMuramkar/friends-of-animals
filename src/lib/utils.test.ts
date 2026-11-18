import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn()", () => {
  it("keeps a text colour next to a named font size", () => {
    expect(cn("text-primary-fg", "text-body")).toBe(
      "text-primary-fg text-body"
    );
  });

  it("still lets a later font size win", () => {
    expect(cn("text-body", "text-lead")).toBe("text-lead");
  });
});
