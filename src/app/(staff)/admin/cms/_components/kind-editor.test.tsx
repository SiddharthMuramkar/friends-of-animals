import { afterEach, describe, expect, it, vi } from "vitest";

import { renderHtml, visibleText } from "@/test/render";

import { fieldsOf, kindForm } from "../_lib/kind-forms";
import { KindEditor } from "./kind-editor";

// The editor's words come from adminCms.json by each field's path, so a
// field without its message would show a key. Rendering every kind's form
// from its seed body checks they are all there, and that every input has
// a label.

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

afterEach(() => {
  vi.restoreAllMocks();
});

const DOCUMENTS = [
  ["home", "home"],
  ["about", "page"],
  ["impact", "impact"],
  ["site_facts", "facts"],
] as const;

describe("<KindEditor>", () => {
  it.each(DOCUMENTS)(
    "labels every field of the %s form from the messages",
    async (documentKey, kind) => {
      const missing = vi.spyOn(console, "error").mockImplementation(() => {});
      const form = kindForm(kind)!;

      const html = await renderHtml(
        await KindEditor({ documentKey, form, stored: undefined })
      );

      expect(missing).not.toHaveBeenCalled();
      expect(visibleText(html)).not.toMatch(/adminCms\./);
      const ids = [
        ...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bid="([^"]+)"/g),
      ].map((match) => match[1]);
      const labelled = new Set(
        [...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1])
      );
      expect(ids.length).toBeGreaterThanOrEqual(fieldsOf(form).length);
      expect(ids.filter((id) => !labelled.has(id))).toEqual([]);
    }
  );

  it("starts from the stored draft rather than the seed", async () => {
    const html = await renderHtml(
      await KindEditor({
        documentKey: "site_facts",
        form: kindForm("facts")!,
        stored: {
          email: "hello@friendsofanimals.example",
          phone: "",
          address: "",
          socials: [],
          grievanceOfficer: { name: "", email: "" },
        },
      })
    );

    expect(html).toContain('value="hello@friendsofanimals.example"');
  });
});
