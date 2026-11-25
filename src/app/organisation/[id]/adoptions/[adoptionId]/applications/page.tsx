import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  ApplicantDetailsList,
  ApplicationStatusChip,
} from "@/components/adoption/application-parts";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { adoptionPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { NotYours, unlessForbidden } from "../../_components/forbidden";

// One animal's applications, for its organisation's representatives
// (#130): each one's status and dates; the applicant's name, contact and
// answers only once FOA's adoption coordinator has put them in touch.
// The coordinator moves applications on; the organisation reads.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoptionApplications.organisation.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props =
  PageProps<"/organisation/[id]/adoptions/[adoptionId]/applications">;

export default async function Page({ params }: Props) {
  const t = await getTranslations("adoption.manage");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Applications params={params} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Applications({ params }: Pick<Props, "params">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id, adoptionId }, t, format] = await Promise.all([
    params,
    getTranslations("adoptionApplications.organisation"),
    getFormatter(),
  ]);
  const [owned, result] = await Promise.all([
    unlessForbidden(() =>
      as(actor).getAdoptionListingForOwner({ adoptionListingId: adoptionId })
    ),
    unlessForbidden(() =>
      as(actor).listApplicationsForAdoptionListing({
        adoptionListingId: adoptionId,
      })
    ),
  ]);
  // An animal reached through another listing's address is not this one's.
  if (!owned?.ok || owned.listing.directory.id !== id || !result?.ok) {
    return <NotYours />;
  }
  const name = result.animal.name;

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink
        href={adoptionPath(id, adoptionId)}
        variant="quiet"
        className="-ms-5 self-start"
      >
        {t("back", { name })}
      </ButtonLink>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title", { name })}
        lead={t("lead")}
        className="wrap-anywhere"
      />
      {result.applications.length === 0 ? (
        <p className="text-ink">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {result.applications.map((application) => (
            <li key={application.id} className={CARD}>
              <div>
                <ApplicationStatusChip status={application.status} />
              </div>
              <p className="text-sm text-ink-muted">
                {t("applied", {
                  date: format.dateTime(application.createdAt, "long"),
                })}
              </p>
              {application.applicant ? (
                <ApplicantDetailsList
                  details={application.applicant}
                  name={{
                    label: t("applicant"),
                    value: application.applicant.name,
                  }}
                />
              ) : (
                <p className="text-ink">{t("hidden")}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
