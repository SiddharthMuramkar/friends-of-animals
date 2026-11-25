import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChildProtectionPage from "@/app/(legal)/child-protection-policy/page";
import PrivacyPage from "@/app/(legal)/privacy/page";
import SafeguardingPage from "@/app/(legal)/safeguarding/page";
import TermsPage from "@/app/(legal)/terms/page";
import AboutPage from "@/app/about/page";
import { FactChecks } from "@/app/blog/_components/fact-checks";
import ContactPage from "@/app/contact/page";
import DonatePage from "@/app/donate/page";
import PricingPage from "@/app/pricing/page";
import RefundsPage from "@/app/refunds/page";
import SchoolsPage from "@/app/schools/page";
import { messages } from "@/i18n/messages";
import { pageKind } from "@/server/modules/cms/kinds/page";
import { renderHtml, visibleText } from "@/test/render";

// The owner's decision of 2026-11-21: production ships without the
// organisation facts FOA hasn't confirmed. Each one is left out with its
// label, never shown as a "To be confirmed" tile; running text is reworded
// so it stays true. Local, preview and staging keep the tiles for staff.

vi.mock("next-intl/server", () => import("@/test/next-intl-server"));
vi.mock("next/image", () => import("@/test/next-image"));

afterEach(() => {
  vi.unstubAllEnvs();
});

const { common } = messages;
const TO_BE_CONFIRMED = common.toBeConfirmed;
/** The tile's label for each unconfirmed fact, e.g. "Registered name". */
const LABELS = Object.values(common.placeholders);

async function render(Page: ComponentType, appEnv: string) {
  vi.stubEnv("APP_ENV", appEnv);
  vi.stubEnv("APP_URL", "https://friendsofanimals.example");
  return renderHtml(<Page />);
}

/** Matches `text` as the whole content of an element, as labels render. */
function wholeText(text: string) {
  return new RegExp(`>\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*<`);
}

/** Problems a left-out item can leave behind in the markup. */
function leftovers(html: string): string[] {
  const empty = [
    ...html.matchAll(
      /<(h[1-6]|p|ul|ol|dl|li|dt|dd|th|td|section|aside|nav)\b[^>]*>(?:\s|<!-- -->)*<\/\1>/g
    ),
  ].map(([element]) => `empty: ${element}`);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const dangling = [
    ...html.matchAll(/\saria-(?:labelledby|describedby)="([^"]+)"/g),
  ]
    .flatMap((m) => m[1]!.split(" "))
    .filter((id) => !ids.has(id))
    .map((id) => `labelled by a missing id: ${id}`);
  return [...empty, ...dangling];
}

const PAGES: Record<string, ComponentType> = {
  "/about": AboutPage,
  "/blog (fact checks)": FactChecks,
  "/contact": ContactPage,
  "/donate": DonatePage,
  "/pricing": PricingPage,
  "/refunds": RefundsPage,
  "/schools": SchoolsPage,
  "/privacy": PrivacyPage,
  "/terms": TermsPage,
  "/safeguarding": SafeguardingPage,
  "/child-protection-policy": ChildProtectionPage,
};

describe.each(Object.entries(PAGES))("%s", (_path, Page) => {
  it("shows no unconfirmed fact or stand-in for one in production", async () => {
    const html = await render(Page, "production");
    expect(html).not.toContain(TO_BE_CONFIRMED);
    for (const label of LABELS) expect(html).not.toMatch(wholeText(label));
  });

  it("leaves no empty element or dangling label in production", async () => {
    expect(leftovers(await render(Page, "production"))).toEqual([]);
  });

  it("keeps the tiles on preview, for staff to review", async () => {
    const html = await render(Page, "preview");
    expect(html).toContain(TO_BE_CONFIRMED);
    expect(leftovers(html)).toEqual([]);
  });
});

describe("/donate in production", () => {
  it("leaves out the registration details, their labels and their card", async () => {
    const text = visibleText(await render(DonatePage, "production"));
    for (const gone of [
      "Is Friends of Animals legitimate?",
      "Registered name",
      "Registration",
      "PAN",
      "Until every line above is filled in",
    ])
      expect(text).not.toContain(gone);
    expect(text).toContain("What we can't do yet");
  });

  it("leaves out the email line but keeps the way to the contact page", async () => {
    const html = await render(DonatePage, "production");
    expect(html).not.toMatch(wholeText(messages.donate.csr.email));
    expect(visibleText(html)).toContain(messages.donate.csr.link);
  });
});

describe("/contact in production", () => {
  const { details, topics } = messages.contact;

  it("leaves out the contact details, their labels and their heading", async () => {
    const html = await render(ContactPage, "production");
    for (const label of [details.email, details.phone, details.address])
      expect(html).not.toMatch(wholeText(label));
    const text = visibleText(html);
    expect(text).not.toContain(details.title);
    // Both lines speak of the details just left out ("please use email").
    expect(text).not.toContain(details.reply);
    expect(text).not.toContain(details.form);
  });

  it("still says what to write about and where to take a safeguarding concern", async () => {
    const html = await render(ContactPage, "production");
    const text = visibleText(html);
    expect(text).toContain(topics.title);
    expect(text).toContain(topics.safeguarding.title);
    // The remaining cards use the available width instead of the empty
    // details column.
    expect(html).not.toContain(
      "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
    );
    expect(html).toContain("mx-auto max-w-5xl");
    expect(html).toContain("sm:grid-cols-2");
  });
});

