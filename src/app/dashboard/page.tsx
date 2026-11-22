import { Clock } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { Chip } from "@/components/site/chip";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

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
  const [t, { dashboards }] = await Promise.all([
    getTranslations("dashboard"),
    as(actor).myAccess(),
  ]);
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
          <AreaBody area={link.area} />
        </section>
      ))}
    </div>
  );
}

async function AreaBody({ area }: { area: DashboardLink["area"] }) {
  const t = await getTranslations("dashboard");
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
          ])
        : null}
      {area === "admin"
        ? links([
            { href: APP_ROUTES.adminRoles, label: t("admin.roles") },
            { href: APP_ROUTES.adminAudit, label: t("admin.audit") },
          ])
        : null}
    </div>
  );
}
