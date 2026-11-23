import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { APP_ROUTES, institutionRegistrationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";

import { StudentConsentTable } from "./_components/student-consent-table";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("coordinatorConsents");
  return { title: t("title"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/institution/registrations/[ref]/consents">;

export default async function Page({ params }: Props) {
  await connection();
  const t = await getTranslations("coordinatorConsents");
  return (
    <Section hue="pink" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader tile="pink" title={t("title")} />
      <Suspense
        fallback={<p className="mt-6 text-ink-muted">{t("loading")}</p>}
      >
        <StudentConsents params={params} />
      </Suspense>
    </Section>
  );
}

async function StudentConsents({ params }: Pick<Props, "params">) {
  const [{ ref }, actor, t] = await Promise.all([
    params,
    currentActor(),
    getTranslations("coordinatorConsents"),
  ]);
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);

  const list = await as(actor)
    .listStudentConsents({ reference: ref })
    .catch((error: unknown) => {
      if (error instanceof DomainError)
        return { ok: false, error: "not_found" } as const;
      throw error;
    });
  if (!list.ok) {
    const state = list.error === "unavailable" ? "unavailable" : "notFound";
    return (
      <ExplainState
        className="mt-8"
        title={t(state)}
        back={{ href: APP_ROUTES.dashboard, label: t("home") }}
      >
        <p>{t(`${state}Body`)}</p>
      </ExplainState>
    );
  }
  return (
    <div className="mt-8 flex flex-col gap-5">
      <p className="text-lead font-semibold text-ink wrap-anywhere">
        {t("registration", {
          institution: list.institutionName,
          competition: list.competitionTitle,
        })}
      </p>
      {list.students.length === 0 ? (
        <p className="text-ink-muted">{t("empty")}</p>
      ) : (
        <>
          {!list.hasOffers ? (
            <p className="text-ink-muted">{t("noOffers")}</p>
          ) : null}
          <StudentConsentTable list={list} />
        </>
      )}
      <p>
        <ButtonLink
          variant="quiet"
          className="-ms-5"
          href={institutionRegistrationPath(list.reference, list.institutionId)}
        >
          {t("back")}
        </ButtonLink>
      </p>
    </div>
  );
}
