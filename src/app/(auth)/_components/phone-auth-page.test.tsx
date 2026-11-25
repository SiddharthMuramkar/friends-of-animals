import { describe, expect, it, vi } from "vitest";

import { renderHtml, visibleText } from "@/test/render";

import { PhoneAuthPage } from "./phone-auth-page";

const signInMethods = vi.hoisted(() => vi.fn());
vi.mock("@/server/app", () => ({
  as: () => ({ signInMethods }),
  currentActor: async () => ({ kind: "visitor" }),
}));
vi.mock("../_lib/phone-actions", () => ({ phoneCodeAction: vi.fn() }));
vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

describe("phone authentication alternatives", () => {
  it.each(["sign-in", "sign-up"] as const)(
    "does not offer unavailable email authentication on %s",
    async (intent) => {
      signInMethods.mockResolvedValue({ email: false, phone: true });
      const html = await renderHtml(<PhoneAuthPage intent={intent} />);
      expect(visibleText(html)).toContain("Text me a code");
      expect(visibleText(html)).not.toContain("Use your email instead");
      expect(html).not.toContain(`href="/${intent}"`);

      signInMethods.mockResolvedValue({ email: true, phone: true });
      const withEmail = await renderHtml(<PhoneAuthPage intent={intent} />);
      expect(visibleText(withEmail)).toContain("Use your email instead");
      expect(withEmail).toContain(`href="/${intent}"`);
    }
  );
});
