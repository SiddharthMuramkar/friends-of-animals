import { getRewrittenUrl } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { createProxy } from "@/request-proxy";

it("checks a public event slug per request, refuses unknown and malformed slugs, and fails closed", async () => {
  let visible = true;
  const lookup = vi.fn(async () => visible);
  const proxy = createProxy({
    isPublishedCompetitionSlug: async () => false,
    isPublicPostSlug: async () => false,
    isPublicEventSlug: lookup,
  });
  const go = async (raw: string) =>
    getRewrittenUrl(
      await proxy(new NextRequest(`https://foa.example.test/events/${raw}`))
    );
  expect(await go("summer-campaign")).toBeNull();
  visible = false;
  expect(await go("summer-campaign")).toBe(
    "https://foa.example.test/__not-found"
  );
  expect(await go("Summer%20campaign")).toBe(
    "https://foa.example.test/__not-found"
  );
  expect(lookup).toHaveBeenCalledTimes(2);
  vi.spyOn(console, "error").mockImplementation(() => {});
  lookup.mockRejectedValueOnce(new Error("unavailable"));
  expect(await go("summer-campaign")).toBe(
    "https://foa.example.test/__not-found"
  );
});
