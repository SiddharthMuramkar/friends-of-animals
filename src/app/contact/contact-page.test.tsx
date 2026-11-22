import { describe, expect, it, vi } from "vitest";

import ContactPage from "@/app/contact/page";
import { renderHtml } from "@/test/render";

import { inlineHandlers } from "../../../scripts/csp-output";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));
vi.mock("next/image", () => import("@/test/next-image"));

describe("the prerendered contact page", () => {
  it("has the form, with no inline handler or javascript: URL for the CSP to block", async () => {
    const html = await renderHtml(<ContactPage />);

    expect(html).toContain("<form");
    expect(inlineHandlers(html)).toEqual([]);
  });
});
