import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { MemberProfile } from "@/components/community/member-profile";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { DASHBOARD_TIMELINE, APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("community.meta");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function Page({
  searchParams,
}: PageProps<"/dashboard/community">) {
  const t = await getTranslations("community");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title")}
        lead={t("intro")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Community searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}
async function Community({
  searchParams,
}: {
  searchParams: PageProps<"/dashboard/community">["searchParams"];
}) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [data, t, query] = await Promise.all([
    as(actor).getMyCommunity(),
    getTranslations("community"),
    searchParams,
  ]);
  return (
    <div className="mt-8 space-y-6">
      <MemberProfile data={data} query={query} />
      <div className="flex flex-wrap gap-3">
        <ButtonLink href={DASHBOARD_TIMELINE} variant="secondary">
          {t("timelineLink")}
        </ButtonLink>
        <ButtonLink href={APP_ROUTES.dashboard} variant="secondary">
          {t("back")}
        </ButtonLink>
      </div>
    </div>
  );
}
