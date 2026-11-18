import { describe, expect, it } from "vitest";

import { jsonLdScript, organizationJsonLd, pageMetadata } from "./seo";

describe("pageMetadata()", () => {
  const meta = pageMetadata({
    title: "About us",
    description: "Who we are.",
    path: "/about",
  });

  it("sets the title, description and canonical path", () => {
    expect(meta.title).toBe("About us");
    expect(meta.description).toBe("Who we are.");
    expect(meta.alternates?.canonical).toBe("/about");
  });

  it("fills Open Graph and Twitter with the default social image", () => {
    expect(meta.openGraph).toMatchObject({
      title: "About us",
      description: "Who we are.",
      url: "/about",
    });
    const images = meta.openGraph?.images;
    expect(JSON.stringify(images)).toContain("/brand/foa-social-1200x630.png");
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("uses a page image when given", () => {
    const withImage = pageMetadata({
      title: "T",
      description: "D",
      path: "/x",
      image: { url: "/x.jpg", width: 1200, height: 630, alt: "A kite" },
    });
    expect(JSON.stringify(withImage.openGraph?.images)).toContain("/x.jpg");
  });
});

describe("jsonLdScript()", () => {
  it("escapes < so the script tag can't be closed early", () => {
    const out = jsonLdScript({ name: "</script><b>" });
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual({ name: "</script><b>" });
  });
});

describe("organizationJsonLd()", () => {
  const data = organizationJsonLd(new URL("https://shipped-it.dev"), "About.");

  it("describes FOA as an NGO with absolute URLs", () => {
    expect(data).toMatchObject({
      "@type": "NGO",
      name: "Friends of Animals",
      url: "https://shipped-it.dev/",
      logo: "https://shipped-it.dev/brand/foa-logo.svg",
    });
  });

  it("omits facts that are still placeholders", () => {
    expect(data).not.toHaveProperty("email");
    expect(data).not.toHaveProperty("legalName");
    expect(JSON.stringify(data)).not.toContain("placeholder");
  });
});
