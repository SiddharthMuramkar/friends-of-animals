import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { SubmitButton } from "@/components/form";
import { OutcomeNotice } from "@/components/form/outcome-notice";
import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  APP_ROUTES,
  institutionCompetitionsPath,
  newStudentPath,
  studentImportPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";
import type {
  EnrolledStudent,
  RegistrationStatus,
} from "@/server/modules/registration";

import {
  actingInstitutions,
  chooseInstitution,
} from "../../competitions/_lib/register-state";
import { withdrawStudentAction } from "./_lib/actions";
import { isStudentsOutcome } from "./_lib/student-form-state";

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("institutionRegistration.students.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/institution/registrations/[ref]">;

export default async function Page({ params, searchParams }: Props) {
  await connection();
  return (
    <Section hue="pink" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Header />
      {/* The list streams in behind this boundary. */}
      <Suspense fallback={<Loading />}>
        <Students params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

async function Header() {
  const t = await getTranslations("institutionRegistration.students");
  return (
    <PageHeader
      eyebrow={t("eyebrow")}
      tile="pink"
      title={t("title")}
      lead={t("lead")}
    />
  );
}

async function Loading() {
  const t = await getTranslations("institutionRegistration.students");
  return <p className="mt-8 text-ink-muted">{t("loading")}</p>;
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

const STATUS_TONE = {
  enrolled: "green",
  confirmed: "blue",
  withdrawn: "neutral",
  // The individual route's (#78); never on a school's list.
  pending_payment: "marigold",
} as const satisfies Record<RegistrationStatus, string>;

const param = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

async function Students({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ ref }, query, t, callout, importWords, access] = await Promise.all([
    params,
    searchParams,
    getTranslations("institutionRegistration.students"),
    getTranslations("common.callout"),
    getTranslations("studentImport"),
    as(actor).myAccess(),
  ]);

  const institutionId = chooseInstitution(
    actingInstitutions(access.grants),
    param(query.institution)
  );
  if (!institutionId) {
    return (
      <ExplainState
        className="mt-8"
        title={t("noInstitution.title")}
        back={{ href: APP_ROUTES.dashboard, label: t("noInstitution.back") }}
      >
        <p>{t("noInstitution.body")}</p>
      </ExplainState>
    );
  }
  const list = await as(actor).listEnrolledStudents({
    institutionId,
    reference: ref,
  });
  if (!list.ok) {
    return (
      <ExplainState
        className="mt-8"
        title={t("notFound.title")}
        back={{
          href: institutionCompetitionsPath(institutionId),
          label: t("notFound.back"),
        }}
      >
        <p>{t("notFound.body")}</p>
      </ExplainState>
    );
  }

  const done = isStudentsOutcome(query.done) ? query.done : undefined;
  const named = list.students.find(
    (student) => student.registrationId === param(query.student)
  );
  const outcomeMessage = !done
    ? undefined
    : done === "enrolled" || done === "enrolledIgnored"
      ? named
        ? t(`outcome.${done}`, {
            name: named.fullName,
            group: named.ageGroupLabel,
          })
        : t("outcome.enrolledElsewhere")
      : t(`outcome.${done}`);
  const success =
    done === "enrolled" || done === "enrolledIgnored" || done === "withdrawn";
  const { enrolment } = list;
  const open = enrolment === "open";

  return (
    <div className="mt-8 flex flex-col gap-8">
      <div>
        <p className="text-lead font-semibold text-ink wrap-anywhere">
          {t("for", {
            institution: list.institution.name,
            competition: list.competition.name,
          })}
        </p>
        <p className="mt-1 font-mono text-sm text-ink-muted">
          {t("reference", { reference: list.reference })}
        </p>
      </div>

      {done && outcomeMessage ? (
        <OutcomeNotice
          key={param(query.n) ?? done}
          tone={success ? "success" : "danger"}
          label={success ? callout("success") : callout("danger")}
          message={outcomeMessage}
        />
      ) : null}

      <div className="flex flex-col gap-4">
        <p className="font-semibold text-ink">
          {t("counts", {
            enrolled: list.counts.enrolled,
            confirmed: list.counts.confirmed,
            withdrawn: list.counts.withdrawn,
          })}
        </p>
        {enrolment === "open" ? (
          <div className="flex flex-wrap gap-3">
            <ButtonLink href={newStudentPath(list.reference, institutionId)}>
              {t("add")}
            </ButtonLink>
            <ButtonLink
              href={studentImportPath(list.reference, institutionId)}
              variant="secondary"
            >
              {importWords("dashboardLink")}
            </ButtonLink>
          </div>
        ) : (
          <p className="text-ink">{t(`enrolment.${enrolment}`)}</p>
        )}
      </div>

      <section aria-labelledby="students-list">
        <SectionHeading id="students-list" title={t("listTitle")} />
        {list.students.length === 0 ? (
          <p className="mt-4 text-ink-muted">{t("empty")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {list.students.map((student) => (
              <li key={student.registrationId} className={CARD}>
                <StudentCard
                  student={student}
                  withdraw={
                    open && student.status === "enrolled"
                      ? { institutionId, reference: list.reference }
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p>
        <ButtonLink
          href={institutionCompetitionsPath(institutionId)}
          variant="quiet"
          className="-ms-5"
        >
          {t("back")}
        </ButtonLink>
      </p>
    </div>
  );
}

async function StudentCard({
  student,
  withdraw,
}: {
  student: EnrolledStudent;
  withdraw: { institutionId: string; reference: string } | undefined;
}) {
  const [t, statuses] = await Promise.all([
    getTranslations("institutionRegistration.students"),
    getTranslations("registration.status"),
  ]);
  const headingId = `student-${student.registrationId}`;
  return (
    <article aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={headingId} className="text-h3 wrap-anywhere">
          {student.fullName}
        </h3>
        <Chip tone={STATUS_TONE[student.status]}>
          {statuses(student.status)}
        </Chip>
      </div>
      <p className="mt-2 text-ink">
        {t("ageGroup", { label: student.ageGroupLabel })}
      </p>
      {student.grade ? (
        <p className="mt-1 text-ink-muted wrap-anywhere">
          {t("grade", { grade: student.grade })}
        </p>
      ) : null}
      {withdraw ? (
        <form action={withdrawStudentAction} className="mt-4">
          <input
            type="hidden"
            name="institutionId"
            value={withdraw.institutionId}
          />
          <input type="hidden" name="reference" value={withdraw.reference} />
          <input
            type="hidden"
            name="registrationId"
            value={student.registrationId}
          />
          <SubmitButton variant="secondary" pendingLabel={t("withdrawing")}>
            {/* One sentence for screen readers, starting with the visible
                word (WCAG 2.5.3). */}
            <span aria-hidden="true">{t("withdraw")}</span>
            <span className="sr-only">
              {t("withdrawName", { name: student.fullName })}
            </span>
          </SubmitButton>
        </form>
      ) : null}
    </article>
  );
}
