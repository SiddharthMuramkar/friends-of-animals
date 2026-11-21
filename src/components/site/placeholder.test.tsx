import { afterEach, describe, expect, it, vi } from "vitest";

import { placeholder } from "@/lib/site";
import { renderHtml, visibleText } from "@/test/render";

import { Placeholder } from "./placeholder";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("<Placeholder>", () => {
  it.each(["local", "preview", "staging"])(
    "shows an unconfirmed fact as a dashed tile on %s, for staff to review",
    async (appEnv) => {
      vi.stubEnv("APP_ENV", appEnv);
      const html = await renderHtml(
        <Placeholder fact={placeholder("email")} />
      );
      expect(html).toContain("border-dashed");
      expect(visibleText(html)).toBe("Email addressTo be confirmed");
    }
  );

  it("leaves an unconfirmed fact out of production, stand-in and all", async () => {
    vi.stubEnv("APP_ENV", "production");
    expect(await renderHtml(<Placeholder fact={placeholder("email")} />)).toBe(
      ""
    );
  });

  it.each(["production", "preview"])(
    "shows a confirmed fact on %s",
    async (appEnv) => {
      vi.stubEnv("APP_ENV", appEnv);
      const html = await renderHtml(
        <Placeholder fact={1500}>{(fee) => `₹${fee}`}</Placeholder>
      );
      expect(visibleText(html)).toBe("₹1500");
    }
  );
});
