import { expect, it, vi } from "vitest";

import { guardianChildPath } from "@/lib/app-routes";
import { createApp } from "@/server/app";
import { guardianFlowsActive } from "@/server/modules/guardians/availability";
import { createHarness } from "@/test/harness";
import { renderHtml, visibleText } from "@/test/render";

import { GuardianDashboard } from "./guardian-dashboard";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

it("shows setup availability to guardians in production and keeps existing children reachable", async () => {
  const h = await createHarness();
  const member = await h.signIn(await h.seed.member());
  const unverified = await h.signIn(await h.seed.member());
  expect(
    await h.as(unverified).registerAsGuardian({
      fullName: "Test Guardian",
      adultDeclared: true,
    })
  ).toEqual({ ok: true });
  const family = await h.seed.guardian({
    children: [{ fullName: "Test Child", age: 9 }],
  });
  const verified = await h.signIn(family.account);
  const appEnv = "production";
  const app = createApp({ ...h.deps, appEnv });

  for (const [who, actor] of Object.entries({ member, unverified, verified })) {
    const guardian = app.as(actor);
    const profile = await guardian.myGuardianProfile();
    const childProfiles =
      profile.registered && profile.verified
        ? await guardian.listChildren()
        : [];
    const html = await renderHtml(
      <GuardianDashboard
        profile={profile}
        childProfiles={childProfiles}
        setupAvailable={guardianFlowsActive(appEnv)}
      />
    );

    expect
      .soft(visibleText(html).includes("Guardian setup is coming soon"), who)
      .toBe(true);
    expect
      .soft(/href="\/guardian\/(register|children\/new)"/.test(html), who)
      .toBe(false);
    if (who === "verified") {
      expect(html).toContain(
        `href="${guardianChildPath(family.childIds[0]!)}"`
      );
      expect(visibleText(html)).toContain("Test Child");
    }
  }
});
