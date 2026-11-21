import { describe, expect, it, vi } from "vitest";

import { renderHtml, visibleText } from "@/test/render";

import { SmsOffCallout } from "./sms-off-callout";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

describe("<SmsOffCallout>", () => {
  it("says codes come by email and links to email sign-in", async () => {
    const html = await renderHtml(<SmsOffCallout intent="sign-in" />);

    expect(visibleText(html)).toContain(
      "We can't text sign-in codes yet, so codes come by email for now."
    );
    expect(html).toMatch(
      /<a [^>]*href="\/sign-in"[^>]*>Sign in with your email<\/a>/
    );
  });

  it("links a sign-up to email sign-up", async () => {
    const html = await renderHtml(<SmsOffCallout intent="sign-up" />);

    expect(html).toMatch(
      /<a [^>]*href="\/sign-up"[^>]*>Create an account with your email<\/a>/
    );
  });

  it("shows its meaning with an icon and a word, not colour alone", async () => {
    const html = await renderHtml(<SmsOffCallout intent="sign-in" />);

    expect(html).toMatch(/<aside[^>]*>\s*<p[^>]*><svg[^>]*aria-hidden="true"/);
    expect(html).toContain("<span>Note</span>");
  });
});
