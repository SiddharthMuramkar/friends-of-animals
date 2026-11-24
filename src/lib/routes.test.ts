import { describe, expect, it } from "vitest";

import nav from "../../messages/en-IN/nav.json";
import {
  FOOTER_GROUPS,
  footerRoutes,
  PRIMARY_NAV,
  ROUTES,
  sitemapRoutes,
} from "./routes";

const all = Object.values(ROUTES);

describe("ROUTES", () => {
  it("has unique paths", () => {
    const paths = all.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("gives every route a nav label in messages", () => {
    for (const route of all) {
      expect(nav.nav.links, route.id).toHaveProperty(route.id);
    }
  });

  it("never links modules that are not built yet", () => {
    const unbuilt = [
      "/gallery",
      "/transparency",
      "/login",
      "/events",
      "/volunteer",
      "/ngos",
      "/auctions",
    ];
    for (const route of all) {
      expect(unbuilt).not.toContain(route.path);
    }
  });
});

describe("navigation groups", () => {
  it("puts the main sections in the header", () => {
    expect(PRIMARY_NAV.map((r) => r.path)).toEqual([
      "/competitions",
      "/schools",
      "/awareness",
      "/blog",
      "/about",
    ]);
  });

  it("links what Razorpay requires from the footer", () => {
    const linked = FOOTER_GROUPS.flatMap((g) => footerRoutes(g)).map(
      (r) => r.path
    );
    for (const path of [
      "/about",
      "/contact",
      "/pricing",
      "/terms",
      "/privacy",
      "/refunds",
    ]) {
      expect(linked).toContain(path);
    }
  });

  it("keeps dynamic and test-only routes out of the footer", () => {
    const linked = FOOTER_GROUPS.flatMap((g) => footerRoutes(g)).map(
      (r) => r.path
    );
    expect(linked.some((p) => p.includes("["))).toBe(false);
    expect(linked).not.toContain("/styleguide");
  });
});

describe("sitemapRoutes()", () => {
  it("lists static public pages with fixed dates", () => {
    const routes = sitemapRoutes();
    expect(routes.map((r) => r.path)).toContain("/");
    expect(routes.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.updated))).toBe(
      true
    );
  });

  it("leaves out dynamic patterns and the style guide", () => {
    const paths = sitemapRoutes().map((r) => r.path);
    expect(paths.some((p) => p.includes("["))).toBe(false);
    expect(paths).not.toContain("/styleguide");
  });
});