// /contact offers no way to reach FOA in production, so sentences that
// gave an email, phone or address drop that clause instead of pointing
// there. Where the registered name is missing, the public name stands alone.
describe("policy pages in production", () => {
  it("/privacy names FOA by its public name and leaves out the rest", async () => {
    const html = await render(PrivacyPage, "production");
    const text = visibleText(html);
    expect(text).toContain(
      "Friends of Animals runs this website and its programmes. We decide why and how your personal data is used, which makes us the “data fiduciary” under India’s Digital Personal Data Protection Act, 2023.We built"
    );
    expect(text).not.toContain("registered name");
    expect(text).not.toContain("postal address");
  });

  it("/privacy speaks of the grievance officer without naming anyone", async () => {
    const html = await render(PrivacyPage, "production");
    const text = visibleText(html);
    expect(text).toContain(
      "Our grievance officer handles these requests. We acknowledge every request within 48 hours and resolve it within 30 days."
    );
    expect(text).not.toContain("details below");
    // The officer's section held only unconfirmed facts: it goes, with its
    // heading and its entry in the table of contents.
    expect(html).not.toContain('id="grievance-officer"');
    expect(html).not.toContain('href="#grievance-officer"');
  });

  it("/terms names FOA by its public name and drops the email clause", async () => {
    const text = visibleText(await render(TermsPage, "production"));
    expect(text).toContain(
      "These terms are an agreement between you and Friends of Animals for using this website and taking part in our programmes."
    );
    expect(text).toContain(
      "These terms are governed by the laws of India.Changes to these terms"
    );
  });

  it("/safeguarding drops the email and phone clause and points at the report form", async () => {
    const text = visibleText(await render(SafeguardingPage, "production"));
    expect(text).toContain(
      "If a child is in danger now, call 112 first. Then tell us through our report form. It works without an account, and you can stay anonymous.You don’t have to give your name"
    );
    expect(text).toContain(
      "Only our safeguarding lead reads what you send.Report a concern"
    );
    expect(text).not.toContain("You can also write to");
    expect(text).not.toContain("email or phone above");
  });

  it("/child-protection-policy names FOA by its public name and drops the email clause", async () => {
    const text = visibleText(await render(ChildProtectionPage, "production"));
    expect(text).toContain(
      "This policy sets out how Friends of Animals protects every child who takes part in our competitions, events and programmes."
    );
    expect(text).toContain(
      "We review this policy every year, and after any serious incident."
    );
    expect(text).not.toContain("Questions about it can go to");
  });
});

describe("policy pages on preview", () => {
  it("keep each sentence whole, with a tile for the missing fact", async () => {
    const text = visibleText(await render(PrivacyPage, "preview"));
    expect(text).toContain(
      "Friends of Animals (registered name: Registered nameTo be confirmed) runs this website"
    );
    expect(text).toContain("Write to our grievance officer (details below).");
    expect(text).toContain("Name: Grievance officerTo be confirmed");
  });
});

describe("other pages in production", () => {
  it("/about leaves out the registration line, label and all", async () => {
    const html = await render(AboutPage, "production");
    expect(html).not.toMatch(
      wholeText(messages.about.transparency.registration)
    );
    expect(visibleText(html)).toContain(pageKind.seedBody().transparency.title);
  });

  it("/pricing leaves out the fee column but keeps who pays on each route", async () => {
    const html = await render(PricingPage, "production");
    const { fees } = messages.pricing;
    expect(html).not.toMatch(wholeText(fees.amount));
    const text = visibleText(html);
    for (const kept of [fees.title, fees.lead, fees.schoolWho, fees.selfWho])
      expect(text).toContain(kept);
  });

  it("/refunds leaves out the refund time and the email line", async () => {
    const html = await render(RefundsPage, "production");
    const { timing, ask } = messages.refunds;
    expect(html).not.toMatch(wholeText(timing.time));
    expect(html).not.toMatch(wholeText(ask.email));
    const text = visibleText(html);
    expect(text).toContain(timing.body);
    expect(text).toContain(ask.link);
  });

  it("/schools leaves out the email line", async () => {
    const html = await render(SchoolsPage, "production");
    expect(visibleText(html)).not.toContain(
      messages.schools.contact.contactLabel
    );
  });

  it("the blog's fact checks leave out the line asking for an email", async () => {
    const text = visibleText(await render(FactChecks, "production"));
    expect(text).not.toContain(messages.stories.checks.mistake);
    expect(text).toContain(messages.stories.checks.points.sources);
  });
});
