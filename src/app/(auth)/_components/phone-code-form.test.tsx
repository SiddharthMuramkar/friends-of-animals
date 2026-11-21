import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PHONE_START_VIEW } from "../_lib/phone-form-state";
import { PhoneCodeForm, type PhoneCodeFormLabels } from "./phone-code-form";

const labels: PhoneCodeFormLabels = {
  name: { label: "Your name", hint: "The name your account shows." },
  phone: { label: "Mobile number", hint: "We'll text a 6-digit code." },
  code: { label: "6-digit code" },
  sendCode: "Text me a code",
  sending: "Sending…",
  verify: "Create account",
  checking: "Checking…",
  resend: "Send a new code",
  changePhone: "Use a different number",
  signUpInstead: "Create an account instead",
  useEmail: "Use your email instead",
  problem: "Important",
  done: "Done",
};

const noop = async () => PHONE_START_VIEW;

describe("<PhoneCodeForm>", () => {
  it("asks a sign-up for a name and a mobile number first", () => {
    const html = renderToStaticMarkup(
      <PhoneCodeForm
        action={noop}
        intent="sign-up"
        labels={labels}
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
      <PhoneCodeForm
        action={noop}
        intent="sign-in"
        labels={{ ...labels, verify: "Sign in" }}
        signUpPath="/sign-up/phone"
        emailPath="/sign-in"
      />
    );

    expect(html).not.toContain('id="name"');
    expect(html).toMatch(/<input[^>]* id="phone"/);
  });
});
