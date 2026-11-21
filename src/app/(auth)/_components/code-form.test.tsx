import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { START_VIEW } from "../_lib/code-form-state";
import { CodeForm, type CodeFormLabels } from "./code-form";

const phoneLabels: CodeFormLabels = {
  name: { label: "Your name", hint: "The name your account shows." },
  contact: { label: "Mobile number", hint: "We'll text a 6-digit code." },
  code: { label: "6-digit code" },
  sendCode: "Text me a code",
  sending: "Sending…",
  verify: "Create account",
  checking: "Checking…",
  resend: "Send a new code",
  changeContact: "Use a different number",
  signUpInstead: "Create an account instead",
  useEmail: "Use your email instead",
  problem: "Important",
  done: "Done",
};

const emailLabels: CodeFormLabels = {
  ...phoneLabels,
  contact: { label: "Email address", hint: "We'll email a 6-digit code." },
  sendCode: "Email me a code",
  changeContact: "Use a different email",
  useEmail: undefined,
};

const noop = async () => START_VIEW;

describe("<CodeForm> by phone", () => {
  it("asks a sign-up for a name and a mobile number first", () => {
    const html = renderToStaticMarkup(
      <CodeForm
        action={noop}
        channel="phone"
        intent="sign-up"
        labels={phoneLabels}
        signUpPath="/sign-up/phone"
        emailPath="/sign-up"
      />
    );

    expect(html).toMatch(/<input[^>]* id="name"[^>]* name="name"/);
    expect(html).toMatch(/<input[^>]* id="phone"[^>]* name="phone"/);
    expect(html).toMatch(/<input[^>]* type="tel"/);
    expect(html).toMatch(/<input[^>]* autoComplete="tel"/i);
    expect(html).toContain("Mobile number");
    expect(html).toContain("Text me a code");
    expect(html).not.toContain('id="code"');
  });

  it("asks only for the number to sign in", () => {
    const html = renderToStaticMarkup(
      <CodeForm
        action={noop}
        channel="phone"
        intent="sign-in"
        labels={{ ...phoneLabels, verify: "Sign in" }}
        signUpPath="/sign-up/phone"
        emailPath="/sign-in"
      />
    );

    expect(html).not.toContain('id="name"');
    expect(html).toMatch(/<input[^>]* id="phone"/);
  });
});

describe("<CodeForm> by email", () => {
  it("asks a sign-up for a name and an email address first", () => {
    const html = renderToStaticMarkup(
      <CodeForm
        action={noop}
        channel="email"
        intent="sign-up"
        labels={emailLabels}
        signUpPath="/sign-up"
      />
    );

    expect(html).toMatch(/<input[^>]* id="name"[^>]* name="name"/);
    expect(html).toMatch(/<input[^>]* id="email"[^>]* name="email"/);
    expect(html).toMatch(/<input[^>]* type="email"/);
    expect(html).toMatch(/<input[^>]* autoComplete="email"/i);
    expect(html).toContain("Email address");
    expect(html).toContain("Email me a code");
    expect(html).not.toContain('id="code"');
  });

  it("asks only for the address to sign in", () => {
    const html = renderToStaticMarkup(
      <CodeForm
        action={noop}
        channel="email"
        intent="sign-in"
        labels={{ ...emailLabels, verify: "Sign in" }}
        signUpPath="/sign-up"
      />
    );

    expect(html).not.toContain('id="name"');
    expect(html).toMatch(/<input[^>]* id="email"/);
  });
});
