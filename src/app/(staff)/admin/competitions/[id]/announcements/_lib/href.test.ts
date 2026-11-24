import { describe, expect, it } from "vitest";

import {
  announcementHref,
  announcementsHref,
  newAnnouncementHref,
  readOutcome,
} from "./href";

const COMPETITION = "01938a00-0000-7000-8000-000000002101";
const ANNOUNCEMENT = "01938a00-0000-7000-8000-000000008402";

describe("announcement links", () => {
  it("names the list, the composer and one announcement", () => {
    expect(announcementsHref(COMPETITION)).toBe(
      `/admin/competitions/${COMPETITION}/announcements`
    );
    expect(newAnnouncementHref(COMPETITION)).toBe(
      `/admin/competitions/${COMPETITION}/announcements/new`
    );
    expect(announcementHref(COMPETITION, ANNOUNCEMENT)).toBe(
      `/admin/competitions/${COMPETITION}/announcements/${ANNOUNCEMENT}`
    );
  });

  it("carries an outcome there and reads it back", () => {
    const href = announcementHref(
      COMPETITION,
      ANNOUNCEMENT,
      { done: "sent" },
      42
    );
    const params = Object.fromEntries(new URL(href, "https://x").searchParams);

    expect(readOutcome(params)).toEqual({ done: "sent", at: "42" });
    expect(readOutcome({ refused: "announcement_already_sent" })).toEqual({
      refused: "announcement_already_sent",
      at: "",
    });
    expect(readOutcome({ done: "<script>" })).toBeNull();
  });
});
