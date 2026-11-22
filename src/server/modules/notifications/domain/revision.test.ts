import { describe, expect, it } from "vitest";

import { reviseTemplate, type TemplateVersion } from "./revision";

const welcomeEmail: TemplateVersion = {
  channel: "email",
  subject: "Welcome, {{recipient.name}}",
  body: "Hello {{recipient.name}},\n\nThanks for joining.",
  variables: ["recipient.name"],
  dltTemplateId: null,
  version: 3,
};

const welcomeSms: TemplateVersion = {
  channel: "sms",
  subject: null,
  body: "Welcome to FOA, {{recipient.name}}.",
  variables: ["recipient.name"],
  dltTemplateId: "1007161234567890123",
  version: 1,
};

describe("reviseTemplate()", () => {
  it("stores new wording as the next version", () => {
    expect(
      reviseTemplate(welcomeEmail, {
        subject: "  Hello from FOA, {{recipient.name}} ",
        body: "Hi {{recipient.name}},\r\n\r\nGlad you're here.\r\n",
      })
    ).toEqual({
      ok: true,
      changed: true,
      next: {
        ...welcomeEmail,
        subject: "Hello from FOA, {{recipient.name}}",
        body: "Hi {{recipient.name}},\n\nGlad you're here.",
        version: 4,
      },
    });
  });

  it("keeps the version when nothing changed", () => {
    expect(
      reviseTemplate(welcomeEmail, {
        subject: welcomeEmail.subject,
        body: `${welcomeEmail.body}\n`,
      })
    ).toEqual({ ok: true, changed: false, next: welcomeEmail });
  });

  it("refuses a variable the template does not declare, in subject or body", () => {
    expect(
      reviseTemplate(welcomeEmail, {
        subject: "Hi {{recipient.email}}",
        body: "Code {{code}} and {{ oops",
      })
    ).toEqual({
      ok: false,
      problems: [
        { field: "subject", code: "unknown_variable", name: "recipient.email" },
        { field: "body", code: "unknown_variable", name: "code" },
        { field: "body", code: "unclosed_placeholder", at: 18 },
      ],
    });
  });

  it("needs a subject for email and a title for in-app", () => {
    expect(reviseTemplate(welcomeEmail, { subject: "  ", body: "Hi" })).toEqual(
      { ok: false, problems: [{ field: "subject", code: "required" }] }
    );
    expect(
      reviseTemplate(
        { ...welcomeEmail, channel: "in_app" },
        { subject: null, body: "Hi" }
      )
    ).toEqual({
      ok: false,
      problems: [{ field: "subject", code: "required" }],
    });
  });

  it("allows no subject on an SMS", () => {
    expect(
      reviseTemplate(welcomeSms, { subject: "Hello", body: welcomeSms.body })
    ).toEqual({
      ok: false,
      problems: [{ field: "subject", code: "not_allowed" }],
    });
  });

  it("needs a body", () => {
    expect(
      reviseTemplate(welcomeEmail, { subject: "Hi", body: " \n " })
    ).toEqual({ ok: false, problems: [{ field: "body", code: "required" }] });
  });

  it("limits lengths per channel", () => {
    expect(
      reviseTemplate(welcomeEmail, { subject: "S".repeat(121), body: "Hi" })
    ).toEqual({
      ok: false,
      problems: [{ field: "subject", code: "too_long", max: 120 }],
    });
    expect(
      reviseTemplate(welcomeSms, { subject: null, body: "x".repeat(1001) })
    ).toEqual({
      ok: false,
      problems: [{ field: "body", code: "too_long", max: 1000 }],
    });
    expect(
      reviseTemplate(
        { ...welcomeEmail, channel: "in_app" },
        { subject: "Hi", body: "x".repeat(1000) }
      ).ok
    ).toBe(true);
  });

  it("clears the DLT id when the SMS wording changes", () => {
    expect(
      reviseTemplate(welcomeSms, {
        subject: null,
        body: "Welcome aboard, {{recipient.name}}.",
        dltTemplateId: welcomeSms.dltTemplateId,
      })
    ).toEqual({
      ok: true,
      changed: true,
      next: {
        ...welcomeSms,
        body: "Welcome aboard, {{recipient.name}}.",
        dltTemplateId: null,
        version: 2,
      },
    });
  });

  it("takes a new DLT id given with new SMS wording", () => {
    const result = reviseTemplate(welcomeSms, {
      subject: null,
      body: "Welcome aboard, {{recipient.name}}.",
      dltTemplateId: "1007169999999999999",
    });
    expect(result.ok && result.next.dltTemplateId).toBe("1007169999999999999");
  });

  it("sets or clears the DLT id on unchanged SMS wording", () => {
    const unregistered = { ...welcomeSms, dltTemplateId: null };
    expect(
      reviseTemplate(unregistered, {
        subject: null,
        body: welcomeSms.body,
        dltTemplateId: " 1007161234567890123 ",
      })
    ).toEqual({
      ok: true,
      changed: true,
      next: { ...welcomeSms, version: 2 },
    });
    expect(
      reviseTemplate(welcomeSms, {
        subject: null,
        body: welcomeSms.body,
        dltTemplateId: "",
      })
    ).toEqual({
      ok: true,
      changed: true,
      next: { ...welcomeSms, dltTemplateId: null, version: 2 },
    });
  });

  it("keeps the DLT id when the edit leaves it out", () => {
    expect(
      reviseTemplate(welcomeSms, { subject: null, body: welcomeSms.body })
    ).toEqual({ ok: true, changed: false, next: welcomeSms });
  });

  it("refuses a DLT id that is not a number, or on another channel", () => {
    expect(
      reviseTemplate(welcomeSms, {
        subject: null,
        body: welcomeSms.body,
        dltTemplateId: "TEMPLATE-1",
      })
    ).toEqual({
      ok: false,
      problems: [{ field: "dltTemplateId", code: "invalid" }],
    });
    expect(
      reviseTemplate(welcomeEmail, {
        subject: "Hi",
        body: "Hi",
        dltTemplateId: "1007161234567890123",
      })
    ).toEqual({
      ok: false,
      problems: [{ field: "dltTemplateId", code: "not_allowed" }],
    });
  });
});
