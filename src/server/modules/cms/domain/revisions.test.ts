import { describe, expect, it } from "vitest";

import {
  CMS_REVISION_STATUSES,
  type CmsRevisionStatus,
  canEditRevision,
  canMoveRevision,
  decidePublish,
  decideSaveDraft,
} from "./revisions";

const ALL: (CmsRevisionStatus | null)[] = [null, ...CMS_REVISION_STATUSES];

describe("canMoveRevision", () => {
  const allowed = new Set([
    "null>draft",
    "draft>published",
    "published>superseded",
  ]);

  it.each(
    ALL.flatMap((from) =>
      CMS_REVISION_STATUSES.map((to) => [from, to] as const)
    )
  )("%s -> %s", (from, to) => {
    expect(canMoveRevision(from, to)).toBe(allowed.has(`${from}>${to}`));
  });
});

describe("canEditRevision", () => {
  it("allows edits to a draft only", () => {
    expect(canEditRevision("draft")).toBe(true);
    expect(canEditRevision("published")).toBe(false);
    expect(canEditRevision("superseded")).toBe(false);
  });
});

describe("decideSaveDraft", () => {
  it("starts a draft when the document has none open", () => {
    expect(decideSaveDraft(null)).toEqual({ action: "create" });
  });

  it("updates the one open draft in place", () => {
    expect(
      decideSaveDraft({ id: "r2", status: "draft", version: null })
    ).toEqual({ action: "update", revisionId: "r2" });
  });

  it("refuses a revision that is not a draft as the open one", () => {
    expect(() =>
      decideSaveDraft({ id: "r1", status: "published", version: 1 })
    ).toThrow(/not a draft/);
  });
});

describe("decidePublish", () => {
  const draft = { id: "r3", status: "draft", version: null } as const;

  it("publishes the first draft as version 1", () => {
    expect(
      decidePublish({ target: draft, published: null, maxVersion: 0 })
    ).toEqual({ ok: true, version: 1, supersede: null });
  });

  it("numbers the next version and supersedes the published one", () => {
    expect(
      decidePublish({
        target: draft,
        published: { id: "r2", status: "published", version: 2 },
        maxVersion: 2,
      })
    ).toEqual({ ok: true, version: 3, supersede: "r2" });
  });

  it("never reuses a number, even if the published one is older", () => {
    expect(
      decidePublish({
        target: draft,
        published: { id: "r1", status: "published", version: 1 },
        maxVersion: 4,
      })
    ).toMatchObject({ version: 5 });
  });

  it.each(["published", "superseded"] as const)(
    "refuses to publish a %s revision",
    (status) => {
      expect(
        decidePublish({
          target: { id: "r1", status, version: 1 },
          published: null,
          maxVersion: 1,
        })
      ).toEqual({ ok: false, code: "not_draft" });
    }
  );
});
