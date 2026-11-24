import { expect, it, vi } from "vitest";

import { createApp } from "@/server/app";
import {
  adultForm,
  openToIndividuals,
} from "@/server/modules/participants/testing";
import { createHarness } from "@/test/harness";
import { renderHtml, visibleText } from "@/test/render";

import { RegistrationView } from "./registration-view";

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));

it("stops before contact and consent fields for known minors in production", async () => {
  const h = await createHarness();
  h.clock.set("2027-01-15T18:29:59.999Z");
  const previous = await openToIndividuals(h, { name: "Paws 2027" });
  const competition = await openToIndividuals(h, { name: "Wings 2027" });
  const independent = await h.signIn(await h.seed.member());
  expect(
    await h.as(independent).registerAsIndividual({
      ...adultForm(previous, { dateOfBirth: "2009-01-16" }),
      guardian: {
        fullName: "Test Guardian",
        relationship: "parent",
        email: "guardian@example.test",
      },
    })
  ).toMatchObject({ ok: true, status: "pending_guardian" });
  const teen = await h.seed.member();
  const family = await h.seed.guardian({
    children: [{ fullName: "Test Teen", age: 15, loginUserId: teen.id }],
  });
  const linked = await h.signIn(teen);
  const parent = await h.signIn(family.account);
  const app = createApp({ ...h.deps, appEnv: "production" });
  const input = { competitionSlug: competition.slug };
  const requests = {
    independent: app.as(independent).individualRegistrationForm(input),
    linked: app.as(linked).individualRegistrationForm(input),
    guardian: app.as(parent).individualRegistrationForm({
      ...input,
      forChildId: family.childIds[0]!,
    }),
  };

  for (const [who, request] of Object.entries(requests)) {
    const form = await request;
    if (!form) throw new Error("No registration view");
    const html = await renderHtml(<RegistrationView form={form} />);

    expect
      .soft(
        visibleText(html).includes(
          "Individual registration for under-18s is coming soon."
        ),
        who
      )
      .toBe(true);
    expect.soft(/<(form|input|select)\b/.test(html), who).toBe(false);
  }

  h.clock.advance(1);
  const form = await app.as(independent).individualRegistrationForm(input);
  if (!form) throw new Error("No adult registration form");
  const html = await renderHtml(<RegistrationView form={form} />);

  expect(html).toContain('name="phone"');
  expect(html).toContain('name="pinCode"');
  expect(html).toContain('name="consents"');
});
