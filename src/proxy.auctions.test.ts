import { getRewrittenUrl } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { createProxy } from "@/request-proxy";
const request = (code: string) =>
  new NextRequest(`https://foa.example.test/auctions/${code}`);
describe("proxy: auction lots", () => {
  it("rechecks visibility on every request, never queries invalid codes, and fails closed", async () => {
    let publicLot = true;
    const lookup = vi.fn(async () => publicLot);
    const proxy = createProxy({
      isPublishedCompetitionSlug: async () => false,
      isPublicPostSlug: async () => false,
      isPublicAuctionLot: lookup,
    });
    const code = "LOT-27-5EED1";
    expect(getRewrittenUrl(await proxy(request(code)))).toBeNull();
    publicLot = false;
    expect(getRewrittenUrl(await proxy(request(code)))).toBe(
      "https://foa.example.test/__not-found"
    );
    expect(getRewrittenUrl(await proxy(request("bad")))).toBe(
      "https://foa.example.test/__not-found"
    );
    expect(lookup.mock.calls).toHaveLength(2);
    vi.spyOn(console, "error").mockImplementation(() => {});
    lookup.mockRejectedValueOnce(new Error("unavailable"));
    expect(getRewrittenUrl(await proxy(request(code)))).toBe(
      "https://foa.example.test/__not-found"
    );
  });
});
