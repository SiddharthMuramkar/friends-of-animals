import { getRewrittenUrl } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProxy } from "@/request-proxy";

/**
 * The proxy over a stand-in for the adoptable animals' slugs (the
 * adoption module through a memo, src/app/adopt/_lib/public-slugs.ts).
 */
function proxyOverAnimals() {
  const animals = {
    public: new Set(["bruno-dog-pune"]),
    fail: false,
    asked: [] as string[],
  };
  const proxy = createProxy({
    isPublishedCompetitionSlug: async () => false,
    isPublicPostSlug: async () => false,
    isAdoptableSlug: async (slug) => {
      animals.asked.push(slug);
      if (animals.fail) throw new Error("database unavailable");
      return animals.public.has(slug);
    },
  });
  return { animals, proxy };
}

const request = (path: string) =>
  new NextRequest(`https://foa.example.test${path}`);
const MISSING = "https://foa.example.test/__not-found";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("proxy: adoptable animals", () => {
  it("lets an animal with a public page through", async () => {
    const { animals, proxy } = proxyOverAnimals();
    expect(
      getRewrittenUrl(await proxy(request("/adopt/bruno-dog-pune")))
    ).toBeNull();
    expect(animals.asked).toEqual(["bruno-dog-pune"]);
  });

  it("answers a draft, withdrawn or hidden animal with the 404", async () => {
    const { proxy } = proxyOverAnimals();
    expect(getRewrittenUrl(await proxy(request("/adopt/kalu-dog-pune")))).toBe(
      MISSING
    );
  });

  it("answers a slug no animal could have with the 404 without asking", async () => {
    const { animals, proxy } = proxyOverAnimals();
    for (const path of ["/adopt/Bruno", "/adopt/a%20b", "/adopt/ab"]) {
      expect(getRewrittenUrl(await proxy(request(path))), path).toBe(MISSING);
    }
    expect(animals.asked).toEqual([]);
  });

  it("lets the request through when the database can't answer", async () => {
    const { animals, proxy } = proxyOverAnimals();
    animals.fail = true;
    expect(
      getRewrittenUrl(await proxy(request("/adopt/bruno-dog-pune")))
    ).toBeNull();
  });
});
