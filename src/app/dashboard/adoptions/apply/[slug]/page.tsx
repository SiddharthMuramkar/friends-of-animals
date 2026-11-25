import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import {
  FormAlert,
  SelectField,
  SubmitButton,
  TextAreaField,
  TextField,
} from "@/components/form";
import {
  LegalSectionsText,
  LegalShortList,
} from "@/components/legal/legal-text";
import { Disclosure } from "@/components/site/disclosure";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { myAdoptionApplicationPath } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import {
  ADDRESS_MAX_LENGTH,
  ANSWER_MAX_LENGTH,
  HOME_TYPES,
} from "@/server/modules/adoption/domain/application-input";

import { applyAction } from "../../_lib/actions";

// Applying to adopt an animal (#130): how to reach the applicant, a few
// answers about their home, their date of birth when no profile has one
// (only adults adopt), and their consent to share their contact with the
// listing organisation. A plain form posting to a Server Action: no
// script of its own. A refusal comes back here naming what to fix.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adoptionApplications.apply.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/dashboard/adoptions/apply/[slug]">;

export default async function Page(props: Props) {
  const t = await getTranslations("adoptionApplications.apply");
  return (
    <Section hue="green" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <Apply {...props} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "flex flex-col gap-5 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const PROBLEMS = [
  "invalid_input",
  "listing_not_open",
  "own_listing",
  "date_of_birth_required",
  "under_min_age",
  "already_applied",
  "consent_unpublished",
  "consent_outdated",
  "consent_required",
  "unexpected",
] as const;

async function Apply({ params, searchParams }: Props) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ slug }, query, t, callout, home] = await Promise.all([
    params,
    searchParams,
    getTranslations("adoptionApplications.apply"),
    getTranslations("common.callout"),
    getTranslations("adoptionApplications.homeType"),
  ]);
  const form = await as(actor).adoptionApplicationForm({
    slug: decodeURIComponent(slug),
  });
  if (!form.ok) {
    return (
      <ExplainState
        headingLevel="h1"
        title={t("notOpen.title")}
        back={{ href: ROUTES.adopt.path, label: t("notOpen.back") }}
      >
        <p>{t("notOpen.body")}</p>
      </ExplainState>
    );
  }
  const names = {
    name: form.animal.name,
    organisation: form.organisation.name,
  };
  const problem = PROBLEMS.find((each) => each === query.problem) ?? null;
  const fields = new Set(
    typeof query.fields === "string" ? query.fields.split(",") : []
  );
  const fieldError = (name: string) =>
    fields.has(name) ? t("form.fieldError") : undefined;
  const document = form.contactSharingDocument;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="green"
        title={t("title", names)}
        lead={t("lead", names)}
        className="wrap-anywhere"
      />
      {problem ? (
        <FormAlert tone="danger" label={callout("danger")}>
          <p>{t(`problems.${problem}`)}</p>
        </FormAlert>
      ) : null}
      {form.openApplicationId ? (
        <section aria-labelledby="already" className={CARD}>
          <SectionHeading id="already" title={t("already", names)} />
          <p>
            <SiteLink
              href={myAdoptionApplicationPath(form.openApplicationId)}
              className={inlineLink}
            >
              {t("alreadyLink")}
            </SiteLink>
          </p>
        </section>
      ) : !document ? (
        <ExplainState title={t("unpublished.title")} headingLevel="h2">
          <p>{t("unpublished.body")}</p>
        </ExplainState>
      ) : (
        <form
          action={applyAction.bind(null, form.animal.slug)}
          className="flex flex-col gap-8"
          noValidate
        >
          <section aria-labelledby="contact" className={CARD}>
            <SectionHeading id="contact" title={t("form.contact")} />
            <TextField
              id="apply-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              label={t("form.phone")}
              hint={t("form.phoneHint")}
              error={fieldError("phone")}
              required
            />
            <TextAreaField
              id="apply-address"
              name="address"
              autoComplete="street-address"
              rows={3}
              maxLength={ADDRESS_MAX_LENGTH}
              label={t("form.address")}
              hint={t("form.addressHint", names)}
              error={fieldError("address")}
              required
            />
            {form.needsDateOfBirth ? (
              <TextField
                id="apply-dob"
                name="dateOfBirth"
                type="date"
                autoComplete="bday"
                label={t("form.dateOfBirth")}
                hint={t("form.dateOfBirthHint")}
                error={fieldError("dateOfBirth")}
                required
              />
            ) : null}
          </section>

          <section aria-labelledby="home" className={CARD}>
            <SectionHeading id="home" title={t("form.home")} />
            <SelectField
              id="apply-home-type"
              name="homeType"
              label={t("form.homeType")}
              placeholder={t("form.homeType")}
              options={HOME_TYPES.map((value) => ({
                value,
                label: home(value),
              }))}
              error={fieldError("answers")}
              required
            />
            <fieldset className="flex flex-col gap-2">
              <legend className="font-semibold text-ink">
                {t("form.outdoor")}
              </legend>
              {(["yes", "no"] as const).map((value) => (
                <label
                  key={value}
                  className="flex min-h-11 items-center gap-3 text-ink"
                >
                  <input
                    type="radio"
                    name="hasOutdoorSpace"
                    value={value}
                    defaultChecked={value === "no"}
                    className="size-6 shrink-0 accent-primary"
                  />
                  <span>
                    {value === "yes"
                      ? t("form.outdoorYes")
                      : t("form.outdoorNo")}
                  </span>
                </label>
              ))}
            </fieldset>
            <TextAreaField
              id="apply-other-animals"
              name="otherAnimals"
              rows={2}
              maxLength={ANSWER_MAX_LENGTH}
              label={t("form.otherAnimals")}
              hint={t("form.otherAnimalsHint")}
            />
            <TextAreaField
              id="apply-experience"
              name="experience"
              rows={3}
              maxLength={ANSWER_MAX_LENGTH}
              label={t("form.experience")}
              hint={t("form.experienceHint")}
            />
            <TextAreaField
              id="apply-why"
              name="whyThisAnimal"
              rows={4}
              maxLength={ANSWER_MAX_LENGTH}
              label={t("form.why", names)}
              hint={t("form.whyHint")}
              error={fieldError("answers")}
              required
            />
          </section>

          <section aria-labelledby="consent" className={CARD}>
            <SectionHeading id="consent" title={t("form.consentTitle")} />
            <h3 className="text-lead font-bold text-ink">{document.title}</h3>
            <LegalShortList
              id="contact-sharing-points"
              points={document.body.short}
              className="list-disc space-y-1 pl-5 text-ink"
            />
            <Disclosure
              summary={t("form.consentReadFull", { version: document.version })}
              className="rounded-2xl"
            >
              <LegalSectionsText sections={document.body.sections} level="h4" />
            </Disclosure>
            <label className="flex min-h-11 items-start gap-3 font-semibold text-ink">
              <input
                type="checkbox"
                name="contactSharingDocumentId"
                value={document.id}
                required
                className="mt-0.5 size-6 shrink-0 accent-primary"
              />
              <span className="min-w-0">{t("form.consent", names)}</span>
            </label>
          </section>

          <div>
            <SubmitButton pendingLabel={t("form.submitting")}>
              {t("form.submit")}
            </SubmitButton>
          </div>
        </form>
      )}
    </div>
  );
}
