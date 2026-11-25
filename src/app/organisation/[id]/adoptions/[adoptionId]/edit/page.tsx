import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { adoptionPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import { AnimalForm } from "../../_components/animal-form";
import { animalFormLabels } from "../../_components/animal-form-labels";
import { NotYours, unlessForbidden } from "../../_components/forbidden";
import { updateAnimalAction } from "../../_lib/actions";
import { startWith, valuesOf } from "../../_lib/form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoption.manage.edit.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/organisation/[id]/adoptions/[adoptionId]/edit">;

export default async function Page({ params }: Props) {
  const t = await getTranslations("adoption.manage");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Edit params={params} />
      </Suspense>
    </Section>
  );
}

async function Edit({ params }: Pick<Props, "params">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id, adoptionId }, t, manage] = await Promise.all([
    params,
    getTranslations("adoption.manage.edit"),
    getTranslations("adoption.manage"),
  ]);
  const result = await unlessForbidden(() =>
    as(actor).getAdoptionListingForOwner({ adoptionListingId: adoptionId })
  );
  if (!result?.ok || result.listing.directory.id !== id) return <NotYours />;
  const { listing } = result;
  const back = adoptionPath(listing.directory.id, listing.id);
  // Closed listings, and those of a listing that isn't verified, can't change.
  if (!listing.editable || !listing.directory.verified) redirect(back);

  const labels = await animalFormLabels({
    submit: t("submit"),
    submitting: t("submitting"),
  });
  return (
    <>
      <ButtonLink href={back} variant="quiet" className="-ms-5 mb-4">
        {manage("back")}
      </ButtonLink>
      <PageHeader
        eyebrow={(await getTranslations("adoption.manage.list"))("eyebrow")}
        tile="green"
        title={t("title", { name: listing.details.name })}
        lead={t("lead")}
        className="wrap-anywhere"
      />
      <div className="mt-8">
        <AnimalForm
          action={updateAnimalAction}
          start={startWith(valuesOf(listing.details))}
          labels={labels}
          hidden={{
            directoryListingId: listing.directory.id,
            adoptionListingId: listing.id,
          }}
        />
      </div>
    </>
  );
}
