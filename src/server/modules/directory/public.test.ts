import { describe, expect, it } from "vitest";

import { DomainError } from "@/server/errors";
import { createHarness } from "@/test/harness";

import { registeredListing, signedInStaff, verifiedListing } from "./testing";

describe("getPublicListing", () => {
  it("shows anyone a verified listing's own words, rough place and only the contacts it chose", async () => {
    const h = await createHarness();
    const { slug, person, listingId } = await verifiedListing(h, {
      publicContactFields: ["website"],
    });
    const member = await h.signIn(await h.seed.member());

    for (const who of [h.visitor(), member]) {
      const result = await h.as(who).getPublicListing({ slug });
      expect(result).toEqual({
        ok: true,
        listing: {
          slug,
          type: "ngo",
          name: "Paws Trust",
          description: "We rescue and treat street animals in Pune.",
          services: ["rescue", "veterinary_care"],
          city: "Pune",
          state: "Maharashtra",
          pinCode: "411001",
          contact: { website: "https://pawstrust.example.test/" },
        },
      });
      const shown = JSON.stringify(result);
      for (const hidden of [
        "Koregaon",
        "9876543210",
        "hello@pawstrust",
        "Checked the trust deed",
        person.id,
        listingId,
      ]) {
        expect(shown).not.toContain(hidden);
      }
    }
  });

  it("answers not found for an unknown slug and for listings that aren't verified", async () => {
    const h = await createHarness();
    const pending = await registeredListing(h, { name: "Pending Paws" });
    const rejected = await registeredListing(h, { name: "Rejected Paws" });
    await h
      .as(await signedInStaff(h))
      .rejectListing({ listingId: rejected.listingId, reason: "No proof." });

    for (const slug of [pending.slug, rejected.slug, "no-such-listing", ""]) {
      expect(await h.as(h.visitor()).getPublicListing({ slug })).toEqual({
        ok: false,
        error: "not_found",
      });
    }
  });
});

describe("publicListingSlugs", () => {
  it("lists only verified listings, for the proxy's 404s", async () => {
    const h = await createHarness();
    const verified = await verifiedListing(h);
    await registeredListing(h, { name: "Pending Paws" });

    expect(await h.as(h.visitor()).publicListingSlugs()).toEqual([
      verified.slug,
    ]);
  });
});

describe("who may see their own listings", () => {
  it("refuses a visitor", async () => {
    const h = await createHarness();

    await expect(h.as(h.visitor()).listMyListings()).rejects.toThrow(
      DomainError
    );
  });

  it("shows a member with no listing an empty list", async () => {
    const h = await createHarness();
    await registeredListing(h);
    const member = await h.signIn(await h.seed.member());

    expect(await h.as(member).listMyListings()).toEqual([]);
  });
});
