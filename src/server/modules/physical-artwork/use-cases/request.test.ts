import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { artworkWorld } from "../testing";

/** 10:00 IST on 15 January 2027. */
const NOW = "2027-01-15T04:30:00.000Z";
/** 23:59:59 IST on 29 January 2027: 14 days after NOW. */
const DEADLINE = new Date("2027-01-29T18:29:59.000Z");

async function setUp() {
  const h = await createHarness({ now: NOW });
  const world = artworkWorld(h);
  const competition = world.competition({ code: "PAWS26" });
  const manager = await world.staff("competition_manager", {
    competitionId: competition.id,
  });
  return { h, world, competition, manager };
}

describe("requestPhysicalArtwork", () => {
  it("asks each verified entry for its original work under a new Artwork ID", async () => {
    const { world, competition, manager } = await setUp();
    const entries = [
      world.entry(competition),
      world.entry(competition),
      world.entry(competition),
    ];

    const result = await world.as(manager).requestPhysicalArtwork({
      competitionId: competition.id,
      entryIds: entries.map((entry) => entry.id),
    });

    if (!result.ok) throw new Error(`Refused: ${result.error}`);
    expect(result.artworks.map((artwork) => artwork.entryId)).toEqual(
      entries.map((entry) => entry.id)
    );
    const codes = result.artworks.map((artwork) => artwork.artworkCode);
    for (const code of codes) {
      expect(code).toMatch(/^PAWS26-A-[0-9A-HJKMNP-TV-Z]{6}$/);
    }
    expect(new Set(codes).size).toBe(3);
    for (const artwork of result.artworks) {
      expect(artwork.dispatchDeadline).toEqual(DEADLINE);
    }
  });

  it("keeps what the sender was told, even after the settings change", async () => {
    const { world, competition, manager } = await setUp();
    const entry = world.entry(competition);

    const result = await world.as(manager).requestPhysicalArtwork({
      competitionId: competition.id,
      entryIds: [entry.id],
    });
    world.settings.packagingInstructions = "Roll it in a tube.";
    world.settings.shippingPayer = "foa";
    world.settings.facilityAddress = "Somewhere else";

    if (!result.ok) throw new Error(`Refused: ${result.error}`);
    const detail = await world.as(manager).getArtwork({
      artworkCode: result.artworks[0]!.artworkCode,
    });
    expect(detail).toMatchObject({
      ok: true,
      artwork: {
        status: "requested",
        entryId: entry.id,
        competitionId: competition.id,
        dispatchDeadline: DEADLINE,
        packagingInstructions:
          "Lay the artwork flat between two sheets of stiff card, write its Artwork ID on the back in pencil, and seal it in a waterproof sleeve.",
        shippingPayer: "sender",
        facilityAddress:
          "Friends of Animals (sample address), 1 Example Road, Pune 411001",
      },
    });
  });

  it("uses the instructions and payer the manager edited on the form", async () => {
    const { world, competition, manager } = await setUp();
    const entry = world.entry(competition);

    const result = await world.as(manager).requestPhysicalArtwork({
      competitionId: competition.id,
      entryIds: [entry.id],
      packagingInstructions: "  Frame-free, wrapped in bubble wrap.  ",
      shippingPayer: "foa",
    });

    if (!result.ok) throw new Error(`Refused: ${result.error}`);
    const detail = await world.as(manager).getArtwork({
      artworkCode: result.artworks[0]!.artworkCode,
    });
    expect(detail).toMatchObject({
      ok: true,
      artwork: {
        packagingInstructions: "Frame-free, wrapped in bubble wrap.",
        shippingPayer: "foa",
      },
    });
  });

  it("closes the window at the end of the IST day the dispatch-days setting names", async () => {
    const { world, competition, manager } = await setUp();
    world.settings.dispatchDays = 3;
    const entry = world.entry(competition);

    const result = await world.as(manager).requestPhysicalArtwork({
      competitionId: competition.id,
      entryIds: [entry.id],
    });

    expect(result).toMatchObject({
      ok: true,
      artworks: [{ dispatchDeadline: new Date("2027-01-18T18:29:59.000Z") }],
    });
  });

  it("draws another code when the first one is already taken", async () => {
    const { world, competition, manager } = await setUp();
    const [first, second] = [world.entry(competition), world.entry(competition)];
    world.queueCode("TAKEN0");
    await world.as(manager).requestPhysicalArtwork({
      competitionId: competition.id,
      entryIds: [first.id],
    });
    world.queueCode("TAKEN0");

    const result = await world.as(manager).requestPhysicalArtwork({
      competitionId: competition.id,
      entryIds: [second.id],
    });

    if (!result.ok) throw new Error(`Refused: ${result.error}`);
    expect(result.artworks[0]!.artworkCode).toMatch(/^PAWS26-A-/);
    expect(result.artworks[0]!.artworkCode).not.toBe("PAWS26-A-TAKEN0");
  });

  it("writes one audit entry per artwork, naming the manager's role", async () => {
    const { world, competition, manager } = await setUp();
    const entries = [world.entry(competition), world.entry(competition)];

    const result = await world.as(manager).requestPhysicalArtwork({
      competitionId: competition.id,
      entryIds: entries.map((entry) => entry.id),
    });

    if (!result.ok) throw new Error(`Refused: ${result.error}`);
    expect(world.audit).toEqual(
      result.artworks.map((artwork) => ({
        action: "physical_artwork.requested",
        entity: { type: "physical_artwork", id: artwork.artworkId },
        before: null,
        after: {
          status: "requested",
          entryId: artwork.entryId,
          artworkCode: artwork.artworkCode,
        },
        actorRole: "competition_manager",
        actor: manager,
      }))
    );
  });

  describe("refuses the whole request, writing nothing", () => {
    it("when an entry isn't FOA-verified yet", async () => {
      const { world, competition, manager } = await setUp();
      const verified = world.entry(competition);
      const waiting = world.entry(competition, { status: "submitted_to_foa" });

      const result = await world.as(manager).requestPhysicalArtwork({
        competitionId: competition.id,
        entryIds: [verified.id, waiting.id],
      });

      expect(result).toEqual({
        ok: false,
        error: "entry_not_verified",
        entryId: waiting.id,
      });
      expect(await artworksOf(world, manager, competition.id)).toEqual([]);
      expect(world.audit).toEqual([]);
    });

    it("when the competition doesn't ask for original work", async () => {
      const { world, manager: _ } = await setUp();
      const digitalOnly = world.competition({ physicalArtworkRequired: false });
      const manager = await world.staff("competition_manager");
      const entry = world.entry(digitalOnly);

      const result = await world.as(manager).requestPhysicalArtwork({
        competitionId: digitalOnly.id,
        entryIds: [entry.id],
      });

      expect(result).toEqual({
        ok: false,
        error: "physical_not_required",
        entryId: entry.id,
      });
    });

    it("when an entry's artwork was already requested", async () => {
      const { world, competition, manager } = await setUp();
      const [first, second] = [
        world.entry(competition),
        world.entry(competition),
      ];
      await world.as(manager).requestPhysicalArtwork({
        competitionId: competition.id,
        entryIds: [first.id],
      });

      const result = await world.as(manager).requestPhysicalArtwork({
        competitionId: competition.id,
        entryIds: [second.id, first.id],
      });

      expect(result).toEqual({
        ok: false,
        error: "already_requested",
        entryId: first.id,
      });
      expect(
        (await artworksOf(world, manager, competition.id)).map(
          (artwork) => artwork.entryId
        )
      ).toEqual([first.id]);
    });

    it("when an entry belongs to another competition", async () => {
      const { world, competition, manager } = await setUp();
      const other = world.competition();
      const ours = world.entry(competition);
      const theirs = world.entry(other);

      const result = await world.as(manager).requestPhysicalArtwork({
        competitionId: competition.id,
        entryIds: [ours.id, theirs.id],
      });

      expect(result).toEqual({ ok: false, error: "not_found" });
      expect(await artworksOf(world, manager, competition.id)).toEqual([]);
    });

    it("when an entry or the competition doesn't exist", async () => {
      const { world, competition, manager } = await setUp();
      const entry = world.entry(competition);
      const admin = await world.staff("competition_manager");

      expect(
        await world.as(manager).requestPhysicalArtwork({
          competitionId: competition.id,
          entryIds: [entry.id, "01890a5d-ac96-7b3c-8c8e-7a3b5c6d7e8f"],
        })
      ).toEqual({ ok: false, error: "not_found" });
      expect(
        await world.as(admin).requestPhysicalArtwork({
          competitionId: "01890a5d-ac96-7b3c-8c8e-7a3b5c6d7e8f",
          entryIds: [entry.id],
        })
      ).toEqual({ ok: false, error: "not_found" });
    });

    it("when FOA's address is still a placeholder where it may not be used", async () => {
      const { world, competition, manager } = await setUp();
      world.settings.facilityAddress = null;
      const entry = world.entry(competition);

      const result = await world.as(manager).requestPhysicalArtwork({
        competitionId: competition.id,
        entryIds: [entry.id],
      });

      expect(result).toEqual({
        ok: false,
        error: "facility_address_not_configured",
      });
      expect(await artworksOf(world, manager, competition.id)).toEqual([]);
    });

    it.each([
      [{ entryIds: [] }, "entryIds"],
      [{ entryIds: ["not-an-id"] }, "entryIds"],
      [{ competitionId: "not-an-id" }, "competitionId"],
      [{ packagingInstructions: "   " }, "packagingInstructions"],
      [{ packagingInstructions: "x".repeat(2001) }, "packagingInstructions"],
      [{ shippingPayer: "school" }, "shippingPayer"],
    ])("when the input is %j", async (change, field) => {
      const { world, competition, manager } = await setUp();
      const entry = world.entry(competition);

      const result = await world.as(manager).requestPhysicalArtwork({
        competitionId: competition.id,
        entryIds: [entry.id],
        ...(change as object),
      });

      expect(result).toEqual({
        ok: false,
        error: "invalid_input",
        fields: [field],
      });
    });

    it("when the same entry is listed twice", async () => {
      const { world, competition, manager } = await setUp();
      const entry = world.entry(competition);

      const result = await world.as(manager).requestPhysicalArtwork({
        competitionId: competition.id,
        entryIds: [entry.id, entry.id],
      });

      expect(result).toEqual({
        ok: false,
        error: "invalid_input",
        fields: ["entryIds"],
      });
    });
  });
});

async function artworksOf(
  world: ReturnType<typeof artworkWorld>,
  manager: Parameters<ReturnType<typeof artworkWorld>["as"]>[0],
  competitionId: string
) {
  const list = await world.as(manager).listArtworks({ competitionId });
  if (!list.ok) throw new Error(`Could not list: ${list.error}`);
  return list.artworks;
}
