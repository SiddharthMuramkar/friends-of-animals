import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, outbox } from "@/server/db/schema";

import {
  createDirectoryHarness,
  directoryActors,
  PAWS_TRUST,
  type DirectoryHarness,
} from "./testing";

async function directoryRows(h: DirectoryHarness) {
  const result = await h.db.execute<{
    id: string;
    address_ciphertext: string;
    contact_phone_ciphertext: string;
  }>(
    sql`select id, address_ciphertext, contact_phone_ciphertext from directory_listing`
  );
  return result.rows;
}

describe("registerListing", () => {
  it("registers a listing that stays private until it is verified", async () => {
    const h = await createDirectoryHarness();
    const { owner, ownerUser, otherMember } = await directoryActors(h);

    const registered = await h.as(owner).registerListing(PAWS_TRUST);

    if (!registered.ok) throw new Error(JSON.stringify(registered));
    expect(registered.slug).toBe("paws-trust");
    const { listingId } = registered;

    // The public can't see it, whoever asks.
    for (const actor of [h.visitor(), otherMember, owner]) {
      expect(
        await h.as(actor).getPublicListing({ slug: "paws-trust" })
      ).toEqual({ ok: false, error: "not_found" });
    }

    // Its owner sees every field, read into its stored form.
    expect(await h.as(owner).getMyListing()).toEqual({
      ok: true,
      listing: {
        id: listingId,
        slug: "paws-trust",
        status: "pending_verification",
        statusReason: null,
        ownerUserId: ownerUser.id,
        type: "ngo",
        name: "Paws Trust",
        description: "We rescue and treat street animals in Pune.",
        services: ["rescue", "veterinary_care"],
        address: "12 Lane 4, Koregaon Park",
        city: "Pune",
        state: "Maharashtra",
        pinCode: "411001",
        contactPhone: "+919876543210",
        contactEmail: "hello@pawstrust.example",
        website: "https://pawstrust.example/",
        publicContactFields: ["email", "website"],
      },
    });
    expect(await h.as(otherMember).getMyListing()).toEqual({
      ok: false,
      error: "not_found",
    });

    // One submitted event for the outbox, and one audit entry.
    const events = await h.db
      .select()
      .from(outbox)
      .where(eq(outbox.eventType, "directory.listing_submitted"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregateType: "directory_listing",
      aggregateId: listingId,
      payload: { listingId, ownerUserId: ownerUser.id },
    });
    const audits = await h.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, "directory.listing_registered"));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorUserId: ownerUser.id,
      entityType: "directory_listing",
      entityId: listingId,
      before: null,
      after: { status: "pending_verification" },
    });
  });

  it("stores the address and contact phone encrypted", async () => {
    const h = await createDirectoryHarness();
    const { owner } = await directoryActors(h);
    await h.as(owner).registerListing(PAWS_TRUST);

    const [row] = await directoryRows(h);

    const stored = JSON.stringify(row);
    expect(stored).not.toContain("Koregaon");
    expect(stored).not.toContain("9876543210");
    expect(stored).not.toContain("98765");
    const mine = await h.as(owner).getMyListing();
    expect(mine).toMatchObject({
      ok: true,
      listing: {
        address: "12 Lane 4, Koregaon Park",
        contactPhone: "+919876543210",
      },
    });
  });

  it("gives a second listing with the same name the next free address", async () => {
    const h = await createDirectoryHarness();
    const { owner, otherMember } = await directoryActors(h);

    const first = await h.as(owner).registerListing(PAWS_TRUST);
    const second = await h.as(otherMember).registerListing(PAWS_TRUST);
    const third = await h
      .as(otherMember)
      .registerListing({ ...PAWS_TRUST, name: "Paws  Trust!" });

    expect([first, second, third]).toMatchObject([
      { ok: true, slug: "paws-trust" },
      { ok: true, slug: "paws-trust-2" },
      { ok: true, slug: "paws-trust-3" },
    ]);
  });

  it("names every bad field and writes nothing", async () => {
    const h = await createDirectoryHarness();
    const { owner } = await directoryActors(h);

    const result = await h.as(owner).registerListing({
      ...PAWS_TRUST,
      type: "hospital",
      services: [],
      pinCode: "011001",
      contactPhone: "12345",
    });

    expect(result).toEqual({
      ok: false,
      error: "invalid_listing",
      fields: {
        type: "invalid",
        services: "required",
        pinCode: "invalid",
        contactPhone: "invalid",
      },
    });
    expect(await directoryRows(h)).toEqual([]);
    expect(await h.db.select().from(outbox)).toEqual([]);
  });

  it("refuses a visitor, who has no listing of their own either", async () => {
    const h = await createDirectoryHarness();

    await expect(
      h.as(h.visitor()).registerListing(PAWS_TRUST)
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(h.as(h.visitor()).getMyListing()).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(await directoryRows(h)).toEqual([]);
  });
});
