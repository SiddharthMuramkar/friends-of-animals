import { getFormatter, getTranslations } from "next-intl/server";

import { Callout } from "@/components/site/callout";
import { PageHeader } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { SiteLink } from "@/components/site/site-link";
import { individualRegisterPath } from "@/lib/app-routes";
import { ROUTES, slugHref } from "@/lib/routes";
import { isPublicationPurpose } from "@/server/modules/consent/domain/guardian-purposes";
import type { IndividualRegistrationForm } from "@/server/modules/participants";
import { countryOptions } from "@/server/modules/participants/register-input";
import { formatPaise } from "@/server/modules/payments/domain/money-format";
import { parseIsoDate } from "@/server/modules/registration/domain/calendar-date";
import { GUARDIAN_RELATIONSHIPS } from "@/server/modules/registration/domain/student-details";

import {
  GUARDIAN_FIELDS,
  TEXT_FIELDS,
  type FormField,
} from "../_lib/form-state";
import {
  REFUSALS,
  refusalBeforeForm,
  refusalView,
  type Refusal,
} from "../_lib/refusal";
import { RegisterForm, type RegisterFormLabels } from "./register-form";

const HUE = ROUTES.participate.hue;

export async function RegistrationView({
  form,
}: {
  form: IndividualRegistrationForm;
}) {
  const [t, tp] = await Promise.all([
    getTranslations("participant.register"),
    getTranslations("participant"),
  ]);
  const competition = form.competition.name;
  const { registrant } = form;
  const title =
    registrant.kind === "child"
      ? t("titleChild", { name: registrant.fullName, competition })
      : t("title", { competition });
  const blocked =
    refusalBeforeForm(form) ??
    (form.minorRegistrationUnavailable ? "unavailable" : null);
  if (blocked) {
    return (
      <>
        <PageHeader eyebrow={t("eyebrow")} tile={HUE} title={title} />
        <Callout tone="info" className="mt-8">
          <p>
            {tp(refusalView(blocked).message as "register.refusal.not_found")}
          </p>
          <p>
            <SiteLink
              href={slugHref("competition", form.competition.slug)}
              className={inlineLink}
            >
              {t("backToCompetition", { competition })}
            </SiteLink>
          </p>
        </Callout>
        <SchoolNote />
      </>
    );
  }
  const [callout, format] = await Promise.all([
    getTranslations("common.callout"),
    getFormatter(),
  ]);
  const kept =
    registrant.kind === "own"
      ? null
      : {
          summary: t("kept", {
            name: registrant.fullName,
            date: bornOn(format, registrant.dateOfBirth),
          }),
          note: t(registrant.kind === "child" ? "keptNoteChild" : "keptNote"),
        };
  const lead =
    registrant.kind === "child"
      ? t("leadChild", { name: registrant.fullName })
      : registrant.kind === "linked"
        ? t("leadLinked")
        : t("lead");
  const fee =
    form.fee === null
      ? null
      : form.fee.amountMinor === 0n
        ? t("free")
        : t("fee", { amount: formatPaise(form.fee.amountMinor) });

  const labels: RegisterFormLabels = {
    fields: {
      fullName: t("fields.fullName"),
      dateOfBirth: t("fields.dateOfBirth"),
      phone: t("fields.phone"),
      pinCode: t("fields.pinCode"),
      city: t("fields.city"),
      state: t("fields.state"),
      country: t("fields.country"),
      schoolName: t("fields.schoolName"),
      consents: t("fields.consents"),
    },
    hints: {
      ...(form.allowsMinorRegistration
        ? { dateOfBirth: t("fields.dateOfBirthHint") }
        : {}),
      phone: t("fields.phoneHint"),
    },
    invalid: Object.fromEntries(
      [...TEXT_FIELDS, ...GUARDIAN_FIELDS, "consents"].map((field) => [
        field,
        t(`invalid.${field}` as `invalid.fullName`),
      ])
    ) as Record<FormField, string>,
    refusals: Object.fromEntries(
      REFUSALS.map((refusal) => [
        refusal,
        tp(refusalView(refusal).message as "register.refusal.not_found"),
      ])
    ) as Record<Refusal, string>,
    documents: form.documents.map((document) => ({
      documentId: document.documentId,
      label:
        document.purpose === "participation"
          ? t("participationConsent")
          : isPublicationPurpose(document.purpose)
            ? t(`publicationConsent.${document.purpose}`)
            : t("consent", { title: document.title }),
      link: t("consentLink", { title: document.title }),
      href: document.href,
    })),
    countries: countryOptions(),
    countryPlaceholder: t("countryPlaceholder"),
    guardian: {
      legend: t("guardian.legend"),
      lead: t("guardian.lead"),
      fields: {
        guardianName: t("guardian.fullName"),
        guardianRelationship: t("guardian.relationship"),
        guardianEmail: t("guardian.email"),
      },
      emailHint: t("guardian.emailHint"),
      relationships: GUARDIAN_RELATIONSHIPS.map((value) => ({
        value,
        label: t(`guardian.relationships.${value}`),
      })),
      relationshipPlaceholder: t("guardian.relationshipPlaceholder"),
    },
    problems: t("problems"),
    unexpected: t("unexpected"),
    submit: t("submit"),
    submitting: t("submitting"),
    dashboardLink: t("dashboardLink"),
    registered: t("registered"),
    continueLink: t("continueLink"),
    problem: callout("danger"),
    success: callout("success"),
  };

  return (
    <>
      <PageHeader eyebrow={t("eyebrow")} tile={HUE} title={title} lead={lead} />
      {registrant.kind === "own" && registrant.children.length > 0 ? (
        form.allowsMinorRegistration ? (
          <Chooser
            slug={form.competition.slug}
            childrenToRegister={registrant.children}
          />
        ) : (
          <Callout tone="info" className="mt-8">
            <p>{t("refusal.unavailable")}</p>
          </Callout>
        )
      ) : null}
      {registrant.kind === "child" ? null : <SchoolNote />}
      {fee ? (
        <p className="mt-6 text-lead font-semibold text-ink">{fee}</p>
      ) : null}
      <div className="mt-8">
        <RegisterForm
          competitionSlug={form.competition.slug}
          forChildId={registrant.kind === "child" ? registrant.childId : null}
          kept={kept}
          labels={labels}
        />
      </div>
    </>
  );
}

