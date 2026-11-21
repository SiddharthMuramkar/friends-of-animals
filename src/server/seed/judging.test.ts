import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { competition, rubric, rubricCriterion } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { SEED_COMPETITION_MANAGER } from "./index";

async function competitionId(h: Harness, code: string): Promise<string> {
  const rows = await h.db
    .select({ id: competition.id, code: competition.code })
    .from(competition);
  const found = rows.find((row) => row.code === code);
  if (!found) throw new Error(`No seeded competition ${code}`);
  return found.id;
}

async function counts(h: Harness) {
  const [rubrics] = await h.db.select({ n: count() }).from(rubric);
  const [criteria] = await h.db.select({ n: count() }).from(rubricCriterion);
  return { rubrics: rubrics?.n, criteria: criteria?.n };
}

describe("the judging seed", () => {
  it("gives the preview's competitions rubrics in every state", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const manager = await h.signIn(SEED_COMPETITION_MANAGER);
    const app = h.as(manager);

    // Every discipline published: school judging can start on time.
    const neighbours = await app.listRubrics({
      competitionId: await competitionId(h, "NEIGH27"),
    });
    expect(neighbours).toMatchObject({
      ok: true,
      disciplines: [
        { discipline: "drawing", published: { version: 1 }, draft: null },
        { discipline: "painting", published: { version: 1 }, draft: null },
        { discipline: "photography", published: { version: 1 }, draft: null },
      ],
    });

    // Essay is only a draft: the school-judging flip would be blocked.
    const water = await app.listRubrics({
      competitionId: await competitionId(h, "WATER27"),
    });
    expect(water).toMatchObject({
      ok: true,
      disciplines: [
        { discipline: "drawing", published: { version: 1 }, draft: null },
        { discipline: "essay", published: null, draft: { version: 1 } },
      ],
    });

    // Drawing has been revised twice: v1 replaced, v2 in force, v3 a draft.
    const skies = await app.getDisciplineRubrics({
      competitionId: await competitionId(h, "SKIES26"),
      discipline: "drawing",
    });
    expect(skies).toMatchObject({ ok: true });
    if (!skies.ok) return;
    expect(
      skies.rubrics.map(({ version, status }) => ({ version, status }))
    ).toEqual([
      { version: 3, status: "draft" },
      { version: 2, status: "published" },
      { version: 1, status: "superseded" },
    ]);
    for (const version of skies.rubrics) {
      expect(version.criteria.length).toBeGreaterThan(0);
    }
  });

  it("changes nothing when it runs again", async () => {
    const h = await createHarness();
    await h.seed.preview();
    const first = await counts(h);

    await h.seed.preview();

    expect(await counts(h)).toEqual(first);
    expect(first.rubrics).toBeGreaterThan(0);
  });
});
