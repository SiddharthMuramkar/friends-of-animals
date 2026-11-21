import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { placeholder } from "@/lib/site";
import { renderHtml, visibleText } from "@/test/render";

import { ContactFact } from "./contact-fact";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

afterEach(() => {
  vi.unstubAllEnvs();
});

type PlaceholderProps = {
  fact: unknown;
  children: (value: string) => ReactNode;
};

/** The link ContactFact renders for a confirmed value. */
function linkFor(kind: "email" | "phone", value: string) {
  const el = ContactFact({
    kind,
    fact: value,
  }) as ReactElement<PlaceholderProps>;
  const link = el.props.children(value);
  expect(isValidElement(link)).toBe(true);
  return (link as ReactElement<{ href: string; children: ReactNode }>).props;
}

describe("<ContactFact>", () => {
  it("links a confirmed email with mailto:", () => {
    expect(linkFor("email", "hello@example.org")).toMatchObject({
      href: "mailto:hello@example.org",
      children: "hello@example.org",
    });
  });

  it("links a confirmed phone number with tel:", () => {
    expect(linkFor("phone", "+91 98765 43210")).toMatchObject({
      href: "tel:+919876543210",
      children: "+91 98765 43210",
    });
  });

  it("passes an unconfirmed fact on to the placeholder", () => {
    const fact = placeholder("email");
    const el = ContactFact({
      kind: "email",
      fact,
    }) as ReactElement<PlaceholderProps>;
    expect(el.props.fact).toBe(fact);
  });

  it("renders nothing for an unconfirmed contact in production", async () => {
    vi.stubEnv("APP_ENV", "production");
    const html = await renderHtml(
      <ContactFact kind="phone" fact={placeholder("phone")} />
    );
    expect(html).toBe("");
  });

  it("keeps the tile for an unconfirmed contact on preview", async () => {
    vi.stubEnv("APP_ENV", "preview");
    const html = await renderHtml(
      <ContactFact kind="phone" fact={placeholder("phone")} />
    );
    expect(visibleText(html)).toBe("Phone numberTo be confirmed");
  });

  it("links a confirmed contact in production", async () => {
    vi.stubEnv("APP_ENV", "production");
    const html = await renderHtml(
      <ContactFact kind="email" fact="hello@example.org" />
    );
    expect(html).toMatch(
      /<a href="mailto:hello@example.org"[^>]*>hello@example.org<\/a>/
    );
  });
});
