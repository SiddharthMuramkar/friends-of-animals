import { describe, expect, it } from "vitest";

import { fromPublic } from "@/components/competitions/model";
import { createHarness } from "@/test/harness";

import { PUBLIC_READER } from "./public-reader";

// What the public pages read, through the real read model on the preview
// seed: three published competitions and one draft.
describe("the public pages' reader", () => {
  it("lists the published competitions as cards, never the draft or a sample", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const reader = h.as(PUBLIC_READER);

    const list = (await reader.listPublishedCompetitions()).map(fromPublic);

    expect(list.map((c) => [c.slug, c.status, c.sample])).toEqual([
      ["kinder-skies", "PUBLISHED", false],
      ["neighbours-on-my-street", "PUBLISHED", false],
      ["a-bowl-of-water", "PUBLISHED", false],
    ]);
    expect(await reader.publishedCompetitionSlugs()).not.toContain(
      "seed-drawing-competition"
    );
    expect(
      await reader.getPublishedCompetition({ slug: "seed-drawing-competition" })
    ).toBeNull();
  });

  it("gives a competition page its key dates as exact instants, entered in IST", async () => {
    const h = await createHarness();
    await h.seed.preview();

    const found = await h
      .as(PUBLIC_READER)
      .getPublishedCompetition({ slug: "neighbours-on-my-street" });
    const page = fromPublic(found!);

    // Entered as 1 November 2026, 09:00 IST.
    expect(page.keyDates[0]).toEqual({
      kind: "registrationOpens",
      at: "2026-11-01T03:30:00.000Z",
    });
    expect(page.routes.map((r) => r.route)).toEqual([
      "INSTITUTION",
      "INDIVIDUAL",
    ]);
    expect(page.disciplines).toEqual(["DRAWING", "PAINTING", "PHOTOGRAPHY"]);
    expect(page.welfareMessage).not.toBe("");
  });
});
