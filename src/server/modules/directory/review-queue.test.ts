import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import { REVIEW_PAGE_SIZE } from "./queries";
import { registeredListing, signedInStaff, verifiedListing } from "./testing";

describe("listListingsForReview", () => {
  it("lists pending listings oldest first, unless asked for another status", async () => {
    const h = await createHarness();
    const first = await registeredListing(h, { name: "First Paws" });
    h.clock.advance({ minutes: 5 });
    const second = await registeredListing(h, {
      name: "Second Paws",
      type: "independent_rescuer",
    });
    h.clock.advance({ minutes: 5 });
    const verified = await verifiedListing(h, { name: "Verified Paws" });
    const staff = await signedInStaff(h);

    expect(await h.as(staff).listListingsForReview()).toEqual({
      ok: true,
      listings: [
        expect.objectContaining({
          id: first.listingId,
          name: "First Paws",
          type: "ngo",
          city: "Pune",
          status: "pending_verification",
        }),
        expect.objectContaining({
          id: second.listingId,
          type: "independent_rescuer",
        }),
      ],
      next: null,
    });
    expect(
      await h.as(staff).listListingsForReview({ status: "verified" })
    ).toMatchObject({ listings: [{ id: verified.listingId }], next: null });
  });

  it("pages through a long queue", async () => {
    const h = await createHarness();
    const ids: string[] = [];
    for (let i = 0; i < REVIEW_PAGE_SIZE + 2; i++) {
      ids.push((await registeredListing(h, { name: `Paws ${i}` })).listingId);
      h.clock.advance({ seconds: 1 });
    }
    const staff = await signedInStaff(h);

    const page1 = await h.as(staff).listListingsForReview();
    if (!page1.ok) throw new Error("refused");
    expect(page1.listings.map((l) => l.id)).toEqual(
      ids.slice(0, REVIEW_PAGE_SIZE)
    );
    expect(page1.next).toBe(ids[REVIEW_PAGE_SIZE - 1]);

    const page2 = await h
      .as(staff)
      .listListingsForReview({ after: page1.next ?? undefined });
    expect(page2).toMatchObject({ ok: true, next: null });
    if (!page2.ok) return;
    expect(page2.listings.map((l) => l.id)).toEqual(
      ids.slice(REVIEW_PAGE_SIZE)
    );
  });
});

describe("getListingForReview", () => {
  it("shows staff every detail, decrypted, who registered it and what they may decide", async () => {
    const h = await createHarness();
    const { listingId, person } = await registeredListing(h, {
      type: "foster_caregiver",
      name: "Asha's Foster Home",
    });
    const staff = await signedInStaff(h, "super_admin");

    expect(await h.as(staff).getListingForReview({ listingId })).toMatchObject({
      ok: true,
      listing: {
        id: listingId,
        name: "Asha's Foster Home",
        address: "12 Lane 4, Koregaon Park",
        contactPhone: "+919876543210",
        contactEmail: "hello@pawstrust.example.test",
        owner: { id: person.id, email: person.email },
        documents: [],
        checklist: [
          { kind: "identity_proof", expected: "required", provided: false },
          { kind: "address_proof", expected: "optional", provided: false },
        ],
        allowedActions: ["verify", "reject"],
      },
    });
  });

  it("answers not found for a listing that doesn't exist", async () => {
    const h = await createHarness();
    const staff = await signedInStaff(h);

    expect(
      await h.as(staff).getListingForReview({
        listingId: "01938a00-0000-7000-8000-00000000dead",
      })
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("who may review", () => {
  it("refuses a community manager, a member, the listing's representative and a visitor", async () => {
    const h = await createHarness();
    const { listingId, actor } = await verifiedListing(h);
    const refused = [
      await signedInStaff(h, "community_manager"),
      await h.signIn(await h.seed.member()),
      actor,
      h.visitor(),
    ];

    for (const who of refused) {
      await expect(h.as(who).listListingsForReview()).rejects.toThrow(
        DomainError
      );
      await expect(
        h.as(who).getListingForReview({ listingId })
      ).rejects.toThrow(DomainError);
    }
  });
});
