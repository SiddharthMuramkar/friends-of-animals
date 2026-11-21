import { getRewrittenUrl } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lookup = vi.hoisted(() => ({
  published: new Set<string>(),
  fail: false,
  asked: [] as string[],
}));

// The database behind the proxy's check: published slugs, or a failure.
vi.mock("@/app/competitions/_lib/public-reader", () => ({
  publishedSlugLookup: async (slug: string) => {
    lookup.asked.push(slug);
    if (lookup.fail) throw new Error("database unavailable");
    return lookup.published.has(slug);
  },
}));

const { proxy } = await import("./proxy");

const request = (path: string) =>
  new NextRequest(`https://foa.example.test${path}`);
const MISSING = "https://foa.example.test/__not-found";

beforeEach(() => {
  lookup.published = new Set(["fresh-from-the-database"]);
  lookup.fail = false;
  lookup.asked = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("proxy: competition pages", () => {
  it("lets a competition published in the database through", async () => {
    const response = await proxy(
      request("/competitions/fresh-from-the-database")
    );
    expect(getRewrittenUrl(response)).toBeNull();
    expect(lookup.asked).toEqual(["fresh-from-the-database"]);
  });

  it("answers an unknown or draft slug with the 404", async () => {
    for (const path of [
      "/competitions/no-such-competition",
      "/competitions/a-draft",
    ]) {
      expect(getRewrittenUrl(await proxy(request(path))), path).toBe(MISSING);
    }
  });

  it("no longer knows the sample competitions", async () => {
    const response = await proxy(
      request("/competitions/neighbours-on-my-street")
    );
    expect(getRewrittenUrl(response)).toBe(MISSING);
  });

  it("answers the build's placeholder and malformed slugs with the 404 without asking", async () => {
    for (const path of [
      "/competitions/__placeholder__",
      "/competitions/%E0%A4%A",
    ]) {
      expect(getRewrittenUrl(await proxy(request(path))), path).toBe(MISSING);
    }
    expect(lookup.asked).toEqual([]);
  });

  it("lets the request through when the database can't answer, and logs it", async () => {
    lookup.fail = true;
    const response = await proxy(
      request("/competitions/fresh-from-the-database")
    );
    expect(getRewrittenUrl(response)).toBeNull();
    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "fresh-from-the-database"
    );
  });
});
