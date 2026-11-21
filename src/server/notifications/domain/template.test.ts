import { describe, expect, it } from "vitest";

import {
  checkTemplate,
  renderEmailHtml,
  renderTemplate,
  TemplateRenderError,
  templatePlaceholders,
} from "./template";

describe("templatePlaceholders()", () => {
  it("lists each placeholder name once, in order of first use", () => {
    expect(
      templatePlaceholders(
        "Hello {{recipient.name}}, your code is {{ code }}. Bye {{recipient.name}}."
      )
    ).toEqual(["recipient.name", "code"]);
  });

  it("finds nothing in plain text", () => {
    expect(templatePlaceholders("Welcome to Friends of Animals.")).toEqual([]);
  });
});

describe("checkTemplate()", () => {
  it("accepts a template that uses only declared variables", () => {
    expect(
      checkTemplate("Hi {{recipient.name}}", ["recipient.name", "code"])
    ).toEqual([]);
  });

  it("refuses a placeholder the template does not declare", () => {
    expect(checkTemplate("Hi {{recipient.phone}}", ["recipient.name"])).toEqual(
      [{ code: "unknown_variable", name: "recipient.phone" }]
    );
  });

  it("refuses an opening brace pair that is never closed", () => {
    expect(checkTemplate("Hi {{recipient.name", ["recipient.name"])).toEqual([
      { code: "unclosed_placeholder", at: 3 },
    ]);
  });

  it("refuses a placeholder that is not a variable name", () => {
    expect(checkTemplate("Hi {{ <b>name</b> }}", ["name"])).toEqual([
      { code: "invalid_placeholder", text: "<b>name</b>" },
    ]);
    expect(checkTemplate("Hi {{}}", [])).toEqual([
      { code: "invalid_placeholder", text: "" },
    ]);
  });

  it("leaves closing braces on their own alone", () => {
    expect(checkTemplate("Keep calm }} and carry on", [])).toEqual([]);
  });
});

describe("renderTemplate()", () => {
  it("puts each value in place of its placeholder", () => {
    expect(
      renderTemplate("Hi {{ recipient.name }}, welcome to {{site}}!", {
        "recipient.name": "Asha",
        site: "Friends of Animals",
      })
    ).toBe("Hi Asha, welcome to Friends of Animals!");
  });

  it("inserts values literally, never as more placeholders", () => {
    expect(renderTemplate("Hi {{name}}", { name: "{{secret}}" })).toBe(
      "Hi {{secret}}"
    );
  });

  it("refuses to render when a used variable has no value", () => {
    expect(() => renderTemplate("Hi {{name}} {{code}}", { name: "A" })).toThrow(
      TemplateRenderError
    );
    expect(() => renderTemplate("Hi {{name}} {{code}}", { name: "A" })).toThrow(
      /code/
    );
  });

  it("refuses to render a malformed template", () => {
    expect(() => renderTemplate("Hi {{name", { name: "A" })).toThrow(
      TemplateRenderError
    );
  });
});

describe("renderEmailHtml()", () => {
  it("wraps each paragraph and keeps single line breaks", () => {
    expect(
      renderEmailHtml("Hello Asha,\n\nYour entry is in.\nThank you.")
    ).toBe("<p>Hello Asha,</p>\n<p>Your entry is in.<br>\nThank you.</p>");
  });

  it("escapes HTML so neither staff copy nor values become markup", () => {
    expect(renderEmailHtml(`<script>alert("x")</script> & 'Tom' <b>`)).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Tom&#39; &lt;b&gt;</p>"
    );
  });

  it("treats Windows line endings and blank lines with spaces as breaks", () => {
    expect(renderEmailHtml("One\r\n \r\nTwo\r\nThree\n\n\n")).toBe(
      "<p>One</p>\n<p>Two<br>\nThree</p>"
    );
  });
});
