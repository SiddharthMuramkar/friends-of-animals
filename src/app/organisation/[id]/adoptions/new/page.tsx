import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { adoptionsPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { INDIAN_STATES } from "@/server/modules/adoption/domain/details";

import { AnimalForm } from "../_components/animal-form";
import { animalFormLabels } from "../_components/animal-form-labels";
import { NotYours, unlessForbidden } from "../_components/forbidden";
import { createAnimalAction } from "../_lib/actions";
import { EMPTY_ANIMAL, startWith } from "../_lib/form-state";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoption.manage.new.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/organisation/[id]/adoptions/new">;

export default async function Page({ params }: Props) {
  const t = await getTranslations("adoption.manage");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <New params={params} />
      </Suspense>
    </Section>
  );
}

/** The state key for a directory listing's free-text state, if one matches. */
function stateKeyOf(state: string): string {
  const wanted = state.trim().toLowerCase();
  return INDIAN_STATES.find((s) => s.name.toLowerCase() === wanted)?.key ?? "";
}

async function New({ params }: Pick<Props, "params">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ id }, t, list] = await Promise.all([
    params,
    getTranslations("adoption.manage.new"),
    getTranslations("adoption.manage.list"),
  ]);
  const result = await unlessForbidden(() =>
    as(actor).listAdoptionListings({ directoryListingId: id })
  );
  if (!result?.ok) return <NotYours />;
  const { directory } = result;
  if (!directory.verified) redirect(adoptionsPath(directory.id));

  const labels = await animalFormLabels({
    submit: t("submit"),
    submitting: t("submitting"),
  });
  return (
    <>
      <ButtonLink
        href={adoptionsPath(directory.id)}
        variant="quiet"
        className="-ms-5 mb-4"
      >
        {list("title", { name: directory.name })}
      </ButtonLink>
      <PageHeader
        eyebrow={list("eyebrow")}
        tile="green"
        title={t("title")}
        lead={t("lead")}
      />
      <div className="mt-8">
        <AnimalForm
          action={createAnimalAction}
          start={startWith({
            ...EMPTY_ANIMAL,
            // Where the organisation works, to start with.
            state: stateKeyOf(directory.state),
            city: directory.city,
            pinCode: directory.pinCode,
          })}
          labels={labels}
          hidden={{ directoryListingId: directory.id }}
        />
      </div>
    </>
  );
}
