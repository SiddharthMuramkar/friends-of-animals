import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { directoryListing, userRole } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { SEED_DIRECTORY } from "./directory";

describe("seedDirectory", () => {
  it("gives a preview a listing in every status, however often it runs", async () => {
    const h = await createHarness();

    await h.seed.preview();
    h.clock.advance({ days: 1 });
    await h.seed.preview();

    const rows = await h.db
      .select({ id: directoryListing.id, status: directoryListing.status })
      .from(directoryListing)
      .orderBy(asc(directoryListing.id));
    expect(rows).toEqual([
      { id: SEED_DIRECTORY.ngo.id, status: "verified" },
      { id: SEED_DIRECTORY.rescuer.id, status: "verified" },
      { id: SEED_DIRECTORY.pending.id, status: "pending_verification" },
      { id: SEED_DIRECTORY.rejected.id, status: "rejected" },
      { id: SEED_DIRECTORY.suspended.id, status: "suspended" },
    ]);
  });

  it("shows the verified NGO publicly and lets its representative edit it", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const { ngo } = SEED_DIRECTORY;

    expect(
      await h.as(h.visitor()).getPublicListing({ slug: ngo.slug })
    ).toMatchObject({ ok: true, listing: { name: ngo.name } });
    const grants = await h.db
      .select({ role: userRole.role, scopeId: userRole.scopeId })
      .from(userRole)
      .where(eq(userRole.userId, ngo.representative.id));
    expect(grants).toEqual([
      { role: "organisation_representative", scopeId: ngo.id },
    ]);
    const representative = await h.signIn(ngo.representative);
    expect(
      await h.as(representative).getMyListing({ listingId: ngo.id })
    ).toMatchObject({
      ok: true,
      listing: { address: "1 Seed Lane", canEdit: true },
    });
  });

  it("puts the pending shelter, with its document, in the staff queue", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const staff = await h.signIn(await h.seed.superAdmin());

    expect(await h.as(staff).listListingsForReview()).toMatchObject({
      ok: true,
      listings: [{ id: SEED_DIRECTORY.pending.id }],
    });
    expect(
      await h
        .as(staff)
        .getListingForReview({ listingId: SEED_DIRECTORY.pending.id })
    ).toMatchObject({
      ok: true,
      listing: {
        documents: [
          {
            id: SEED_DIRECTORY.pending.documentId,
            kind: "registration_certificate",
            fileStatus: "clean",
          },
        ],
      },
    });
  });

  it("builds a verified listing for tests, whose owner represents it", async () => {
    const h = await createHarness();

    const { listingId, slug, owner } = await h.seed.directoryListing({
      name: "Builder Paws",
      services: ["ambulance"],
    });

    expect(await h.as(h.visitor()).getPublicListing({ slug })).toMatchObject({
      ok: true,
      listing: { name: "Builder Paws", services: ["ambulance"] },
    });
    expect(
      await h.as(await h.signIn(owner)).getMyListing({ listingId })
    ).toMatchObject({ ok: true });
  });
});
