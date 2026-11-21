import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { visibleSections } from "@/app/_components/home-layout";
import { cmsDocument, cmsRevision } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { homeKind, type HomeBody } from "./kinds/home";

const global = { type: "global" } as const;

async function contentManager(h: Harness) {
  const account = await h.seed.member({ name: "Chitra Content" });
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

async function homeRevisions(h: Harness) {
  return h.db
    .select({ status: cmsRevision.status, body: cmsRevision.body })
    .from(cmsRevision)
    .innerJoin(cmsDocument, eq(cmsDocument.id, cmsRevision.documentId))
    .where(eq(cmsDocument.key, "home"));
}

function editedHome(change: (body: HomeBody) => void): HomeBody {
  const body = homeKind.seedBody();
  change(body);
  return body;
}

describe("the home page document", () => {
  it("publishes a new hero heading with a section hidden", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const body = editedHome((b) => {
      b.hero.heading = "Kindness starts on your street";
      b.sections = b.sections.map((s) =>
        s.key === "seasonal" ? { ...s, visible: false } : s
      );
    });

    const saved = await h.as(actor).saveDraft({ key: "home", body });
    if (!saved.ok) throw new Error(saved.issues.join("; "));
    const published = await h
      .as(actor)
      .publishRevision({ revisionId: saved.revisionId });

    expect(published).toMatchObject({ ok: true, version: 1 });
    const read = await h.as(h.visitor()).getPublishedDocument({ key: "home" });
    expect(read?.version).toBe(1);
    const home = homeKind.sanitize(read?.body);
    expect(home.hero.heading).toBe("Kindness starts on your street");
    expect(visibleSections(home)).not.toContain("seasonal");
    expect(visibleSections(home)).not.toContain("events");
  });

  it("stores hero and button text without markup", async () => {
    const h = await createHarness();
    const actor = await contentManager(h);
    const body = editedHome((b) => {
      b.hero.heading = "Kind <script>alert(1)</script>streets";
      b.hero.primaryCta.label = '<img src=x onerror="alert(1)">Enter';
    });

    const saved = await h.as(actor).saveDraft({ key: "home", body });

    expect(saved.ok).toBe(true);
    const [row] = await homeRevisions(h);
    expect(JSON.stringify(row?.body)).not.toMatch(/script|onerror|<img/);
    expect(row?.body).toMatchObject({
      hero: { heading: "Kind streets", primaryCta: { label: "Enter" } },
    });
  });

  it.each([
    [
      "an unknown section",
      (b: HomeBody) =>
        void (b.sections as unknown[]).push({ key: "raffle", visible: true }),
    ],
    [
      "a section listed twice",
      (b: HomeBody) => void b.sections.push({ key: "joy", visible: false }),
    ],
    [
      "a missing section",
      (b: HomeBody) => void (b.sections = b.sections.slice(1)),
    ],
    [
      "three counters",
      (b: HomeBody) =>
        void ((b as { counterKeys: unknown }).counterKeys = b.counterKeys.slice(
          0,
          3
        )),
    ],
    [
      "a repeated counter",
      (b: HomeBody) =>
        void (b.counterKeys = [
          "participants",
          "participants",
          "institutions",
          "competitions",
        ]),
    ],
    [
      "a button to another site",
      (b: HomeBody) => void (b.hero.primaryCta.href = "https://example.com"),
    ],
    [
      "a picture that is not a site image",
      (b: HomeBody) =>
        void ((b.hero as { imageAssetId: string }).imageAssetId = "cat.jpg"),
    ],
  ])("refuses %s and saves nothing", async (_, change) => {
    const h = await createHarness();
    const actor = await contentManager(h);

    const saved = await h
      .as(actor)
      .saveDraft({ key: "home", body: editedHome(change) });

    expect(saved).toMatchObject({ ok: false, error: "invalid_body" });
    expect(saved.ok || saved.issues.length).toBeGreaterThan(0);
    expect(await homeRevisions(h)).toEqual([]);
  });

  it("lets only a content manager save it", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    await expect(
      h.as(member).saveDraft({ key: "home", body: homeKind.seedBody() })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await homeRevisions(h)).toEqual([]);
  });

  it("is seeded once as version 1 with today's home page", async () => {
    const h = await createHarness();

    await h.seed.preview();
    await h.seed.preview();

    expect(await homeRevisions(h)).toEqual([
      { status: "published", body: homeKind.seedBody() },
    ]);
  });
});
