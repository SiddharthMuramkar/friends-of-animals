import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SmsOffNotice } from "./sms-off-notice";

describe("<SmsOffNotice>", () => {
  it("says codes come by email and links to email sign-in", () => {
    const html = renderToStaticMarkup(
      <SmsOffNotice
        label="Note"
        message="We can't text sign-in codes yet: codes come by email."
        link={{ href: "/sign-in", text: "Sign in with your email" }}
      />
    );

    expect(html).toContain("Note");
    expect(html).toContain(
      "We can&#x27;t text sign-in codes yet: codes come by email."
    );
    expect(html).toMatch(
      /<a [^>]*href="\/sign-in"[^>]*>Sign in with your email<\/a>/
    );
  });

  it("shows its meaning with an icon and a word, not colour alone", () => {
    const html = renderToStaticMarkup(
      <SmsOffNotice
        label="Note"
        message="Codes come by email."
        link={{ href: "/sign-up", text: "Create an account with your email" }}
      />
    );

    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toMatch(/<span>Note<\/span>/);
  });
});
