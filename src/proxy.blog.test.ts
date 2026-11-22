import { getRewrittenUrl } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProxy } from "@/request-proxy";

/**
 * The proxy over a stand-in for the public post slugs (the CMS through a
 * memo, src/app/blog/_lib/slug-lookup.ts): the public slugs, or a
 * failure. Records what each lookup was asked.
 */
function proxyOverPosts() {
  const posts = {
    public: new Set(["kite-season", "kinder-skies-in-kite-season"]),
    fail: false,
    asked: [] as string[],
  };
  const competitionsAsked: string[] = [];
  const proxy = createProxy({
    isPublishedCompetitionSlug: async (slug) => {
      competitionsAsked.push(slug);
      return false;
    },
    isPublicPostSlug: async (slug) => {
      posts.asked.push(slug);
      if (posts.fail) throw new Error("database unavailable");
      return posts.public.has(slug);
    },
  });
  return { posts, competitionsAsked, proxy };
}

const request = (path: string) =>
  new NextRequest(`https://foa.example.test${path}`);
const MISSING = "https://foa.example.test/__not-found";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("proxy: blog posts", () => {
  it("lets a public post through", async () => {
    const { posts, proxy } = proxyOverPosts();
    const response = await proxy(request("/blog/kite-season"));
    expect(getRewrittenUrl(response)).toBeNull();
    expect(posts.asked).toEqual(["kite-season"]);
  });

  it("answers an unknown, draft or archived slug with the 404", async () => {
    const { proxy } = proxyOverPosts();
    for (const path of [
      "/blog/no-such-post",
      "/blog/a-draft",
      "/blog/an-archived-post",
    ]) {
      expect(getRewrittenUrl(await proxy(request(path))), path).toBe(MISSING);
    }
  });

  it("answers a slug no post could have with the 404 without asking", async () => {
    const { posts, proxy } = proxyOverPosts();
    for (const path of ["/blog/%E0%A4%A", "/blog/Kite-Season", "/blog/ab"]) {
      expect(getRewrittenUrl(await proxy(request(path))), path).toBe(MISSING);
    }
    expect(posts.asked).toEqual([]);
  });

  it("lets the request through when the database can't answer, and logs it without the slug", async () => {
    const { posts, proxy } = proxyOverPosts();
    posts.fail = true;
    const response = await proxy(request("/blog/kite-season"));
    expect(getRewrittenUrl(response)).toBeNull();
    expect(console.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "kite-season"
    );
  });

  it("never asks the competitions about a post", async () => {
    const { competitionsAsked, proxy } = proxyOverPosts();
    await proxy(request("/blog/kite-season"));
    await proxy(request("/blog/no-such-post"));
    expect(competitionsAsked).toEqual([]);
  });
});
