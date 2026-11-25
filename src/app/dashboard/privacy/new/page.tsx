import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
} from "@/components/form";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { MY_PRIVACY_REQUESTS } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  CORRECTION_DETAILS_MAX,
  PRIVACY_REQUEST_TYPES,
} from "@/server/modules/privacy/requests";

import { submitPrivacyRequestAction } from "../_lib/actions";
import { newRequestErrorFrom } from "../_lib/outcome";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacyRequests.new.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const LINK =
  "inline-flex min-h-11 items-center gap-2 font-semibold text-link underline decoration-2 underline-offset-4 hover:text-link-hover";

/**
 * Making a privacy request (#115): what the person wants, and whose data
 * it is about (themselves, or a child they look after as a verified
 * guardian). The use case decides who may ask for what.
 */
export default async function Page({
  searchParams,
}: PageProps<"/dashboard/privacy/new">) {
  const t = await getTranslations("privacyRequests.new");
  return (
    <Section hue="blue" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <SiteLink href={MY_PRIVACY_REQUESTS} className={LINK}>
        <ArrowLeft aria-hidden="true" className="size-5" />
        {t("back")}
      </SiteLink>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="blue"
        title={t("title")}
        lead={t("lead")}
        className="mt-4"
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <NewRequest searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function NewRequest({
  searchParams,
}: Pick<PageProps<"/dashboard/privacy/new">, "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, types, callout, subjects] = await Promise.all([
    getTranslations("privacyRequests.new"),
    getTranslations("privacyRequests.types"),
    getTranslations("common.callout"),
    as(actor).listPrivacyRequestSubjects(),
  ]);
  const error = newRequestErrorFrom(await searchParams);
  return (
    <form
      action={submitPrivacyRequestAction}
      className="mt-8 flex flex-col gap-6"
    >
      {error ? (
        <FormAlert tone="danger" label={callout("danger")}>
          <p>{t(`errors.${error}`)}</p>
        </FormAlert>
      ) : null}
      <div className="flex flex-col gap-3">
        <SelectField
          id="request-type"
          name="type"
          required
          label={t("type")}
          placeholder={t("typePlaceholder")}
          options={PRIVACY_REQUEST_TYPES.map((type) => ({
            value: type,
            label: types(type),
          }))}
        />
        <ul className="flex list-disc flex-col gap-1 ps-6 text-ink-muted">
          {PRIVACY_REQUEST_TYPES.map((type) => (
            <li key={type}>{t(`typeHints.${type}`)}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <SelectField
          id="request-subject"
          name="subject"
          required
          defaultValue="self"
          label={t("subject")}
          placeholder={t("subjectPlaceholder")}
          options={[
            { value: "self", label: t("self") },
            ...subjects.children.map((child) => ({
              value: child.id,
              label: child.name,
            })),
          ]}
        />
        <p className="text-sm text-ink-muted">{t("teenErasure")}</p>
      </div>
      <TextAreaField
        id="request-correction"
        name="correctionDetails"
        rows={4}
        maxLength={CORRECTION_DETAILS_MAX}
        label={t("correctionDetails")}
        hint={t("correctionHint")}
      />
      <div>
        <SubmitButton pendingLabel={t("pending")}>{t("submit")}</SubmitButton>
      </div>
    </form>
  );
}
