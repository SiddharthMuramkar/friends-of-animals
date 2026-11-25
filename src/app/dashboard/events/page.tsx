import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { MyRegistrations } from "@/components/events/my-registrations";
import { Feedback } from "@/components/events/feedback";
import { as, currentActor } from "@/server/app";
import { ROUTES } from "@/lib/routes";
export async function generateMetadata() {
  const t = await getTranslations("events");
  return { title: t("my"), robots: { index: false, follow: false } };
}
export default async function Page(props: PageProps<"/dashboard/events">) {
  const t = await getTranslations("events");
  return (
    <Section hue="green" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader title={t("my")} lead={t("myLead")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Bookings {...props} />
      </Suspense>
    </Section>
  );
}
async function Bookings({ searchParams }: PageProps<"/dashboard/events">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [rows, query] = await Promise.all([
    as(actor).listMyEventRegistrations(),
    searchParams,
  ]);
  return (
    <>
      <Feedback result={query.result} />
      <MyRegistrations rows={rows} />
    </>
  );
}
