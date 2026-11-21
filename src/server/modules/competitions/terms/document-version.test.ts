import { describe, expect, it } from "vitest";

import { createHarness } from "@/test/harness";

import { publishDocument } from "./testing";

describe("getCompetitionDocumentVersion", () => {
  it("shows anyone the exact text of an older version after a newer one is published", async () => {
    const h = await createHarness();
    const v1 = await publishDocument(h, "competition_terms", "the first text");
    await publishDocument(h, "competition_terms", "the second text");

    const read = await h
      .as(h.visitor())
      .getCompetitionDocumentVersion({ purpose: "competition_terms", version: 1 });

    expect(read).toMatchObject({
      id: v1.id,
      purpose: "competition_terms",
      version: 1,
      title: "Draft competition_terms",
      publishedAt: h.clock.now(),
    });
    expect(JSON.stringify(read?.body)).toContain("the first text");
    expect(JSON.stringify(read?.body)).not.toContain("the second text");
  });

  it("is null for a version not published yet", async () => {
    const h = await createHarness();
    await publishDocument(h, "privacy_notice");

    expect(
      await h
        .as(h.visitor())
        .getCompetitionDocumentVersion({ purpose: "privacy_notice", version: 2 })
    ).toBeNull();
  });

  it("is null for a purpose a competition can't attach", async () => {
    const h = await createHarness();
    await publishDocument(h, "messages");

    expect(
      await h
        .as(h.visitor())
        .getCompetitionDocumentVersion({ purpose: "messages", version: 1 })
    ).toBeNull();
  });
});
