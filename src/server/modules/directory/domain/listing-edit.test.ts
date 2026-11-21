import { describe, expect, it } from "vitest";

import type { ListingDetails } from "./listing-input";
import { listingEditResource, planListingEdit } from "./listing-edit";

const BEFORE: ListingDetails = {
  type: "shelter",
  name: "Safe Paws Shelter",
  description: "A shelter for senior dogs.",
  services: ["shelter", "adoption"],
  address: "Plot 7, MIDC Road",
  city: "Nagpur",
  state: "Maharashtra",
  pinCode: "440001",
  contactPhone: "+919812345678",
  contactEmail: "hello@safepaws.example",
  website: null,
  publicContactFields: ["email"],
};

describe("planListingEdit on a verified listing", () => {
  it("puts a detail edit live at once and names the changed fields", () => {
    expect(
      planListingEdit({
        from: "verified",
        before: BEFORE,
        after: {
          ...BEFORE,
          description: "A shelter for senior dogs and cats.",
          contactPhone: "+919800000000",
          publicContactFields: ["phone", "email"],
        },
      })
    ).toEqual({
      ok: true,
      changed: true,
      fields: ["description", "contactPhone", "publicContactFields"],
      to: "verified",
      outcome: "edited",
      event: null,
    });
  });

  it.each(["name", "type"] as const)(
    "sends it back to review when the %s changes",
    (field) => {
      const after = {
        ...BEFORE,
        ...(field === "name" ? { name: "Safe Paws Trust" } : { type: "ngo" }),
      } satisfies ListingDetails;
      expect(
        planListingEdit({ from: "verified", before: BEFORE, after })
      ).toEqual({
        ok: true,
        changed: true,
        fields: [field],
        to: "pending_verification",
        outcome: "resubmitted",
        event: "directory.listing_submitted",
      });
    }
  );

  it("treats reordered services and public contacts as no change", () => {
    expect(
      planListingEdit({
        from: "verified",
        before: BEFORE,
        after: { ...BEFORE, services: ["adoption", "shelter"] },
      })
    ).toEqual({ ok: true, changed: false });
  });

  it("reports an identical edit as no change", () => {
    expect(
      planListingEdit({
        from: "verified",
        before: BEFORE,
        after: { ...BEFORE },
      })
    ).toEqual({ ok: true, changed: false });
  });
});

describe("planListingEdit by status", () => {
  const rename = { ...BEFORE, name: "Safe Paws Trust" };

  it("lets a pending listing change anything and stay pending", () => {
    expect(
      planListingEdit({
        from: "pending_verification",
        before: BEFORE,
        after: rename,
      })
    ).toEqual({
      ok: true,
      changed: true,
      fields: ["name"],
      to: "pending_verification",
      outcome: "edited",
      event: null,
    });
  });

  it.each(["rejected", "suspended", "withdrawn"] as const)(
    "refuses edits to a %s listing",
    (from) => {
      expect(planListingEdit({ from, before: BEFORE, after: rename })).toEqual({
        ok: false,
        error: "listing_not_editable",
      });
      expect(
        planListingEdit({ from, before: BEFORE, after: { ...BEFORE } })
      ).toEqual({ ok: false, error: "listing_not_editable" });
    }
  );
});

describe("listingEditResource", () => {
  const listing = {
    id: "0193f000-0000-7000-8000-00000000000a",
    ownerUserId: "0193f000-0000-7000-8000-0000000000aa",
  };

  it("lets the owner act on a pending listing, before anyone holds the role", () => {
    expect(
      listingEditResource({ ...listing, status: "pending_verification" })
    ).toEqual({
      scopes: [{ type: "organisation", id: listing.id }],
      ownerId: listing.ownerUserId,
    });
  });

  it.each(["verified", "suspended", "rejected", "withdrawn"] as const)(
    "leaves only the representative role once the listing is %s",
    (status) => {
      expect(listingEditResource({ ...listing, status })).toEqual({
        scopes: [{ type: "organisation", id: listing.id }],
      });
    }
  );
});
