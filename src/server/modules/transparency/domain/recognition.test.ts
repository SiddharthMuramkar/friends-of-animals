import { describe, expect, it } from "vitest";

import {
  buildRecognition,
  type DonationChoice,
  type DonationLeg,
} from "./recognition";

const FY = { startYear: 2026, label: "2026-27" };
const LOCKED = ["2026-09", "2026-10"];

let n = 0;
function choice(
  donorId: string,
  details: Partial<DonationChoice> = {}
): DonationChoice {
  n += 1;
  return {
    donationId: `donation-${n}`,
    donorId,
    donorType: "individual",
    capturedAt: new Date(`2026-10-${String(n).padStart(2, "0")}T06:00:00Z`),
    showOnWall: false,
    wallName: null,
    discloseOrganisation: null,
    organisationName: null,
    ...details,
  };
}

const leg = (
  donationId: string,
  month: string,
  amountMinor: bigint
): DonationLeg => ({ donationId, month, amountMinor });

describe("buildRecognition", () => {
  it("lists opted-in individuals by wall name only", () => {
    const asha = choice("asha", { showOnWall: true, wallName: "Asha R." });
    const ravi = choice("ravi", { showOnWall: false, wallName: null });
    const result = buildRecognition({
      fy: FY,
      lockedMonths: LOCKED,
      choices: [asha, ravi],
      legs: [
        leg(asha.donationId, "2026-10", 50_000n),
        leg(ravi.donationId, "2026-10", 100_000n),
      ],
    });
    expect(result).toEqual({ organisations: [], supporters: ["Asha R."] });
  });

  it("lists organisations that chose disclosure, with their totals for the year", () => {
    const acme1 = choice("acme", {
      donorType: "corporate",
      discloseOrganisation: true,
      organisationName: "Acme Tiles Pvt Ltd",
    });
    const acme2 = choice("acme", {
      donorType: "corporate",
      discloseOrganisation: true,
      organisationName: "Acme Tiles Pvt Ltd",
    });
    const quiet = choice("quiet", {
      donorType: "csr",
      discloseOrganisation: false,
      organisationName: "Quiet Foundation",
    });
    const result = buildRecognition({
      fy: FY,
      lockedMonths: LOCKED,
      choices: [acme1, acme2, quiet],
      legs: [
        leg(acme1.donationId, "2026-09", 2_000_000n),
        leg(acme2.donationId, "2026-10", 500_000n),
        leg(quiet.donationId, "2026-10", 9_900_000n),
      ],
    });
    expect(result.organisations).toEqual([
      { name: "Acme Tiles Pvt Ltd", totalMinor: 2_500_000n },
    ]);
    expect(JSON.stringify(result, bigints)).not.toContain("Quiet");
  });

  it("counts only published months of the chosen year, net of refunds", () => {
    const acme = choice("acme", {
      donorType: "corporate",
      discloseOrganisation: true,
      organisationName: "Acme",
    });
    const result = buildRecognition({
      fy: FY,
      lockedMonths: LOCKED,
      choices: [acme],
      legs: [
        leg(acme.donationId, "2026-10", 1_000_000n),
        // A refund posted in a locked month counts; one in an open month waits.
        leg(acme.donationId, "2026-10", -200_000n),
        leg(acme.donationId, "2026-11", -300_000n),
        // The same donor's earlier year doesn't count towards this one.
        leg(acme.donationId, "2025-10", 4_000_000n),
      ],
    });
    expect(result.organisations).toEqual([
      { name: "Acme", totalMinor: 800_000n },
    ]);
  });

  it("names no one whose money isn't published yet or was refunded in full", () => {
    const early = choice("early", { showOnWall: true, wallName: "Meera K." });
    const refunded = choice("refunded", {
      showOnWall: true,
      wallName: "Dev P.",
    });
    const orgOpen = choice("org", {
      donorType: "corporate",
      discloseOrganisation: true,
      organisationName: "Open Month Ltd",
    });
    const result = buildRecognition({
      fy: FY,
      lockedMonths: LOCKED,
      choices: [early, refunded, orgOpen],
      legs: [
        leg(early.donationId, "2026-11", 50_000n),
        leg(refunded.donationId, "2026-10", 50_000n),
        leg(refunded.donationId, "2026-10", -50_000n),
        leg(orgOpen.donationId, "2026-11", 1_000_000n),
      ],
    });
    expect(result).toEqual({ organisations: [], supporters: [] });
  });

  it("follows each donor's latest choice, and a later no wins", () => {
    const first = choice("asha", { showOnWall: true, wallName: "Asha R." });
    const later = choice("asha", { showOnWall: false, wallName: null });
    const orgYes = choice("acme", {
      donorType: "corporate",
      discloseOrganisation: true,
      organisationName: "Acme",
    });
    const orgNo = choice("acme", {
      donorType: "corporate",
      discloseOrganisation: false,
      organisationName: "Acme",
    });
    const result = buildRecognition({
      fy: FY,
      lockedMonths: LOCKED,
      choices: [first, later, orgYes, orgNo],
      // The later choices were made in a month that isn't published yet;
      // they still hide the donor, because hiding reveals nothing.
      legs: [
        leg(first.donationId, "2026-10", 50_000n),
        leg(later.donationId, "2026-11", 50_000n),
        leg(orgYes.donationId, "2026-10", 1_000_000n),
        leg(orgNo.donationId, "2026-11", 1_000_000n),
      ],
    });
    expect(result).toEqual({ organisations: [], supporters: [] });
  });

  it("never adds a donation the organisation chose not to disclose to its total", () => {
    const hidden = choice("acme", {
      donorType: "corporate",
      discloseOrganisation: false,
      organisationName: "Acme",
    });
    const shown = choice("acme", {
      donorType: "corporate",
      discloseOrganisation: true,
      organisationName: "Acme",
    });
    const result = buildRecognition({
      fy: FY,
      lockedMonths: LOCKED,
      choices: [hidden, shown],
      legs: [
        leg(hidden.donationId, "2026-09", 7_000_000n),
        leg(shown.donationId, "2026-10", 1_000_000n),
      ],
    });
    expect(result.organisations).toEqual([
      { name: "Acme", totalMinor: 1_000_000n },
    ]);
  });

  it("uses the latest wall name, trims it and lists each name once, sorted", () => {
    const zara = choice("zara", { showOnWall: true, wallName: "  Zara M. " });
    const asha1 = choice("asha", { showOnWall: true, wallName: "Asha" });
    const asha2 = choice("asha", { showOnWall: true, wallName: "Asha R." });
    const otherAsha = choice("asha-2", {
      showOnWall: true,
      wallName: "Asha R.",
    });
    const blank = choice("blank", { showOnWall: true, wallName: "   " });
    const result = buildRecognition({
      fy: FY,
      lockedMonths: LOCKED,
      choices: [zara, asha1, asha2, otherAsha, blank],
      legs: [zara, asha1, asha2, otherAsha, blank].map((c) =>
        leg(c.donationId, "2026-10", 10_000n)
      ),
    });
    expect(result.supporters).toEqual(["Asha R.", "Zara M."]);
  });

  it("sorts organisations by total, largest first", () => {
    const small = choice("small", {
      donorType: "csr",
      discloseOrganisation: true,
      organisationName: "Small Trust",
    });
    const big = choice("big", {
      donorType: "corporate",
      discloseOrganisation: true,
      organisationName: "Big Co",
    });
    const result = buildRecognition({
      fy: FY,
      lockedMonths: LOCKED,
      choices: [small, big],
      legs: [
        leg(small.donationId, "2026-10", 100_000n),
        leg(big.donationId, "2026-10", 900_000n),
      ],
    });
    expect(result.organisations.map((o) => o.name)).toEqual([
      "Big Co",
      "Small Trust",
    ]);
  });

  it("refuses a ledger leg for a donation it has no choice for", () => {
    expect(() =>
      buildRecognition({
        fy: FY,
        lockedMonths: LOCKED,
        choices: [],
        legs: [leg("ghost", "2026-10", 100n)],
      })
    ).toThrow(/ghost/);
  });

  it("returns names and organisation totals only: no ids, types or dates", () => {
    const asha = choice("donor-asha", {
      showOnWall: true,
      wallName: "Asha R.",
    });
    const acme = choice("donor-acme", {
      donorType: "corporate",
      discloseOrganisation: true,
      organisationName: "Acme",
    });
    const json = JSON.stringify(
      buildRecognition({
        fy: FY,
        lockedMonths: LOCKED,
        choices: [asha, acme],
        legs: [
          leg(asha.donationId, "2026-10", 50_000n),
          leg(acme.donationId, "2026-10", 50_000n),
        ],
      }),
      bigints
    );
    for (const forbidden of [
      "donor-",
      "donation-",
      "corporate",
      "individual",
      "2026",
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });
});

function bigints(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
