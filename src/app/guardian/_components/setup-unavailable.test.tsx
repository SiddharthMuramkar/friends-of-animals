import { expect, it, vi } from "vitest";

import { renderHtml } from "@/test/render";

import { GuardianSetupUnavailable } from "./setup-unavailable";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

it("renders guardian setup as an unavailable state with a dashboard link", async () => {
  const html = await renderHtml(<GuardianSetupUnavailable />);

  expect(html).toMatch(/<h2[^>]*>Guardian setup is coming soon<\/h2>/);
  expect(html).toContain("Back to your dashboard");
  expect(html).not.toMatch(/<(form|input|button)\b/);
});
