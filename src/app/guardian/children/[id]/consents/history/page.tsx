import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { guardianChildConsentsPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

type Params = PageProps<"/guardian/children/[id]/consents/history">["params"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("childConsents.history");
  return { title: t("meta"), robots: { index: false, follow: false } };
}

export default async function Page({ params }: { params: Params }) {
  const t = await getTranslations("childConsents.history");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <History params={params} />
      </Suspense>
    </Section>
  );
}

async function History({ params }: { params: Params }) {
  const [{ id }, actor, t, purposes, format] = await Promise.all([
    params,
    currentActor(),
    getTranslations("childConsents.history"),
    getTranslations("childConsents.purposes"),
    getFormatter(),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const view = await as(actor)
    .childConsentHistory({ childId: id })
    .catch((error: unknown) => {
      if (error instanceof DomainError && error.code === "forbidden")
        notFound();
      throw error;
    });
  if (!view.ok) notFound();

  return (
    <>
      <PageHeader
        tile="green"
        title={t("title", { name: view.child.fullName })}
      />
      <p className="mt-6">
        <SiteLink href={guardianChildConsentsPath(id)} className={inlineLink}>
          {t("back")}
        </SiteLink>
      </p>
      {view.events.length === 0 ? (
        <p className="mt-8 text-ink-muted">{t("empty")}</p>
      ) : (
        <ol className="mt-8 flex flex-col gap-3">
          {view.events.map((event) => (
            <li
              key={event.id}
              className="rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
            >
              <p className="text-lead font-bold text-ink">
                {t(event.action, { purpose: purposes(event.purpose) })}
              </p>
              <p className="mt-2 text-ink">
                {event.competition?.title ?? t("global")}
              </p>
              <p className="text-ink">{t("document", event.document)}</p>
              <p className="mt-2 text-ink-muted">
                {event.giverName
                  ? t("giver", { name: event.giverName })
                  : t("unknownGiver")}{" "}
                · {t(`methods.${event.method}`)}
              </p>
              <time
                dateTime={event.occurredAt.toISOString()}
                className="text-ink-muted"
              >
                {format.dateTime(event.occurredAt, "longDateTime")}
              </time>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
