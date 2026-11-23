// The post editor's save step (#112) at Seam 1, through the real use cases.
// A Server Action can be called by anyone signed in, whatever the page
// showed, so the step asks whether the actor may write posts before it
// reads the body's markup: someone else's form is refused, never parsed.

import { count } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { cmsPost } from "@/server/db/schema";
import { createHarness, type Harness } from "@/test/harness";

import { emptyPostForm } from "./post-form";
import { savePostStep } from "./save-steps";

const global = { type: "global" } as const;

function form(source: string, slug = "kinder-skies"): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    kind: "blog",
    title: "Kinder skies",
    slug,
    excerpt: "Birds first.",
    audience: "everyone",
    source,
  })) {
    data.set(name, value);
  }
  return data;
}

async function contentManager(h: Harness) {
  const account = await h.seed.member();
  await h.seed.grant(account, { role: "content_manager", scope: global });
  return h.signIn(account);
}

async function posts(h: Harness) {
  const [row] = await h.db.select({ n: count() }).from(cmsPost);
  return row?.n;
}

describe("savePostStep", () => {
  it("refuses a member before it reads the markup", async () => {
    const h = await createHarness();
    const member = await h.signIn(await h.seed.member());

    // Broken markup would come back as line errors if it were read first.
    await expect(
      savePostStep(h.as(member), { formData: form("**unclosed") })
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await posts(h)).toBe(0);
  });

  it("refuses a member's update before it reads the markup", async () => {
    const h = await createHarness();
    const editor = await contentManager(h);
    const created = await savePostStep(h.as(editor), {
      formData: form("Birds first."),
    });
    if (!created.ok) throw new Error("not created");
    const member = await h.signIn(await h.seed.member());

    await expect(
      savePostStep(h.as(member), {
        postId: created.postId,
        formData: form("**unclosed"),
      })
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("asks a content manager for their second factor before it reads the markup", async () => {
    const h = await createHarness();
    const account = await h.seed.member();
    await h.seed.grant(account, { role: "content_manager", scope: global });
    await h.seed.authenticator(account);
    const actor = await h.signIn(account, undefined, { secondFactor: false });

    await expect(
      savePostStep(h.as(actor), { formData: form("**unclosed") })
    ).rejects.toMatchObject({ code: "second_factor_required" });
  });

  it("shows a content manager the markup's errors by line, and saves nothing", async () => {
    const h = await createHarness();
    const editor = await contentManager(h);

    expect(
      await savePostStep(h.as(editor), {
        formData: form("Fine.\n\n**unclosed"),
        previous: null,
      })
    ).toMatchObject({
      ok: false,
      state: {
        attempt: 1,
        values: { title: "Kinder skies", source: "Fine.\n\n**unclosed" },
        sourceErrors: [{ line: 3, code: "unclosed_strong" }],
      },
    });
    expect(await posts(h)).toBe(0);
  });

  it("saves a content manager's draft, then their changes", async () => {
    const h = await createHarness();
    const editor = await contentManager(h);

    const created = await savePostStep(h.as(editor), {
      formData: form("Birds first."),
    });
    expect(created).toEqual({ ok: true, postId: expect.any(String), tags: [] });
    if (!created.ok) return;

    expect(
      await savePostStep(h.as(editor), {
        postId: created.postId,
        formData: form("Birds first, always."),
      })
    ).toEqual({ ok: true, postId: created.postId, tags: expect.any(Array) });
    expect(await posts(h)).toBe(1);
  });

  it("shows a refusal by field, counting the attempts", async () => {
    const h = await createHarness();
    const editor = await contentManager(h);
    await savePostStep(h.as(editor), { formData: form("Birds first.") });

    expect(
      await savePostStep(h.as(editor), {
        formData: form("Birds again.", "kinder-skies"),
        previous: {
          attempt: 2,
          values: emptyPostForm(),
          errors: {},
          sourceErrors: [],
        },
      })
    ).toMatchObject({
      ok: false,
      state: { attempt: 3, errors: { slug: "taken" } },
    });
  });
});
