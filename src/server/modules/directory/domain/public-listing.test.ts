import { describe, expect, it } from "vitest";

import type { ListingStatus } from "./listing-status";
import { toPublicListing, type StoredListing } from "./public-listing";

const STORED: StoredListing = {
  id: "0193f000-0000-7000-8000-00000000000b",
  slug: "kind-hands-rescue",
  status: "verified",
  ownerUserId: "0193f000-0000-7000-8000-0000000000bb",
  statusReason: "Matched Aadhaar and two vet references",
  type: "independent_rescuer",
  name: "Kind Hands Rescue",
  description: "I rescue and foster kittens in Indiranagar.",
  services: ["rescue", "fostering"],
  address: "Flat 3B, 14th Cross, Indiranagar",
  city: "Bengaluru",
  state: "Karnataka",
  pinCode: "560038",
  contactPhone: "+919845012345",
  contactEmail: "kindhands@example.test",
  website: "https://kindhands.example/",
  publicContactFields: ["email"],
};

describe("toPublicListing", () => {
  it("shows a verified listing with only the contacts it chose", () => {
    expect(toPublicListing(STORED)).toEqual({
      slug: "kind-hands-rescue",
      type: "independent_rescuer",
      name: "Kind Hands Rescue",
      description: "I rescue and foster kittens in Indiranagar.",
      services: ["rescue", "fostering"],
      city: "Bengaluru",
      state: "Karnataka",
      pinCode: "560038",
      contact: { email: "kindhands@example.test" },
    });
  });

  it("never carries the address, owner, reason, id or unchosen contacts", () => {
    const json = JSON.stringify(toPublicListing(STORED));
    for (const secret of [
      STORED.address,
      "14th Cross",
      STORED.ownerUserId,
      STORED.id,
      STORED.statusReason!,
      STORED.contactPhone,
      "98450",
      STORED.website!,
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("shows every contact the listing chose", () => {
    expect(
      toPublicListing({
        ...STORED,
        publicContactFields: ["phone", "email", "website"],
      })?.contact
    ).toEqual({
      phone: "+919845012345",
      email: "kindhands@example.test",
      website: "https://kindhands.example/",
    });
  });

  it("shows no contacts when none were chosen", () => {
    expect(
      toPublicListing({ ...STORED, publicContactFields: [] })?.contact
    ).toEqual({});
  });

  it("skips a chosen contact that has since been removed", () => {
    expect(
      toPublicListing({
        ...STORED,
        website: null,
        publicContactFields: ["website"],
      })?.contact
    ).toEqual({});
  });

  it.each([
    "pending_verification",
    "rejected",
    "suspended",
    "withdrawn",
  ] satisfies ListingStatus[])("hides a %s listing", (status) => {
    expect(toPublicListing({ ...STORED, status })).toBeNull();
  });
});
