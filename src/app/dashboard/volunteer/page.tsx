import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import {
  LegalSectionsText,
  LegalShortList,
} from "@/components/legal/legal-text";
import { Chip } from "@/components/site/chip";
import { Disclosure } from "@/components/site/disclosure";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { inlineLink } from "@/components/site/link-styles";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES } from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type { PublishedConsentDocument } from "@/server/modules/consent/documents";
import type {
  DeclarationKey,
  MyVolunteerApplication,
} from "@/server/modules/volunteers";
import {
  AVAILABILITY_NOTE_MAX_LENGTH,
  DAY_PARTS,
  VOLUNTEER_INTERESTS,
  WEEKDAYS,
} from "@/server/modules/volunteers/domain/application-input";

import { ApplicationSummary } from "@/components/volunteers/application-summary";
import { ApplyForm, type ApplyFormLabels } from "./_components/apply-form";
import { acceptDeclarationsAction, withdrawAction } from "./_lib/actions";
import type { ApplyProblem } from "./_lib/form-state";

// A member's volunteering (#123): their application and where it stands,
// or the form to apply, while FOA takes applications. A 14- to 17-year-old
// applies with a verified guardian, who approves first. Whoever has an open
// application can withdraw it, and accepts a declaration again here when
// staff publish a newer version.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("volunteer.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

const HUE = "green";

const CARD =
  "flex flex-col gap-4 rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

export default async function Page({
  searchParams,
}: PageProps<"/dashboard/volunteer">) {
  const t = await getTranslations("volunteer");
  return (
    <Section hue={HUE} tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile={HUE}
        title={t("title")}
        lead={t("lead")}
      />
      {/* The member and their application are request data. */}
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Volunteering searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const OUTCOMES = [
  "applied",
  "awaiting_guardian",
  "accepted",
  "withdrawn",
  "declarations_required",
  "declaration_outdated",
  "declaration_unpublished",
  "no_open_application",
  "invalid_transition",
  "invalid_input",
] as const;
type Outcome = (typeof OUTCOMES)[number];
const SUCCESSES: ReadonlySet<Outcome> = new Set([
  "applied",
  "awaiting_guardian",
  "accepted",
  "withdrawn",
]);

function outcomeOf(value: unknown): Outcome | null {
  return OUTCOMES.find((outcome) => outcome === value) ?? null;
}

const PROBLEMS: readonly ApplyProblem[] = [
  "invalid_input",
  "declarations_required",
  "applications_closed",
  "date_of_birth_required",
  "already_volunteer",
  "application_open",
  "under_min_age",
  "guardian_required",
  "declaration_unpublished",
  "declaration_outdated",
  "unexpected",
];

/** A declaration's short points and full text, as the member reads it. */
function DeclarationText({
  id,
  document,
  readFull,
}: {
  id: string;
  document: PublishedConsentDocument;
  readFull: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lead font-bold text-ink">{document.title}</h3>
      <LegalShortList
        id={id}
        points={document.body.short}
        className="list-disc space-y-1 pl-5 text-ink"
      />
      <Disclosure summary={readFull} className="rounded-2xl">
        <LegalSectionsText sections={document.body.sections} level="h4" />
      </Disclosure>
    </div>
  );
}

async function Volunteering({
  searchParams,
}: {
  searchParams: PageProps<"/dashboard/volunteer">["searchParams"];
}) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, callout, query, mine] = await Promise.all([
    getTranslations("volunteer"),
    getTranslations("common.callout"),
    searchParams,
    as(actor).myVolunteerApplication(),
  ]);
  const done = outcomeOf(query.done);
  const { application } = mine;
  const open =
    application?.status === "awaiting_guardian" ||
    application?.status === "submitted";

  return (
    <div className="mt-8 flex flex-col gap-8">
      {done ? (
        <OutcomeNotice
          key={typeof query.n === "string" ? query.n : done}
          tone={SUCCESSES.has(done) ? "success" : "danger"}
          label={SUCCESSES.has(done) ? callout("success") : callout("danger")}
          message={t(`outcome.${done}`)}
        />
      ) : null}

      {mine.isVolunteer ? (
        <section aria-labelledby="volunteer-role" className={CARD}>
          <div className="flex flex-wrap items-center gap-3">
            <SectionHeading id="volunteer-role" title={t("role.title")} />
            <Chip tone="green">{t("role.chip")}</Chip>
          </div>
          <p className="text-ink">{t("role.body")}</p>
        </section>
      ) : null}

      {application ? (
        <section aria-labelledby="my-application" className={CARD}>
          <SectionHeading id="my-application" title={t("application.title")} />
          <ApplicationSummary application={application} audience="self" />
          {open ? (
            <form action={withdrawAction.bind(null, application.id)}>
              <SubmitButton
                variant="secondary"
                pendingLabel={t("application.withdrawing")}
              >
                {t("application.withdraw")}
              </SubmitButton>
            </form>
          ) : null}
        </section>
      ) : null}

      {open && application ? (
        <Reaccept
          documents={mine.documents}
          standing={application.declarations}
        />
      ) : null}

      {!mine.isVolunteer && !open ? <Apply mine={mine} /> : null}

      <p>
        <SiteLink href={APP_ROUTES.dashboard} className={inlineLink}>
          {t("back")}
        </SiteLink>
      </p>
    </div>
  );
}

