import { describe, expect, it } from "vitest";

import { registrationNumbersIn } from "./payment-values";

describe("registrationNumbersIn", () => {
  it("finds every registration number on a page, in page order", () => {
    const page = [
      "Aanya Rao   Confirmed   NEIGH27-R-7K2QD9",
      "Kabir Shah  Confirmed   NEIGH27-R-0AB3XZ",
    ].join("\n");

    expect(registrationNumbersIn(page)).toEqual([
      "NEIGH27-R-7K2QD9",
      "NEIGH27-R-0AB3XZ",
    ]);
  });
});
