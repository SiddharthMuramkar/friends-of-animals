import { getRewrittenUrl } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProxy } from "@/request-proxy";

/**
 * The proxy over a stand-in for the verified listings' slugs (the
 * directory through a memo, src/app/ngos/_lib/public-slugs.ts): the
 * verified slugs, or a failure. Records what each lookup was asked.
 */
function proxyOverListings() {
  const listings = {
    verified: new Set(["paws-trust", "paws-trust-2"]),
    fail: false,
    asked: [] as string[],
  };
  const proxy = createProxy({
    isPublishedCompetitionSlug: async () => false,
    isPublicPostSlug: async () => false,
    isPublicListingSlug: async (slug) => {
      listings.asked.push(slug);
      if (listings.fail) throw new Error("database unavailable");
      return listings.verified.has(slug);
    },
  });
  return { listings, proxy };
}

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://foa.example.test${path}`, { headers });
const MISSING = "https://foa.example.test/__not-found";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("proxy: directory listings", () => {
  it("lets a verified listing through", async () => {
    const { listings, proxy } = proxyOverListings();
    const response = await proxy(request("/ngos/paws-trust"));
    expect(getRewrittenUrl(response)).toBeNull();
    expect(listings.asked).toEqual(["paws-trust"]);
  });

  it("answers a listing that isn't verified with the 404", async () => {
    const { proxy } = proxyOverListings();
    for (const path of ["/ngos/a-pending-listing", "/ngos/suspended-paws"]) {
      expect(getRewrittenUrl(await proxy(request(path))), path).toBe(MISSING);
    }
  });

  it("answers a slug no listing could have with the 404 without asking", async () => {
    const { listings, proxy } = proxyOverListings();
    for (const path of [
      "/ngos/Paws-Trust",
      "/ngos/paws%20trust",
      "/ngos/%E0%A4",
    ]) {
      expect(getRewrittenUrl(await proxy(request(path))), path).toBe(MISSING);
    }
    expect(listings.asked).toEqual([]);
  });

  it("lets the request through when the database can't answer", async () => {
    const { listings, proxy } = proxyOverListings();
    listings.fail = true;
    expect(
      getRewrittenUrl(await proxy(request("/ngos/paws-trust")))
    ).toBeNull();
  });

  it("sends a visitor without a session from the register form to sign in", async () => {
    const { listings, proxy } = proxyOverListings();
    const response = await proxy(request("/ngos/register"));
    expect(response.headers.get("location")).toBe(
      "https://foa.example.test/sign-in"
    );
    expect(listings.asked).toEqual([]);
  });
});
