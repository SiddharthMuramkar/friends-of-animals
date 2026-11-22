import { getRewrittenUrl } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProxy } from "@/request-proxy";

/**
 * The proxy over a stand-in for the database behind its competition
 * check: the published slugs, or a failure. Records what it was asked.
 */
function proxyOverDatabase() {
  const db = {
    published: new Set(["fresh-from-the-database"]),
    fail: false,
    asked: [] as string[],
  };
  const proxy = createProxy({
    isPublishedCompetitionSlug: async (slug) => {
      db.asked.push(slug);
      if (db.fail) throw new Error("database unavailable");
      return db.published.has(slug);
    },
    // The public posts: src/proxy.blog.test.ts covers their check.
    isPublicPostSlug: async (slug) => slug === "kinder-skies-in-kite-season",
  });
  return { db, proxy };
}

const request = (path: string) =>
  new NextRequest(`https://foa.example.test${path}`);
const MISSING = "https://foa.example.test/__not-found";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("proxy: competition pages", () => {
  it("lets a competition published in the database through", async () => {
    const { db, proxy } = proxyOverDatabase();
    const response = await proxy(
      request("/competitions/fresh-from-the-database")
    );
    expect(getRewrittenUrl(response)).toBeNull();
    expect(db.asked).toEqual(["fresh-from-the-database"]);
  });

  it("answers an unknown or draft slug with the 404", async () => {
    const { proxy } = proxyOverDatabase();
    for (const path of [
      "/competitions/no-such-competition",
      "/competitions/a-draft",
    ]) {
      expect(getRewrittenUrl(await proxy(request(path))), path).toBe(MISSING);
    }
  });

  it("no longer knows the sample competitions", async () => {
    const { proxy } = proxyOverDatabase();
    const response = await proxy(
      request("/competitions/neighbours-on-my-street")
    );
    expect(getRewrittenUrl(response)).toBe(MISSING);
  });

  it("answers the build's placeholder and malformed slugs with the 404 without asking", async () => {
    const { db, proxy } = proxyOverDatabase();
    for (const path of [
      "/competitions/__placeholder__",
      "/competitions/%E0%A4%A",
    ]) {
      expect(getRewrittenUrl(await proxy(request(path))), path).toBe(MISSING);
    }
    expect(db.asked).toEqual([]);
  });

  it("lets the request through when the database can't answer, and logs it without the slug", async () => {
    const { db, proxy } = proxyOverDatabase();
    db.fail = true;
    const response = await proxy(
      request("/competitions/fresh-from-the-database")
    );
    expect(getRewrittenUrl(response)).toBeNull();
    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "fresh-from-the-database"
    );
  });

  it("never asks the competition check about a blog story", async () => {
    const { db, proxy } = proxyOverDatabase();
    const known = await proxy(request("/blog/kinder-skies-in-kite-season"));
    const unknown = await proxy(request("/blog/no-such-story"));
    expect(getRewrittenUrl(known)).toBeNull();
    expect(getRewrittenUrl(unknown)).toBe(MISSING);
    expect(db.asked).toEqual([]);
  });
});
