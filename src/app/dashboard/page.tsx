import { Clock } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import {
  ADMIN_LEDGER,
  ADMIN_PAYMENTS_REVIEW,
  ADMIN_REFUNDS,
  APP_ROUTES,
  institutionCompetitionsPath,
  judgingGuidePath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

import { dashboardLinks, type DashboardLink } from "./_lib/dashboard-links";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  const t = await getTranslations("dashboard");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
      />
      {/* The actor is read per request, so it streams in behind this
          boundary while the heading above is prerendered. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Areas />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

async function Areas() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, { dashboards, grants }] = await Promise.all([
    getTranslations("dashboard"),
    as(actor).myAccess(),
  ]);
  // Only a safeguarding lead is pointed at the reports (#116).
  const lead = grants.some((grant) => grant.role === "safeguarding_lead");
  // Finance, staff admins and super admins look after payments (#79).
  const money = grants.some((grant) =>
    (["finance", "staff_admin", "super_admin"] as const).some(
      (role) => grant.role === role
    )
  );
  const finance = grants.some((grant) => grant.role === "finance");
  const competitions = grants.some(
    (grant) =>
      grant.role === "competition_manager" ||
      (grant.role === "super_admin" && grant.scope.type === "global")
  );
  const links = dashboardLinks(dashboards);
  const name = (link: DashboardLink) =>
    t(`areas.${link.area}`, { id: link.id ?? "" });

  return (
    <div className="mt-8 flex flex-col gap-8">
      {/* The switcher: each area is a link, so the URL says which one is
          open and nothing else has to remember it. */}
      <nav aria-label={t("switcher")}>
        <ul className="flex flex-wrap gap-2">
          {links.map((link) => (
            <li key={link.section} className="max-w-full">
              <SiteLink
                href={link.href}
                className="inline-flex min-h-11 max-w-full items-center rounded-full border-2 border-border-strong bg-surface px-4 py-1.5 font-semibold text-ink wrap-anywhere hover:border-ink"
              >
                {name(link)}
              </SiteLink>
            </li>
          ))}
        </ul>
      </nav>

      {links.map((link) => (
        <section
          key={link.section}
          id={link.section}
          aria-labelledby={`${link.section}-title`}
          className={CARD}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <SectionHeading
              id={`${link.section}-title`}
              title={name(link)}
              className="min-w-0 wrap-anywhere"
            />
            <Chip icon={<Clock aria-hidden="true" />}>{t("comingSoon")}</Chip>
          </div>
          <AreaBody
            area={link.area}
            id={link.id}
            lead={lead}
            money={money}
            finance={finance}
            competitions={competitions}
          />
          {link.area === "institution" ? <JudgingGuides /> : null}
        </section>
      ))}
    </div>
  );
}

async function AreaBody({
  area,
  id,
  lead,
  money,
  finance,
  competitions,
}: {
  area: DashboardLink["area"];
  id?: string;
  lead: boolean;
  money: boolean;
  finance: boolean;
  competitions: boolean;
}) {
  const [t, registration] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("institutionRegistration.competitions"),
  ]);
  const links = (items: { href: string; label: string }[]): ReactNode => (
    <ul className="mt-3 flex flex-col">
      {items.map((item) => (
        <li key={item.href}>
          <SiteLink href={item.href} className={LINK}>
            {item.label}
          </SiteLink>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="mt-3 text-ink">
      <p>{t(`${area}.body`)}</p>
      {area === "member"
        ? links([
            { href: APP_ROUTES.accountSessions, label: t("member.sessions") },
            { href: APP_ROUTES.guardian, label: t("member.children") },
          ])
        : null}
      {area === "institution" && id
        ? links([
            {
              href: institutionCompetitionsPath(id),
              label: registration("entry"),
            },
          ])
        : null}
      {area === "admin"
        ? links([
            { href: APP_ROUTES.adminRoles, label: t("admin.roles") },
            { href: APP_ROUTES.adminAudit, label: t("admin.audit") },
            ...(competitions
              ? [
                  {
                    href: APP_ROUTES.adminCompetitions,
                    label: t("admin.competitions"),
                  },
                ]
              : []),
            ...(lead
              ? [
                  {
                    href: APP_ROUTES.adminSafeguarding,
                    label: t("admin.safeguarding"),
                  },
                ]
              : []),
            ...(money
              ? [
                  {
                    href: ADMIN_PAYMENTS_REVIEW,
                    label: t("admin.payments"),
                  },
                  // The refunds queue (#80).
                  { href: ADMIN_REFUNDS, label: t("admin.refunds") },
                ]
              : []),
            ...(finance
              ? [{ href: ADMIN_LEDGER, label: t("admin.ledger") }]
              : []),
          ])
        : null}
    </div>
  );
}

/**
 * The judging guides an institution's coordinator can read (#88). Nothing
 * while FOA hasn't verified the institution: the guide isn't theirs yet.
 */
async function JudgingGuides() {
  const actor = await currentActor();
  if (actor.kind !== "user") return null;
  const t = await getTranslations("judgingGuide.dashboard");
  let guides;
  try {
    guides = await as(actor).listJudgingGuides();
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden") {
      return null;
    }
    throw error;
  }
  return (
    <div className="mt-5">
      <h3 className="text-lead font-bold text-ink">{t("title")}</h3>
      {guides.length === 0 ? (
        <p className="mt-2 text-ink-muted">{t("none")}</p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {guides.map((guide) => (
            <li key={guide.code}>
              <SiteLink href={judgingGuidePath(guide.code)} className={LINK}>
                {t("item", { name: guide.name, code: guide.code })}
              </SiteLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
