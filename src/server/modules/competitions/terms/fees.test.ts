import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { competition, competitionFee } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import {
  competitionAudit,
  seedCompetition,
  signInManager,
  termsRowCounts,
} from "./testing";

async function feeRows(
  h: Awaited<ReturnType<typeof createHarness>>,
  competitionId: string
) {
  return h.db
    .select({
      route: competitionFee.route,
      amountMinor: competitionFee.amountMinor,
      currency: competitionFee.currency,
    })
    .from(competitionFee)
    .where(eq(competitionFee.competitionId, competitionId))
    .orderBy(competitionFee.route);
}

describe("setCompetitionFees", () => {
  it("stores the fee per route in paise and gives it back to the edit form", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h, { participation: "both" });

    expect(
      await h.as(manager).setCompetitionFees({
        competitionId: id,
        fees: { individual: "1,500", institution: "25000.50" },
        currency: "INR",
      })
    ).toEqual({ ok: true, changed: true });

    expect(await feeRows(h, id)).toEqual([
      { route: "individual", amountMinor: 150000n, currency: "INR" },
      { route: "institution", amountMinor: 2500050n, currency: "INR" },
    ]);
    const edit = await h
      .as(manager)
      .getCompetitionTermsForEdit({ competitionId: id });
    expect(edit.ok && edit.terms.fees).toEqual({
      editable: true,
      currency: "INR",
      lines: [
        { route: "individual", kind: "amount", paise: 150000n },
        { route: "institution", kind: "amount", paise: 2500050n },
      ],
    });
  });

  it("makes every route the competition offers free, and only those", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h, { participation: "individuals" });

    await h.as(manager).setCompetitionFees({ competitionId: id, free: true });

    expect(await feeRows(h, id)).toEqual([
      { route: "individual", amountMinor: 0n, currency: "INR" },
    ]);
  });

  it("keeps an amount above 2^31 paise exact", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h, { participation: "individuals" });

    await h.as(manager).setCompetitionFees({
      competitionId: id,
      fees: { individual: "21474836.49" },
      currency: "INR",
    });

    const [row] = await feeRows(h, id);
    expect(row?.amountMinor).toBe(2147483649n);
    const edit = await h
      .as(manager)
      .getCompetitionTermsForEdit({ competitionId: id });
    expect(edit.ok && edit.terms.fees.lines).toEqual([
      { route: "individual", kind: "amount", paise: 2147483649n },
    ]);
  });

  describe("refuses, writing nothing", () => {
    it.each([
      [
        "a currency other than INR",
        "both",
        { fees: { individual: "100", institution: "100" }, currency: "USD" },
        [{ code: "unsupported_currency" }],
      ],
      [
        "a negative amount",
        "individuals",
        { fees: { individual: "-100" }, currency: "INR" },
        [{ code: "invalid_amount", route: "individual" }],
      ],
      [
        "three decimals",
        "individuals",
        { fees: { individual: "100.123" }, currency: "INR" },
        [{ code: "invalid_amount", route: "individual" }],
      ],
      [
        "an exponent",
        "individuals",
        { fees: { individual: "1e5" }, currency: "INR" },
        [{ code: "invalid_amount", route: "individual" }],
      ],
      [
        "garbage",
        "individuals",
        { fees: { individual: "five hundred" }, currency: "INR" },
        [{ code: "invalid_amount", route: "individual" }],
      ],
      [
        "a route the competition doesn't offer",
        "individuals",
        { fees: { individual: "100", institution: "100" }, currency: "INR" },
        [{ code: "route_not_offered", route: "institution" }],
      ],
      [
        "an offered route left empty",
        "both",
        { fees: { individual: "100", institution: " " }, currency: "INR" },
        [{ code: "missing_fee", route: "institution" }],
      ],
    ] as const)("%s", async (_name, participation, fees, problems) => {
      const h = await createHarness();
      const manager = await signInManager(h);
      const { id } = await seedCompetition(h, { participation });
      const before = await termsRowCounts(h);

      expect(
        await h.as(manager).setCompetitionFees({ competitionId: id, ...fees })
      ).toEqual({ ok: false, error: "invalid_fees", problems });
      expect(await termsRowCounts(h)).toEqual(before);
    });

    it("a draft with no participation chosen yet", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);
      const { id } = await seedCompetition(h, { participation: null });

      expect(
        await h
          .as(manager)
          .setCompetitionFees({ competitionId: id, free: true })
      ).toEqual({ ok: false, error: "participation_not_set" });
      expect(await feeRows(h, id)).toEqual([]);
    });

    it("a competition that doesn't exist", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);

      expect(
        await h.as(manager).setCompetitionFees({
          competitionId: "01938a00-0000-7000-8000-0000000000aa",
          free: true,
        })
      ).toEqual({ ok: false, error: "not_found" });
    });
  });

  it("is backed by the database: no negative amount, no currency but INR", async () => {
    const h = await createHarness();
    const { id } = await seedCompetition(h, { participation: "both" });
    const row = {
      competitionId: id,
      route: "individual",
      amountMinor: 100n,
      updatedAt: h.clock.now(),
    } as const;

    await expect(
      h.db.insert(competitionFee).values({ ...row, amountMinor: -1n })
    ).rejects.toThrow();
    await expect(
      h.db.insert(competitionFee).values({ ...row, currency: "USD" })
    ).rejects.toThrow();
    await h.db.insert(competitionFee).values(row);
    expect(await feeRows(h, id)).toHaveLength(1);
  });

  it("works while the competition is published", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h, {
      participation: "individuals",
      status: "published",
    });

    expect(
      await h.as(manager).setCompetitionFees({ competitionId: id, free: true })
    ).toEqual({ ok: true, changed: true });
  });

  it("drops a stored fee for a route the competition no longer offers", async () => {
    const h = await createHarness();
    const manager = await signInManager(h);
    const { id } = await seedCompetition(h, { participation: "both" });
    await h.as(manager).setCompetitionFees({ competitionId: id, free: true });
    await h.db
      .update(competition)
      .set({ participation: "institutions" })
      .where(eq(competition.id, id));

    await h.as(manager).setCompetitionFees({
      competitionId: id,
      fees: { institution: "500" },
      currency: "INR",
    });

    expect(await feeRows(h, id)).toEqual([
      { route: "institution", amountMinor: 50000n, currency: "INR" },
    ]);
  });

  describe("the audit log", () => {
    it("records each change once, with only the routes that changed", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);
      const { id } = await seedCompetition(h, { participation: "both" });

      await h.as(manager).setCompetitionFees({
        competitionId: id,
        fees: { individual: "1,500", institution: "25000.50" },
        currency: "INR",
      });
      await h.as(manager).setCompetitionFees({
        competitionId: id,
        fees: { individual: "1500", institution: "21474836.49" },
        currency: "INR",
      });

      expect(await competitionAudit(h, id)).toEqual([
        {
          action: "competition.fees_set",
          actorRole: "competition_manager",
          before: { fees: { individual: null, institution: null } },
          after: { fees: { individual: "150000", institution: "2500050" } },
        },
        {
          action: "competition.fees_set",
          actorRole: "competition_manager",
          before: { fees: { institution: "2500050" } },
          after: { fees: { institution: "2147483649" } },
        },
      ]);
    });

    it("records nothing when the amounts don't change", async () => {
      const h = await createHarness();
      const manager = await signInManager(h);
      const { id } = await seedCompetition(h, { participation: "both" });
      await h.as(manager).setCompetitionFees({ competitionId: id, free: true });

      expect(
        await h.as(manager).setCompetitionFees({
          competitionId: id,
          fees: { individual: "0", institution: "0.00" },
          currency: "INR",
        })
      ).toEqual({ ok: true, changed: false });
      expect(await competitionAudit(h, id)).toHaveLength(1);
      const rows = await h.db
        .select()
        .from(competitionFee)
        .where(
          and(
            eq(competitionFee.competitionId, id),
            eq(competitionFee.route, "individual")
          )
        );
      expect(rows).toHaveLength(1);
    });
  });
});
