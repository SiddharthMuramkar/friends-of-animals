import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  APP_ROUTES,
  institutionCompetitionsPath,
  institutionRegistrationPath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { as, currentActor } from "@/server/app";

import {
  actingInstitutions,
  chooseInstitution,
} from "../../../../competitions/_lib/register-state";
import { ageRange, calendarDateInstant } from "../../_lib/student-form-state";
import {
  StudentForm,
  type StudentFormLabels,
} from "./_components/student-form";

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("institutionRegistration.newStudent.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/institution/registrations/[ref]/students/new">;

export default async function Page({ params, searchParams }: Props) {
  await connection();
  const t = await getTranslations("institutionRegistration.newStudent");
  return (
    <Section hue="pink" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <NewStudent params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const param = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

async function NewStudent({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ ref }, query, t, students, callout, format, access] =
    await Promise.all([
      params,
      searchParams,
      getTranslations("institutionRegistration.newStudent"),
      getTranslations("institutionRegistration.students"),
      getTranslations("common.callout"),
      getFormatter(),
      as(actor).myAccess(),
    ]);

  const institutionId = chooseInstitution(
    actingInstitutions(access.grants),
    param(query.institution)
  );
  const list = institutionId
    ? await as(actor).listEnrolledStudents({ institutionId, reference: ref })
    : undefined;
  if (!institutionId || !list) {
    return (
      <ExplainState
        title={students("noInstitution.title")}
        back={{
          href: APP_ROUTES.dashboard,
          label: students("noInstitution.back"),
        }}
      >
        <p>{students("noInstitution.body")}</p>
      </ExplainState>
    );
  }
  if (!list.ok) {
    return (
      <ExplainState
        title={students("notFound.title")}
        back={{
          href: institutionCompetitionsPath(institutionId),
          label: students("notFound.back"),
        }}
      >
        <p>{students("notFound.body")}</p>
      </ExplainState>
    );
  }

  const backToStudents = institutionRegistrationPath(
    list.reference,
    institutionId
  );
  const range = ageRange(list.competition.ageGroups);
  const labels: StudentFormLabels = {
    student: t("student"),
    fullName: { label: t("fullName.label"), hint: t("fullName.hint") },
    dateOfBirth: { label: t("dateOfBirth.label") },
    grade: { label: t("grade.label"), hint: t("grade.hint") },
    studentRef: { label: t("studentRef.label"), hint: t("studentRef.hint") },
    guardian: { title: t("guardian.title"), hint: t("guardian.hint") },
    guardianName: { label: t("guardianName.label") },
    guardianRelationship: {
      legend: t("guardianRelationship.legend"),
      parent: t("guardianRelationship.parent"),
      legal_guardian: t("guardianRelationship.legal_guardian"),
    },
    guardianPhone: {
      label: t("guardianPhone.label"),
      hint: t("guardianPhone.hint"),
    },
    guardianEmail: { label: t("guardianEmail.label") },
    self: { title: t("self.title"), hint: t("self.hint") },
    phone: { label: t("phone.label"), hint: t("phone.hint") },
    email: { label: t("email.label") },
    location: { title: t("location.title"), hint: t("location.hint") },
    address: { label: t("address.label") },
    pinCode: { label: t("pinCode.label") },
    city: { label: t("city.label") },
    state: { label: t("state.label") },
    submit: t("submit"),
    submitting: t("submitting"),
    problem: callout("danger"),
  };

  return (
    <div className="flex flex-col gap-8">
      <ButtonLink
        href={backToStudents}
        variant="quiet"
        className="-ms-5 self-start"
      >
        {t("back")}
      </ButtonLink>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="pink"
        title={t("title")}
        lead={t("lead", { competition: list.competition.name })}
      />
      {range ? (
        <p className="font-semibold text-ink">
          {t("ages", {
            minAge: range.minAge,
            maxAge: range.maxAge,
            cutoff: format.dateTime(
              calendarDateInstant(list.competition.ageCutoffDate),
              "long"
            ),
          })}
        </p>
      ) : null}
      {list.enrolment === "open" ? (
        <StudentForm
          institutionId={institutionId}
          reference={list.reference}
          labels={labels}
        />
      ) : (
        <ExplainState
          title={t("cannotAdd")}
          back={{ href: backToStudents, label: t("back") }}
        >
          <p>{students(`enrolment.${list.enrolment}`)}</p>
        </ExplainState>
      )}
    </div>
  );
}
