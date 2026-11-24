// Creating an adoption listing (#129): only a verified directory listing's
// representatives, as a private draft.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { adoptionListing, auditLog } from "@/server/db/schema";
import { createHarness } from "@/test/harness";

import { BRUNO, member, representative, staffAdmin } from "./testing";

describe("createAdoptionListing", () => {
  it("lets a verified listing's representative write a private draft", async () => {
    const h = await createHarness();
    const rep = await representative(h);

    const result = await h.as(rep.actor).createAdoptionListing({
      directoryListingId: rep.listingId,
      ...BRUNO,
    });

    expect(result).toEqual({
      ok: true,
      adoptionListingId: expect.any(String),
      slug: "bruno-dog-pune",
    });
    if (!result.ok) return;
    const mine = await h
      .as(rep.actor)
      .getAdoptionListingForOwner({
        adoptionListingId: result.adoptionListingId,
      });
    expect(mine).toMatchObject({
      ok: true,
      listing: {
        status: "draft",
        slug: "bruno-dog-pune",
        details: { ...BRUNO },
        photos: [],
        publishBlockers: ["no_photo"],
      },
    });
    // Private until published.
    expect(
      await h.as(h.visitor()).getAdoptableAnimal({ slug: "bruno-dog-pune" })
    ).toEqual({ ok: false, error: "not_found" });
    const audit = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "adoption.listing_created"));
    expect(audit).toEqual([
      expect.objectContaining({
        entityType: "adoption_listing",
        entityId: result.adoptionListingId,
        actorRole: "organisation_representative",
        after: { status: "draft", directoryListingId: rep.listingId },
      }),
    ]);
  });

  it("stores a birth month, never an age, so the age keeps up", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const result = await h.as(rep.actor).createAdoptionListing({
      directoryListingId: rep.listingId,
      ...BRUNO,
      age: { years: 0, months: 5 },
    });
    if (!result.ok) throw new Error(result.error);
    const [row] = await h.db
      .select({ birthMonth: adoptionListing.birthMonth })
      .from(adoptionListing)
      .where(eq(adoptionListing.id, result.adoptionListingId));
    // The harness clock starts in January 2027.
    expect(row?.birthMonth).toBe("2026-08-01");

    h.clock.advance({ days: 62 });
    const mine = await h
      .as(rep.actor)
      .getAdoptionListingForOwner({
        adoptionListingId: result.adoptionListingId,
      });
    expect(mine.ok && mine.listing.details.age).toEqual({
      years: 0,
      months: 7,
    });
  });

  it("gives a second Bruno in Pune the next slug", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const input = { directoryListingId: rep.listingId, ...BRUNO };
    const first = await h.as(rep.actor).createAdoptionListing(input);
    const second = await h.as(rep.actor).createAdoptionListing(input);
    expect(first.ok && first.slug).toBe("bruno-dog-pune");
    expect(second.ok && second.slug).toBe("bruno-dog-pune-2");
  });

  it("names the fields that fail their checks", async () => {
    const h = await createHarness();
    const rep = await representative(h);
    const result = await h.as(rep.actor).createAdoptionListing({
      directoryListingId: rep.listingId,
      ...BRUNO,
      name: "  ",
      pinCode: "011001",
      conditions: "",
    });
    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: expect.arrayContaining(["name", "pinCode", "conditions"]),
    });
    expect(await h.db.select().from(adoptionListing)).toEqual([]);
  });

  it.each(["suspended"] as const)(
    "refuses the representative of a %s listing",
    async (status) => {
      const h = await createHarness();
      const rep = await representative(h, status);
      const result = await h.as(rep.actor).createAdoptionListing({
        directoryListingId: rep.listingId,
        ...BRUNO,
      });
      expect(result).toEqual({ ok: false, error: "directory_not_verified" });
      expect(await h.db.select().from(adoptionListing)).toEqual([]);
    }
  );

  it.each(["pending_verification", "rejected", "withdrawn"] as const)(
    "refuses the owner of a %s listing, who represents nothing",
    async (status) => {
      const h = await createHarness();
      const rep = await representative(h, status);
      await expect(
        h.as(rep.actor).createAdoptionListing({
          directoryListingId: rep.listingId,
          ...BRUNO,
        })
      ).rejects.toThrow(DomainError);
      expect(await h.db.select().from(adoptionListing)).toEqual([]);
    }
  );

  it.each([
    ["another listing's representative", "other"],
    ["a member", "member"],
    ["a staff admin", "staff"],
    ["a visitor", "visitor"],
  ] as const)("refuses %s", async (_, who) => {
    const h = await createHarness();
    const rep = await representative(h);
    const actor =
      who === "other"
        ? (await representative(h)).actor
        : who === "member"
          ? await member(h)
          : who === "staff"
            ? await staffAdmin(h)
            : h.visitor();
    await expect(
      h.as(actor).createAdoptionListing({
        directoryListingId: rep.listingId,
        ...BRUNO,
      })
    ).rejects.toThrow(DomainError);
    expect(await h.db.select().from(adoptionListing)).toEqual([]);
  });
});
