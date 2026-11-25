import { describe, it, expect } from "vitest";
import { createHarness } from "@/test/harness";
import { SEED_COMPETITION_MANAGER } from "./competitions";
import { SEED_GUARDIANS } from "./guardians";
import { SEED_COORDINATORS } from "./coordinators";
import { SEED_ARTWORK, SEED_ARTWORK_VERIFIER } from "./physical-artwork";

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
        { status: "discrepancy" },
        { status: "verified" },
        { status: "verified" },
      ],
    });
    const school = h.as(await h.signIn(SEED_COORDINATORS.coordinator));
    expect(await school.listMyArtworks()).toMatchObject({
      ok: true,
      artworks: [
        { status: "requested", artworkCode: "ORIG27-A-5EED01" },
        { status: "dispatched", artworkCode: "ORIG27-A-5EED02" },
        { status: "received", artworkCode: "ORIG27-A-5EED04" },
        { status: "verified", artworkCode: "ORIG27-A-5EED07" },
        { status: "retained", artworkCode: "AUCT27-A-5EED01" },
      ],
    });
    const guardian = h.as(await h.signIn(SEED_GUARDIANS.guardian));
    expect(await guardian.listMyArtworks()).toMatchObject({
      ok: true,
      artworks: [
        { status: "requested", artworkCode: "ORIG27-A-5EED03" },
        { status: "verified", artworkCode: "AUCT27-A-5EED04" },
        {
          status: "verified",
          artworkCode: "ORIG27-A-5EED06",
          returnRequested: true,
        },
        { status: "on_exhibition", artworkCode: "AUCT27-A-5EED02" },
      ],
    });
    const verifier = h.as(await h.signIn(SEED_ARTWORK_VERIFIER));
    const verified = await manager.getArtwork({
      artworkCode: SEED_ARTWORK.codes[5],
    });
    if (!verified.ok) throw new Error("missing verified example");
    const custody = await verifier.getArtworkCustody({
      artworkId: verified.artwork.artworkId,
    });
    expect(custody).toMatchObject({
      ok: true,
      status: "verified",
      events: [{ kind: "received" }, { kind: "stored" }],
      photos: [
        { kind: "front", status: "clean" },
        { kind: "back", status: "clean" },
      ],
    });
    expect(await verifier.listArtworkDiscrepancies({})).toMatchObject({
      ok: true,
      discrepancies: [{ artworkCode: SEED_ARTWORK.codes[4] }],
    });
    await h.seed.preview();
    expect(
      await manager.listArtworks({ competitionId: SEED_ARTWORK.competitionId })
    ).toEqual(board);
  });
});
