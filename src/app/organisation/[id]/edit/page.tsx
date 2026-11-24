import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ListingForm } from "@/components/directory/listing-form";
import { listingFormLabels } from "@/components/directory/listing-form-labels";
import { startWith } from "@/components/directory/listing-form-state";
import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { MY_LISTINGS, myListingPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import { DomainError } from "@/server/errors";
import type { MyListing } from "@/server/modules/directory";

import { updateListingAction } from "../../_lib/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("directory.edit.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/organisation/[id]/edit">;

export default async function Page({ params }: Props) {
  const t = await getTranslations("directory.listing");
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
  const [{ id }, t, listingWords] = await Promise.all([
    params,
    getTranslations("directory.edit"),
    getTranslations("directory.listing"),
  ]);

  let listing: MyListing;
  try {
    const result = await as(actor).getMyListing({ listingId: id });
    if (!result.ok) throw new DomainError("forbidden", "not a listing id");
    listing = result.listing;
  } catch (error) {
    if (!(error instanceof DomainError && error.code === "forbidden")) {
      throw error;
    }
    return (
      <ExplainState
        headingLevel="h1"
        title={listingWords("forbidden.title")}
        back={{ href: MY_LISTINGS, label: listingWords("forbidden.back") }}
      >
        <p>{listingWords("forbidden.body")}</p>
      </ExplainState>
    );
  }
  // Rejected, suspended and withdrawn listings can't be changed.
  if (!listing.canEdit) redirect(myListingPath(listing.id));

  const labels = await listingFormLabels({
    submit: t("submit"),
    submitting: t("submitting"),
  });
  return (
    <>
      <ButtonLink
        href={myListingPath(listing.id)}
        variant="quiet"
        className="-ms-5 mb-4"
      >
        {t("back")}
      </ButtonLink>
      <PageHeader
        eyebrow={listingWords("detailsTitle")}
        tile="green"
        title={t("title", { name: listing.name })}
        lead={t("lead")}
        className="wrap-anywhere"
      />
      <div className="mt-8">
        <ListingForm
          action={updateListingAction}
          start={startWith({
            type: listing.type,
            name: listing.name,
            description: listing.description,
            services: listing.services,
            address: listing.address,
            city: listing.city,
            state: listing.state,
            pinCode: listing.pinCode,
            contactPhone: listing.contactPhone,
            contactEmail: listing.contactEmail ?? "",
            website: listing.website ?? "",
            publicContactFields: listing.publicContactFields,
          })}
          labels={labels}
          hidden={{ listingId: listing.id }}
        />
      </div>
    </>
  );
}
