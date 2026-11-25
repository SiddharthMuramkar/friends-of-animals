import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  MyRegistrations,
  ChildBrowse,
} from "@/components/events/my-registrations";
import { Feedback } from "@/components/events/feedback";
import { as, currentActor } from "@/server/app";
import { ROUTES } from "@/lib/routes";
import { DomainError } from "@/server/errors";
export async function generateMetadata() {
  const t = await getTranslations("events");
  return { title: t("child"), robots: { index: false, follow: false } };
}
export default async function Page(
  props: PageProps<"/guardian/children/[id]/events">
) {
  const t = await getTranslations("events");
  return (
    <Section hue="green" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader title={t("child")} lead={t("childLead")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Bookings {...props} />
      </Suspense>
    </Section>
  );
}
async function Bookings({
  params,
  searchParams,
}: PageProps<"/guardian/children/[id]/events">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const { id: childId } = await params;
  const api = as(actor);
  const [rows, events, query] = await Promise.all([
    api.listMyEventRegistrations({ childId }),
    api.listPublishedEvents(),
    searchParams,
  ]).catch((error) => {
    if (error instanceof DomainError) notFound();
    throw error;
  });
  return (
    <>
      <Feedback result={query.result} />
      <MyRegistrations rows={rows} childId={childId} />
      <ChildBrowse rows={rows} events={events.items} childId={childId} />
    </>
  );
}
