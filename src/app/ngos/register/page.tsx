import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { ListingForm } from "@/components/directory/listing-form";
import { listingFormLabels } from "@/components/directory/listing-form-labels";
import {
  EMPTY_LISTING,
  startWith,
} from "@/components/directory/listing-form-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { MY_LISTINGS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { currentActor } from "@/server/app";

import { registerListingAction } from "./_lib/actions";

// Render the document on each request so its scripts carry the CSP nonce.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("directory.register.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  await connection();
  const t = await getTranslations("directory.register");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title")}
        lead={t("lead")}
      />
      {/* Who is asking is read per request, behind this boundary. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Register />
      </Suspense>
    </Section>
  );
}

const LINK =
  "inline-flex min-h-11 items-center font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

async function Register() {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const t = await getTranslations("directory.register");
  const labels = await listingFormLabels({
    submit: t("submit"),
    submitting: t("submitting"),
  });
  return (
    <div className="mt-8 flex flex-col gap-6">
      <p className="max-w-prose text-ink">{t("next")}</p>
      <ListingForm
        action={registerListingAction}
        start={startWith(EMPTY_LISTING)}
        labels={labels}
        alertExtra={{
          already_registered: (
            <p>
              <SiteLink href={MY_LISTINGS} className={LINK}>
                {t("myListings")}
              </SiteLink>
            </p>
          ),
        }}
      />
    </div>
  );
}
