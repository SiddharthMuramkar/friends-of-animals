import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Timeline } from "@/components/community/timeline";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { DASHBOARD_COMMUNITY } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("community.meta");
  return { title: t("timeline"), robots: { index: false, follow: false } };
}
export default async function Page() {
  const t = await getTranslations("community");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("timeline.title")}
        lead={t("timeline.intro")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Journey />
      </Suspense>
    </Section>
  );
}
async function Journey() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [data, t] = await Promise.all([
    as(actor).getTimeline(),
    getTranslations("community"),
  ]);
  return (
    <div className="mt-8 flex flex-col gap-8">
      <Timeline data={data} />
      <div>
        <ButtonLink href={DASHBOARD_COMMUNITY} variant="secondary">
          {t("communityLink")}
        </ButtonLink>
      </div>
    </div>
  );
}
