import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, directoryListing, outbox } from "@/server/db/schema";
import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import { registeredListing, validListing } from "./testing";

describe("registerListing", () => {
  it("registers a listing that waits, private, for FOA to verify it", async () => {
    const h = await createHarness();
    const owner = await h.signIn(await h.seed.member());

    const result = await h.as(owner).registerListing(validListing());

    expect(result).toEqual({
      ok: true,
      listingId: expect.any(String),
      slug: "paws-trust",
    });
    if (!result.ok) return;
    expect(
      await h.as(h.visitor()).getPublicListing({ slug: "paws-trust" })
    ).toEqual({ ok: false, error: "not_found" });
    expect(await h.as(owner).listMyListings()).toEqual([
      expect.objectContaining({
        id: result.listingId,
        name: "Paws Trust",
        status: "pending_verification",
        canEdit: true,
        canWithdraw: true,
      }),
    ]);
    const mine = await h
      .as(owner)
      .getMyListing({ listingId: result.listingId });
    expect(mine).toMatchObject({
      ok: true,
      listing: {
        slug: "paws-trust",
        type: "ngo",
        name: "Paws Trust",
        services: ["rescue", "veterinary_care"],
        address: "12 Lane 4, Koregaon Park",
        pinCode: "411001",
        contactPhone: "+919876543210",
        contactEmail: "hello@pawstrust.example.test",
        website: "https://pawstrust.example.test/",
        publicContactFields: ["email", "website"],
        status: "pending_verification",
        statusReason: null,
      },
    });
  });

  it("keeps the address, phone and email unreadable at rest", async () => {
    const h = await createHarness();
    const { listingId } = await registeredListing(h);

    const [row] = await h.db
      .select()
      .from(directoryListing)
      .where(eq(directoryListing.id, listingId));
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("Koregaon");
    expect(stored).not.toContain("9876543210");
    expect(stored).not.toContain("hello@pawstrust");
  });

  it("writes one audit entry and tells the outbox, naming no contact details", async () => {
    const h = await createHarness();
    const { listingId, person } = await registeredListing(h);

    const audits = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.entityId, listingId));
    expect(audits).toEqual([
      expect.objectContaining({
        action: "directory.listing_registered",
        entityType: "directory_listing",
        actorUserId: person.id,
        after: { status: "pending_verification" },
      }),
    ]);
    const events = await h.db
      .select({ type: outbox.eventType, payload: outbox.payload })
      .from(outbox)
      .where(eq(outbox.aggregateId, listingId));
    expect(events).toEqual([
      {
        type: "directory.listing_submitted",
        payload: { listingId, userId: person.id },
      },
    ]);
  });

  it("names each field it can't accept and stores nothing", async () => {
    const h = await createHarness();
    const owner = await h.signIn(await h.seed.member());

    const result = await h.as(owner).registerListing(
      validListing({
        type: "zoo",
        pinCode: "011001",
        services: [],
        contactPhone: "12345",
        contactEmail: "",
        publicContactFields: ["email"],
      })
    );

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: expect.arrayContaining([
        "type",
        "pinCode",
        "services",
        "contactPhone",
      ]),
    });
    expect(await h.db.select().from(directoryListing)).toEqual([]);
  });

  it("asks for an email or website before showing it to the public", async () => {
    const h = await createHarness();
    const owner = await h.signIn(await h.seed.member());

    const result = await h
      .as(owner)
      .registerListing(
        validListing({ website: "", publicContactFields: ["website"] })
      );

    expect(result).toEqual({
      ok: false,
      error: "invalid_input",
      fields: ["publicContactFields"],
    });
  });

  it("gives a second listing with the same name its own address", async () => {
    const h = await createHarness();
    await registeredListing(h);

    const second = await registeredListing(h, { city: "Mumbai" });

    expect(second.slug).toBe("paws-trust-2");
  });

  it("allows one open listing per person until it is rejected or withdrawn", async () => {
    const h = await createHarness();
    const { actor, listingId } = await registeredListing(h);

    expect(
      await h.as(actor).registerListing(validListing({ name: "Paws Two" }))
    ).toEqual({ ok: false, error: "already_registered" });

    await h.as(actor).withdrawListing({ listingId, reason: "" });
    const again = await h
      .as(actor)
      .registerListing(validListing({ name: "Paws Two" }));
    expect(again).toMatchObject({ ok: true, slug: "paws-two" });
  });

  it("refuses a visitor", async () => {
    const h = await createHarness();

    await expect(
      h.as(h.visitor()).registerListing(validListing())
    ).rejects.toThrow(DomainError);
    expect(await h.db.select().from(directoryListing)).toEqual([]);
  });
});
