import { describe, expect, it } from "vitest";

import { SAMPLE_COMPETITIONS } from "@/content/sample";
import { homeKind } from "@/server/modules/cms/kinds/home";

import {
  activeAnnouncement,
  type HomeLayout,
  openAnnouncement,
  visibleSections,
} from "./home-layout";

const HOME_LAYOUT = homeKind.seedBody();

const base: HomeLayout = {
  ...HOME_LAYOUT,
  sections: [
    { key: "competitions", visible: true },
    { key: "gallery", visible: false },
    { key: "stories", visible: true },
  ],
};

describe("visibleSections", () => {
  it("keeps the configured order and drops hidden sections", () => {
    expect(visibleSections(base)).toEqual(["competitions", "stories"]);
  });

  it("puts the shipped sections in home page order", () => {
    const keys = visibleSections(HOME_LAYOUT);
    const at = (k: string) => keys.indexOf(k as never);
    expect(at("competitions")).toBeLessThan(at("gallery"));
    expect(at("gallery")).toBeLessThan(at("impact"));
    expect(at("impact")).toBeLessThan(at("stories"));
    expect(at("stories")).toBeLessThan(at("donate"));
    expect(keys).not.toContain("events");
  });
});

describe("openAnnouncement", () => {
  it("announces the open competition that closes soonest", () => {
    const a = openAnnouncement(SAMPLE_COMPETITIONS);
    expect(a?.slug).toBe("neighbours-on-my-street");
    expect(a?.expiresAt).toBe("2027-01-15T23:59:00+05:30");
  });

  it("is null when nothing is open", () => {
    expect(openAnnouncement([])).toBeNull();
    expect(
      openAnnouncement(
        SAMPLE_COMPETITIONS.filter((c) => c.status !== "REGISTRATION_OPEN")
      )
    ).toBeNull();
  });
});

describe("activeAnnouncement", () => {
  const a = { name: "X", slug: "x", expiresAt: "2027-01-15T23:59:00+05:30" };

  it("shows before expiry", () => {
    expect(activeAnnouncement(a, Date.parse("2026-11-18T00:00:00Z"))).toBe(a);
  });

  it("hides at and after expiry", () => {
    expect(activeAnnouncement(a, Date.parse(a.expiresAt))).toBeNull();
    expect(
      activeAnnouncement(a, Date.parse("2027-02-01T00:00:00Z"))
    ).toBeNull();
    expect(activeAnnouncement(null, 0)).toBeNull();
  });
});
