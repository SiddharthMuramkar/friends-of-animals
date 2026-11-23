import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Disclosure } from "@/components/site/disclosure";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { messages } from "@/i18n/messages";
import { ADMIN_PRIVACY } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { MONTHS_AFTER_CLOSE } from "@/server/modules/contact/inventory";

import { AdminDenied } from "../_components/admin-denied";
import { adminCall } from "../_lib/boundary";

export const metadata: Metadata = {
  ...messages.adminPrivacy.meta,
  robots: { index: false, follow: false },
};

export default async function Page() {
  const t = await getTranslations("adminPrivacy");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader tile="blue" title={t("title")} lead={t("lead")} />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Inventory />
      </Suspense>
    </Section>
  );
}

async function Inventory() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const result = await adminCall(() => as(actor).getInventory(), ADMIN_PRIVACY);
  if (!result.ok) return <AdminDenied />;

  const [t, purposes] = await Promise.all([
    getTranslations("adminPrivacy.inventory"),
    getTranslations("adminPrivacy.inventory.purposes"),
  ]);
  const byTable = Map.groupBy(result.value.entries, (entry) => entry.table);
  return (
    <ul className="mt-8 flex flex-col gap-3">
      {[...byTable].map(([table, entries]) => (
        <li key={table}>
          <Disclosure
            summary={
              <span className="flex flex-wrap items-baseline gap-x-3">
                <code className="font-mono text-ink wrap-anywhere">
                  {table}
                </code>
                <span className="text-ink-muted">
                  {t("columns", { count: entries.length })}
                </span>
              </span>
            }
          >
            <ul className="flex flex-col gap-5">
              {entries.map((entry) => (
                <li key={entry.column}>
                  <p>
                    <code className="font-mono font-semibold text-ink wrap-anywhere">
                      {entry.column}
                    </code>
                  </p>
                  <dl className="mt-2 grid gap-x-6 gap-y-2 text-ink sm:grid-cols-[auto_1fr] [&_dt]:font-semibold">
                    <dt>{t("purpose")}</dt>
                    <dd>
                      {purposes(
                        `${table}.${entry.column}` as Parameters<
                          typeof purposes
                        >[0]
                      )}
                    </dd>
                    <dt>{t("kind")}</dt>
                    <dd>{t(`categories.${entry.category}`)}</dd>
                    <dt>{t("subject")}</dt>
                    <dd className="wrap-anywhere">
                      {t("subjectPath", entry.subject)}
                    </dd>
                    <dt>{t("kept")}</dt>
                    <dd>
                      {entry.retention.policy === "contactMessages"
                        ? t("periods.contactMessages", {
                            months: MONTHS_AFTER_CLOSE,
                          })
                        : entry.retention.period}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          </Disclosure>
        </li>
      ))}
    </ul>
  );
}
