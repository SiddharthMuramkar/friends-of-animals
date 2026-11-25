import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Timeline } from "@/components/community/timeline";
import { MemberProfile } from "@/components/community/member-profile";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { guardianChildPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("community.meta");
  return { title: t("child"), robots: { index: false, follow: false } };
}
type Props = PageProps<"/guardian/children/[id]/timeline">;
export default async function Page(props: Props) {
  const t = await getTranslations("community");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Journey {...props} />
      </Suspense>
    </Section>
  );
}
async function Journey({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, query, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("community"),
  ]);
  const api = as(actor);
  const loaded = await Promise.all([
    api.getChild({ childId: id }),
    api.getTimeline({ childId: id }),
    api.getMyCommunity({ childId: id }),
  ]).catch((error) => {
    if (error instanceof DomainError) notFound();
    throw error;
  });
  const [child, data, member] = loaded;
  if (!child.ok) notFound();
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("timeline.childTitle", { name: child.child.fullName })}
        lead={t("timeline.intro")}
      />
      <div className="mt-8 flex flex-col gap-8">
        <Timeline data={data} />
        <MemberProfile data={member} childId={id} query={query} />
        <div>
          <ButtonLink href={guardianChildPath(id)} variant="secondary">
            {t("backChild")}
          </ButtonLink>
        </div>
      </div>
    </>
  );
}
