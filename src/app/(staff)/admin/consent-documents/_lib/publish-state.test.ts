import { describe, expect, it } from "vitest";

import { afterPreview, afterPublishRefused } from "./publish-state";

const entered = { title: "Privacy policy", source: "## Who we are\n\nUs." };
const body = {
  short: [],
  sections: [
    { id: "who-we-are", title: "Who we are", blocks: [{ p: ["Us."] }] },
  ],
};

describe("afterPreview", () => {
  it("shows the body the source would publish, keeping what was typed", () => {
    expect(afterPreview({ ok: true, body }, entered)).toEqual({
      ...entered,
      preview: body,
    });
  });

  it("lists the source's errors instead", () => {
    const errors = [{ line: 3, code: "unknown_fact" }] as const;
    expect(
      afterPreview(
        { ok: false, error: "invalid_source", errors: [...errors] },
        entered
      )
    ).toEqual({ ...entered, sourceErrors: errors });
  });

  it("says the privacy policy and the terms are published from Site content", () => {
    expect(
      afterPreview({ ok: false, error: "published_by_cms" }, entered)
    ).toEqual({ ...entered, alert: "publishedByCms" });
  });
});

describe("afterPublishRefused", () => {
  it("marks an empty title", () => {
    expect(
      afterPublishRefused(
        { ok: false, error: "invalid_input", fields: ["title"] },
        entered
      )
    ).toEqual({ ...entered, titleError: true });
  });

  it("lists the source's errors", () => {
    const errors = [{ line: null, code: "no_sections" }] as const;
    expect(
      afterPublishRefused(
        { ok: false, error: "invalid_source", errors: [...errors] },
        entered
      )
    ).toEqual({ ...entered, sourceErrors: errors });
  });

  it("says the privacy policy and the terms are published from Site content", () => {
    expect(
      afterPublishRefused({ ok: false, error: "published_by_cms" }, entered)
    ).toEqual({ ...entered, alert: "publishedByCms" });
  });

  it("says it failed for anything else the form can't point at", () => {
    expect(
      afterPublishRefused(
        { ok: false, error: "invalid_input", fields: ["source"] },
        entered
      )
    ).toEqual({ ...entered, alert: "failed" });
  });
});
