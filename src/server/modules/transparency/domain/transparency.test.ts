import { describe, expect, it } from "vitest";

import { fundsRaised, type PublicAccount } from "./figures";
import type { DonationChoice } from "./recognition";
import { buildTransparency, type TransparencyInput } from "./transparency";

const ACCOUNTS: PublicAccount[] = [
  { code: "1100", kind: "asset", publicLabel: null, publicGroup: null },
  {
    code: "4200",
    kind: "income",
    publicLabel: "Donations",
    publicGroup: "income",
  },
  {
    code: "4210",
    kind: "income",
    publicLabel: "Donations",
    publicGroup: "income",
  },
  {
    code: "5100",
    kind: "expense",
    publicLabel: "Prizes and awards",
    publicGroup: "programs",
  },
];

// Details a donor gave that must never reach the page.
const PRIVATE = {
  donorId: "donor-0193a1b2",
  donationId: "donation-0193a1b3",
  email: "asha.rao@example.test",
  fullName: "Asha Ramakrishnan Rao",
};

const asha: DonationChoice = {
  donationId: PRIVATE.donationId,
  donorId: PRIVATE.donorId,
  donorType: "individual",
  capturedAt: new Date("2026-10-05T06:00:00Z"),
  showOnWall: true,
  wallName: "Asha R.",
  discloseOrganisation: null,
  organisationName: null,
};

const acme: DonationChoice = {
  donationId: "donation-acme",
  donorId: "donor-acme",
  donorType: "corporate",
  capturedAt: new Date("2026-11-03T06:00:00Z"),
  showOnWall: false,
  wallName: null,
  discloseOrganisation: true,
  organisationName: "Acme Tiles Pvt Ltd",
};

// Asha gave Rs 500 in October; Acme gave Rs 20,000 in November; a Rs 900
// prize was paid in October. A month of the previous year was locked too.
function input(
  lockedMonths: string[],
  requestedFy?: string
): TransparencyInput {
  return {
    requestedFy,
    lockedMonths,
    accounts: ACCOUNTS,
    totals: [
      {
        month: "2025-06",
        accountCode: "4200",
        debitMinor: 0n,
        creditMinor: 10_000n,
      },
      {
        month: "2025-06",
        accountCode: "1100",
        debitMinor: 10_000n,
        creditMinor: 0n,
      },
      {
        month: "2026-10",
        accountCode: "4200",
        debitMinor: 0n,
        creditMinor: 50_000n,
      },
      {
        month: "2026-10",
        accountCode: "5100",
        debitMinor: 90_000n,
        creditMinor: 0n,
      },
      {
        month: "2026-10",
        accountCode: "1100",
        debitMinor: 50_000n,
        creditMinor: 90_000n,
      },
      {
        month: "2026-11",
        accountCode: "4210",
        debitMinor: 0n,
        creditMinor: 2_000_000n,
      },
      {
        month: "2026-11",
        accountCode: "1100",
        debitMinor: 2_000_000n,
        creditMinor: 0n,
      },
    ],
    donationAccountCodes: new Set(["4200", "4210"]),
    choices: [asha, acme],
    legs: [
      { donationId: asha.donationId, month: "2026-10", amountMinor: 50_000n },
      {
        donationId: acme.donationId,
        month: "2026-11",
        amountMinor: 2_000_000n,
      },
    ],
  };
}

describe("buildTransparency", () => {
  it("publishes nothing until a month is locked", () => {
    expect(buildTransparency(input([]))).toEqual({ published: false });
  });

  it("shows the latest year with a locked month and lists every such year", () => {
    const page = buildTransparency(input(["2025-06", "2026-10"]));
    expect(page.published && page.years).toEqual(["2026-27", "2025-26"]);
    expect(page.published && page.figures.fy).toBe("2026-27");
  });

  it("shows an earlier year when asked for one that has a locked month", () => {
    const page = buildTransparency(input(["2025-06", "2026-10"], "2025-26"));
    expect(page.published && page.figures.fy).toBe("2025-26");
    expect(page.published && page.figures.yearToDate.donationsMinor).toBe(
      10_000n
    );
    expect(page.published && page.recognition).toEqual({
      organisations: [],
      supporters: [],
    });
  });

  it("takes the figures and the names from the same locked months", () => {
    const october = buildTransparency(input(["2026-10"]));
    expect(
      october.published && october.figures.months.map((m) => m.month)
    ).toEqual(["2026-10"]);
    expect(october.published && october.recognition).toEqual({
      organisations: [],
      supporters: ["Asha R."],
    });

    const november = buildTransparency(input(["2026-10", "2026-11"]));
    expect(november.published && november.recognition.organisations).toEqual([
      { name: "Acme Tiles Pvt Ltd", totalMinor: 2_000_000n },
    ]);
  });

  it("gives the impact page the same donations total as the page", () => {
    const page = buildTransparency(input(["2026-10", "2026-11"]));
    if (!page.published) throw new Error("expected a published page");
    expect(fundsRaised(page.figures).amountMinor).toBe(2_050_000n);
    expect(fundsRaised(page.figures).amountMinor).toBe(
      page.figures.yearToDate.donationsMinor
    );
  });

  it("holds no ids, codes, emails or full names", () => {
    const json = JSON.stringify(
      buildTransparency(input(["2025-06", "2026-10", "2026-11"])),
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value
    );
    for (const secret of Object.values(PRIVATE)) {
      expect(json).not.toContain(secret);
    }
    expect(json).not.toContain("donor-acme");
    expect(json).not.toContain("donation-acme");
    for (const { code } of ACCOUNTS) expect(json).not.toContain(`"${code}"`);
  });
});