/**
 * When staff published a newer declaration while the application is open:
 * a community manager approves only on current versions.
 */
async function Reaccept({
  documents,
  standing,
}: {
  documents: MyVolunteerApplication["documents"];
  standing: Record<DeclarationKey, "current" | "outdated" | "missing">;
}) {
  const { safeguarding, conduct } = documents;
  if (
    !safeguarding ||
    !conduct ||
    (standing.safeguarding === "current" && standing.conduct === "current")
  ) {
    return null;
  }
  const t = await getTranslations("volunteer");
  return (
    <section aria-labelledby="reaccept" className={CARD}>
      <SectionHeading id="reaccept" title={t("reaccept.title")} />
      <p className="text-ink">{t("reaccept.body")}</p>
      <form action={acceptDeclarationsAction} className="flex flex-col gap-5">
        {(
          [
            ["safeguarding", safeguarding, "safeguardingDocumentId"],
            ["conduct", conduct, "conductDocumentId"],
          ] as const
        ).map(([key, document, name]) => (
          <div key={key} className="flex flex-col gap-3">
            <DeclarationText
              id={`reaccept-${key}-points`}
              document={document}
              readFull={t("form.declarations.readFull", {
                version: document.version,
              })}
            />
            <label className="flex min-h-11 items-start gap-3 font-semibold text-ink">
              <input
                type="checkbox"
                name={name}
                value={document.id}
                required
                className="mt-0.5 size-6 shrink-0 accent-primary"
              />
              <span className="min-w-0">{t(`form.declarations.${key}`)}</span>
            </label>
          </div>
        ))}
        <div>
          <SubmitButton pendingLabel={t("reaccept.submitting")}>
            {t("reaccept.submit")}
          </SubmitButton>
        </div>
      </form>
    </section>
  );
}

/** The form, or why applying isn't possible now. */
async function Apply({ mine }: { mine: MyVolunteerApplication }) {
  const [t, interestWords, format] = await Promise.all([
    getTranslations("volunteer"),
    getTranslations("volunteer.interests"),
    getFormatter(),
  ]);
  const { safeguarding, conduct } = mine.documents;
  if (!mine.applicationsOpen || !safeguarding || !conduct) {
    return (
      <ExplainState title={t("closed.title")} headingLevel="h2">
        <p>{t("closed.body")}</p>
      </ExplainState>
    );
  }
  // Weekday names from the formatter: 3 to 9 January 2023 is a Monday to
  // a Sunday.
  const days = WEEKDAYS.map((value, index) => ({
    value,
    label: format.dateTime(new Date(Date.UTC(2023, 0, 2 + index, 12)), {
      weekday: "long",
      timeZone: "UTC",
    }),
  }));
  const labels: ApplyFormLabels = {
    problem: (await getTranslations("common.callout"))("danger"),
    problems: Object.fromEntries(
      PROBLEMS.map((problem) => [problem, t(`form.problems.${problem}`)])
    ) as Record<ApplyProblem, string>,
    interests: {
      legend: t("form.interests.legend"),
      hint: t("form.interests.hint"),
      error: t("form.interests.error"),
    },
    availability: {
      legend: t("form.availability.legend"),
      hint: t("form.availability.hint"),
      error: t("form.availability.error"),
      note: {
        label: t("form.availability.note.label"),
        hint: t("form.availability.note.hint", {
          max: AVAILABILITY_NOTE_MAX_LENGTH,
        }),
      },
    },
    dateOfBirth: {
      label: t("form.dateOfBirth.label"),
      hint: t("form.dateOfBirth.hint"),
    },
    declarations: {
      legend: t("form.declarations.legend"),
      hint: t("form.declarations.hint"),
      error: t("form.declarations.error"),
    },
    submit: t("form.submit"),
    submitting: t("form.submitting"),
  };
  return (
    <section aria-labelledby="apply-title" className={CARD}>
      <SectionHeading id="apply-title" title={t("form.title")} />
      <p className="text-ink">{t("form.lead")}</p>
      <ApplyForm
        interests={VOLUNTEER_INTERESTS.map((value) => ({
          value,
          label: interestWords(value),
        }))}
        days={days}
        parts={DAY_PARTS.map((value) => ({
          value,
          label: t(`form.availability.parts.${value}`),
        }))}
        asksDateOfBirth={mine.asksDateOfBirth}
        noteMaxLength={AVAILABILITY_NOTE_MAX_LENGTH}
        declarations={[
          {
            name: "safeguardingDocumentId",
            documentId: safeguarding.id,
            label: t("form.declarations.safeguarding"),
            content: (
              <DeclarationText
                id="safeguarding-points"
                document={safeguarding}
                readFull={t("form.declarations.readFull", {
                  version: safeguarding.version,
                })}
              />
            ),
          },
          {
            name: "conductDocumentId",
            documentId: conduct.id,
            label: t("form.declarations.conduct"),
            content: (
              <DeclarationText
                id="conduct-points"
                document={conduct}
                readFull={t("form.declarations.readFull", {
                  version: conduct.version,
                })}
              />
            ),
          },
        ]}
        labels={labels}
      />
    </section>
  );
}
