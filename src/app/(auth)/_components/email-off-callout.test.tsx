import { describe, expect, it, vi } from "vitest";

import { renderHtml, visibleText } from "@/test/render";

import { EmailOffCallout } from "./email-off-callout";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

describe("<EmailOffCallout>", () => {
  it("says sign-in opens soon, with no form or button to press", async () => {
    const html = await renderHtml(<EmailOffCallout intent="sign-in" />);

    expect(visibleText(html)).toContain("Sign-in opens soon.");
    expect(visibleText(html)).toContain(
      "We're finishing the last checks on how we email sign-in codes."
    );
    expect(html).not.toMatch(/<(form|button|input)\b/);
  });

  it("says the same of creating an account", async () => {
    const html = await renderHtml(<EmailOffCallout intent="sign-up" />);

    expect(visibleText(html)).toContain("Creating an account opens soon.");
    expect(html).not.toMatch(/<(form|button|input)\b/);
  });

  it("points to what is open meanwhile: the competitions and the contact page", async () => {
    const html = await renderHtml(<EmailOffCallout intent="sign-in" />);

    expect(html).toMatch(
      /<a [^>]*href="\/competitions"[^>]*>See the competitions<\/a>/
    );
    expect(html).toMatch(/<a [^>]*href="\/contact"[^>]*>Contact us<\/a>/);
  });

  it("shows its meaning with an icon and a word, not colour alone", async () => {
    const html = await renderHtml(<EmailOffCallout intent="sign-in" />);

    expect(html).toMatch(/<aside[^>]*>\s*<p[^>]*><svg[^>]*aria-hidden="true"/);
    expect(html).toContain("<span>Note</span>");
  });
});
