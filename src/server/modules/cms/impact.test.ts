import { describe, expect, it } from "vitest";

import { visibleCounters } from "@/content/sample/selectors";
import { createHarness, type Harness } from "@/test/harness";

import { impactKind } from "./kinds/impact";

const global = { type: "global" } as const;

async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

describe("the impact counters document", () => {
  it("publishes new values and their date", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const body = {
      asOf: "2027-03-31",
      counters: [
        { key: "participants", value: 4219 },
        { key: "institutions", value: 7 },
      ],
    };

    const saved = await h.as(actor).saveDraft({ key: "impact", body });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    await h.as(actor).publishRevision({ revisionId: saved.revisionId });

    const read = await h
      .as(h.visitor())
      .getPublishedDocument({ key: "impact" });
    const impact = impactKind.sanitize(read?.body);
    expect(impact).toEqual(body);
    // Small counts stay hidden whatever is published.
    expect(visibleCounters(impact.counters)).toEqual([
      { key: "participants", display: "4,210+" },
    ]);
  });

  it.each([
    ["funds raised", { key: "fundsRaised", value: 100000 }, "2027-03-31"],
    ["funds", { key: "funds", value: 100000 }, "2027-03-31"],
    ["a negative value", { key: "participants", value: -5 }, "2027-03-31"],
    ["a fraction", { key: "participants", value: 10.5 }, "2027-03-31"],
    ["a bad date", { key: "participants", value: 10 }, "2027-02-30"],
  ])("refuses %s", async (_, counter, asOf) => {
    const h = await createHarness();
    const actor = await contentManager(h);

    const saved = await h
      .as(actor)
      .saveDraft({ key: "impact", body: { asOf, counters: [counter] } });

    expect(saved).toMatchObject({ ok: false, error: "invalid_body" });
    expect(await h.as(actor).listRevisions({ key: "impact" })).toMatchObject({
      revisions: [],
    });
  });
});
