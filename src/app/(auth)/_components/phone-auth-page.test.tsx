import { describe, expect, it, vi } from "vitest";

import { renderHtml, visibleText } from "@/test/render";

import { PhoneMethodView } from "./phone-auth-page";
vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

describe("phone authentication alternatives", () => {
  it.each(["sign-in", "sign-up"] as const)(
    "does not offer unavailable email authentication on %s",
    async (intent) => {
      const html = await renderHtml(
        <PhoneMethodView
          intent={intent}
          methods={{ email: false, phone: true }}
        />
      );
      expect(visibleText(html)).toContain("Text me a code");
      expect(visibleText(html)).not.toContain("Use your email instead");
      expect(html).not.toContain(`href="/${intent}"`);

      const withEmail = await renderHtml(
        <PhoneMethodView
          intent={intent}
          methods={{ email: true, phone: true }}
        />
      );
      expect(visibleText(withEmail)).toContain("Use your email instead");
      expect(withEmail).toContain(`href="/${intent}"`);
    }
  );
});
