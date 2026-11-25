import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink } from "@/components/site/button-link";
import {
  ADMIN_EVENTS,
  ADMIN_NEW_EVENT,
  adminEventPath,
} from "@/lib/app-routes";
import { as, currentActor } from "@/server/app";
import { adminCall } from "../_lib/boundary";
import { AdminDenied } from "../_components/admin-denied";
export async function generateMetadata() {
  const t = await getTranslations("events");
  return { title: t("admin"), robots: { index: false, follow: false } };
}
export default async function Page() {
  const t = await getTranslations("events");
  return (
    <Section hue="green" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader title={t("admin")} lead={t("adminLead")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Queue />
      </Suspense>
    </Section>
  );
}
async function Queue() {
  const [t, format, actor] = await Promise.all([
    getTranslations("events"),
    getFormatter(),
    currentActor(),
  ]);
  const loaded = await adminCall(
    () => as(actor).listEventsForAdmin(),
    ADMIN_EVENTS
  );
  if (!loaded.ok) return <AdminDenied />;
  return (
    <div className="mt-8 space-y-5">
      <ButtonLink href={ADMIN_NEW_EVENT}>{t("new")}</ButtonLink>
      {loaded.value.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {loaded.value.map((row) => (
            <li
              key={row.id}
              className="min-w-0 rounded-3xl border-2 border-border bg-surface p-5"
            >
              <h2 className="text-h4 text-ink wrap-anywhere">{row.title}</h2>
              <p className="mt-2 text-ink">
                {t(`kind.${row.kind}`)} · {t(`status.${row.status}`)}
              </p>
              <p className="mt-2 text-ink-muted">
                {format.dateTime(row.startsAt, "longDateTime")}
              </p>
              <ButtonLink
                className="mt-4"
                href={adminEventPath(row.id)}
                variant="secondary"
              >
                {t("editLink", { title: row.title })}
              </ButtonLink>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-muted">{t("empty")}</p>
      )}
    </div>
  );
}
