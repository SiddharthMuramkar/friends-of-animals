import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "./index";

describe("<TextField>", () => {
  it("labels its input", () => {
    const html = renderToStaticMarkup(
      <TextField id="email" name="email" type="email" label="Email address" />
    );
    expect(html).toContain('<label for="email"');
    expect(html).toMatch(/<input[^>]* id="email"[^>]* name="email"/);
    expect(html).toContain("Email address");
  });

  it("points the input at its hint", () => {
    const html = renderToStaticMarkup(
      <TextField id="email" name="email" label="Email" hint="We send a code" />
    );
    expect(html).toMatch(/<input[^>]* aria-describedby="email-hint"/);
    expect(html).toMatch(/id="email-hint"[^>]*>We send a code</);
    expect(html).not.toMatch(/ aria-invalid="/);
  });

  it("marks the input invalid and points it at the error", () => {
    const html = renderToStaticMarkup(
      <TextField
        id="email"
        name="email"
        label="Email"
        hint="We send a code"
        error="Enter an email address"
      />
    );
    expect(html).toMatch(/<input[^>]* aria-invalid="true"/);
    expect(html).toMatch(/aria-describedby="email-hint email-error"/);
    expect(html).toMatch(/id="email-error"[^>]*>.*Enter an email address/);
  });

  it("keeps its hint and error when the caller adds a description", () => {
    const html = renderToStaticMarkup(
      <TextField
        id="email"
        name="email"
        label="Email"
        hint="We send a code"
        error="Enter an email address"
        aria-describedby="email-policy"
      />
    );
    expect(html).toMatch(
      /<input[^>]* aria-describedby="email-policy email-hint email-error"/
    );
  });

  it("stays invalid while it shows an error, whatever the caller passes", () => {
    const html = renderToStaticMarkup(
      <TextField
        id="email"
        name="email"
        label="Email"
        error="Enter an email address"
        aria-invalid={false}
      />
    );
    expect(html).toMatch(/<input[^>]* aria-invalid="true"/);
  });

  it("passes input attributes through", () => {
    const html = renderToStaticMarkup(
      <TextField
        id="code"
        name="code"
        label="Code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
      />
    );
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('required=""');
  });
});

describe("<FormAlert>", () => {
  it("announces a problem with an icon and a word, not colour alone", () => {
    const html = renderToStaticMarkup(
      <FormAlert tone="danger" label="Important">
        Too many codes. Try again in 15 minutes.
      </FormAlert>
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("<svg");
    expect(html).toContain("Important");
    expect(html).toContain("Too many codes. Try again in 15 minutes.");
  });

  it("reports good news politely", () => {
    const html = renderToStaticMarkup(
      <FormAlert tone="success" label="Done">
        We sent a code.
      </FormAlert>
    );
    expect(html).toContain('role="status"');
  });
});

describe("<SubmitButton>", () => {
  it("submits its form", () => {
    const html = renderToStaticMarkup(
      <SubmitButton pendingLabel="Sending…">Send code</SubmitButton>
    );
    expect(html).toMatch(/<button[^>]* type="submit"/);
    expect(html).toContain("Send code");
    expect(html).not.toMatch(/ disabled=""/);
  });

  it("tells the action which button was pressed", () => {
    const html = renderToStaticMarkup(
      <SubmitButton name="step" value="resend" pendingLabel="Sending…">
        Send a new code
      </SubmitButton>
    );
    expect(html).toMatch(/<button[^>]* name="step"/);
    expect(html).toMatch(/<button[^>]* value="resend"/);
  });
});

describe("<TextAreaField>", () => {
  it("labels its textarea and points it at its hint and error", () => {
    const html = renderToStaticMarkup(
      <TextAreaField
        id="note"
        name="note"
        label="Note"
        hint="Only leads read it"
        error="Write a note first"
      />
    );
    expect(html).toContain('<label for="note"');
    expect(html).toMatch(
      /<textarea[^>]* name="note"[^>]* id="note"[^>]* aria-describedby="note-hint note-error" aria-invalid="true"/
    );
    expect(html).toMatch(/id="note-error"[^>]*>.*Write a note first</);
  });

  it("is valid without an error", () => {
    const html = renderToStaticMarkup(
      <TextAreaField id="note" name="note" label="Note" />
    );
    expect(html).not.toMatch(/ aria-invalid="/);
    expect(html).not.toMatch(/ aria-describedby="/);
  });
});

describe("<SelectField>", () => {
  it("labels its select and offers the placeholder first", () => {
    const html = renderToStaticMarkup(
      <SelectField
        id="severity"
        name="severity"
        label="Severity"
        placeholder="Choose one"
        options={[{ value: "high", label: "High" }]}
      />
    );
    expect(html).toContain('<label for="severity"');
    expect(html).toMatch(
      /<option value="">Choose one<\/option><option value="high">High<\/option>/
    );
  });
});
