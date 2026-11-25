import { describe, expect, it, vi } from "vitest";

import { renderHtml, visibleText } from "@/test/render";

import AdoptLayout from "@/app/adopt/layout";
import AdoptionsLayout from "@/app/organisation/[id]/adoptions/layout";
import messages from "../../../messages/en-IN/adoption.json";

import { AdoptionDisclaimer } from "./disclaimer";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

const SENTENCE = messages.adoption.disclaimer.body;

describe("the FOA-facilitates disclaimer", () => {
  it("says FOA facilitates and the listing organisation is responsible", async () => {
    const text = visibleText(await renderHtml(<AdoptionDisclaimer />));
    expect(text).toBe(SENTENCE);
    expect(SENTENCE).toMatch(/facilitates adoption/);
    expect(SENTENCE).toMatch(
      /organisation that lists an animal is responsible/
    );
  });

  it("is on every public and representative adoption page, through their layouts", async () => {
    for (const html of [
      await renderHtml(
        <AdoptLayout params={Promise.resolve({})}>
          <p>page</p>
        </AdoptLayout>
      ),
      await renderHtml(
        <AdoptionsLayout params={Promise.resolve({ id: "x" })}>
          <p>page</p>
        </AdoptionsLayout>
      ),
    ]) {
      expect(visibleText(html)).toContain(SENTENCE);
    }
  });
});