/** A profile's date of birth, as the person reads it. */
function bornOn(
  format: Awaited<ReturnType<typeof getFormatter>>,
  dateOfBirth: string
): string {
  const born = parseIsoDate(dateOfBirth);
  if (!born) return dateOfBirth;
  return format.dateTime(
    new Date(Date.UTC(born.year, born.month - 1, born.day)),
    { dateStyle: "long", timeZone: "UTC" }
  );
}

/** A guardian may register one of their children instead (#81). */
async function Chooser({
  slug,
  childrenToRegister,
}: {
  slug: string;
  childrenToRegister: { id: string; fullName: string }[];
}) {
  const t = await getTranslations("participant.register.chooser");
  return (
    <nav
      aria-labelledby="register-a-child"
      className="mt-8 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
    >
      <h2 id="register-a-child" className="text-lead font-bold text-ink">
        {t("title")}
      </h2>
      <p className="mt-2 text-ink-muted">{t("body")}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {childrenToRegister.map((child) => (
          <li key={child.id}>
            <SiteLink
              href={`${individualRegisterPath(slug)}?child=${encodeURIComponent(child.id)}`}
              className={inlineLink}
            >
              {t("child", { name: child.fullName })}
            </SiteLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The "enter through your school" note, as on the chooser. */
async function SchoolNote() {
  const note = await getTranslations("participant.schoolNote");
  return (
    <div className="mt-8 rounded-3xl border-2 border-green-700 bg-surface p-5 shadow-warm sm:p-6 dark:border-green-400">
      <h2 id="school-note" className="text-lead font-bold text-ink">
        {note("title")}
      </h2>
      <p className="mt-2 text-ink-muted">{note("body")}</p>
      <p className="mt-2 text-ink-muted">{note("ask")}</p>
      <p className="mt-2">
        <SiteLink href={ROUTES.schools.path} className={inlineLink}>
          {note("link")}
        </SiteLink>
      </p>
    </div>
  );
}
