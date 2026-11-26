import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { Feedback } from "@/components/events/feedback";
import { ButtonLink } from "@/components/site/button-link";
import { ADMIN_EVENTS, ADMIN_NEW_EVENT } from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { adminCall } from "../../_lib/boundary";
import { AdminDenied } from "../../_components/admin-denied";
import { EventForm } from "../_form";
export async function generateMetadata() {
  const t = await getTranslations("events");
  return { title: t("new"), robots: { index: false, follow: false } };
}
export default async function Page(props: PageProps<"/admin/events/new">) {
  const t = await getTranslations("events");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader title={t("new")} lead={t("adminLead")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Form {...props} />
      </Suspense>
    </Section>
  );
}
async function Form({ searchParams }: PageProps<"/admin/events/new">) {
  const [actor, t, query] = await Promise.all([
    currentActor(),
    getTranslations("events"),
    searchParams,
  ]);
  const loaded = await adminCall(
    () => as(actor).listEventsForAdmin(),
    ADMIN_NEW_EVENT
  );
  if (!loaded.ok) return <AdminDenied />;
  return (
    <>
      <ButtonLink className="mt-4" href={ADMIN_EVENTS} variant="quiet">
        {t("back")}
      </ButtonLink>
      <Feedback result={query.result} />
      <EventForm />
    </>
  );
}
