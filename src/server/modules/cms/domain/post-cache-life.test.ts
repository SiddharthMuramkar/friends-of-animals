import { describe, expect, it } from "vitest";

import { postsCacheLife } from "./post-cache-life";

const NOW = new Date("2027-01-15T04:30:00.000Z");
const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1000);

describe("postsCacheLife", () => {
  it("keeps a read for an hour while no scheduled post is due", () => {
    expect(postsCacheLife(null, NOW)).toEqual({
      stale: 300,
      revalidate: 3600,
      expire: 86_400,
    });
    expect(postsCacheLife(later(5 * 3600), NOW).revalidate).toBe(3600);
  });

  it("refreshes a read at the next scheduled post's instant", () => {
    expect(postsCacheLife(later(600), NOW)).toEqual({
      stale: 300,
      revalidate: 600,
      expire: 86_400,
    });
    // Rounded up, so the refresh never comes before the instant.
    expect(postsCacheLife(later(600.2), NOW).revalidate).toBe(601);
  });

  it("checks no more than once a minute", () => {
    expect(postsCacheLife(later(10), NOW).revalidate).toBe(60);
    expect(postsCacheLife(later(-30), NOW).revalidate).toBe(60);
  });
});
