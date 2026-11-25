import { describe, it, expect } from "vitest";
import { createHarness } from "@/test/harness";
import { SEED_COMPETITION_MANAGER } from "./competitions";
import { SEED_GUARDIANS } from "./guardians";
import { SEED_COORDINATORS } from "./coordinators";
import { SEED_ARTWORK } from "./physical-artwork";

describe("physical artwork preview", () => {
  it("shows the manager, school and guardian realistic artwork custody, and reseeds safely", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const manager = h.as(await h.signIn(SEED_COMPETITION_MANAGER));
    const board = await manager.listArtworks({
      competitionId: SEED_ARTWORK.competitionId,
    });
    expect(board).toMatchObject({
      ok: true,
      artworks: [
        { status: "requested", overdue: true },
        { status: "requested", overdue: false },
        { status: "dispatched" },
        { status: "received" },
      ],
    });
    const school = h.as(await h.signIn(SEED_COORDINATORS.coordinator));
    expect(await school.listMyArtworks()).toMatchObject({
      ok: true,
      artworks: [
        { status: "requested" },
        { status: "dispatched" },
        { status: "received" },
      ],
    });
    const guardian = h.as(await h.signIn(SEED_GUARDIANS.guardian));
    expect(await guardian.listMyArtworks()).toMatchObject({
      ok: true,
      artworks: [{ status: "requested", artworkCode: "ORIG27-A-5EED03" }],
    });
    await h.seed.preview();
    expect(
      await manager.listArtworks({ competitionId: SEED_ARTWORK.competitionId })
    ).toEqual(board);
  });
});
