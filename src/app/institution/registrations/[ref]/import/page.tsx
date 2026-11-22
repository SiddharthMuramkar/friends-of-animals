import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { ButtonLink, buttonStyles } from "@/components/site/button-link";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { TableScroller } from "@/components/site/table-scroller";
import {
  APP_ROUTES,
  institutionCompetitionsPath,
  institutionRegistrationPath,
  studentImportFilePath,
} from "@/lib/app-routes";
import { ROUTES } from "@/lib/routes";
import { isSampleContentEnabled } from "@/lib/site";
import { cn } from "@/lib/utils";
import type { Messages } from "@/i18n/messages";
import { as, currentActor } from "@/server/app";

import {
  actingInstitutions,
  chooseInstitution,
} from "../../../competitions/_lib/register-state";
import { ageRange, calendarDateInstant } from "../_lib/student-form-state";
import { ImportForm, type ImportFormLabels } from "./_components/import-form";

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("studentImport.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/institution/registrations/[ref]/import">;

export default async function Page({ params, searchParams }: Props) {
  await connection();
  const t = await getTranslations("studentImport");
  return (
    <Section hue="pink" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense fallback={<p className="text-ink-muted">{t("loading")}</p>}>
        <StudentImport params={params} searchParams={searchParams} />
      </Suspense>
    </Section>
  );
}

const param = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

const CELL = "px-5 py-3";

/** A template column's header, as its description's message key. */
type DescribedColumn = keyof Messages["studentImport"]["columns"]["describe"];

async function StudentImport({
  params,
  searchParams,
}: Pick<Props, "params" | "searchParams">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [{ ref }, query, t, students, callout, format, access] =
    await Promise.all([
      params,
      searchParams,
      getTranslations("studentImport"),
      getTranslations("institutionRegistration.students"),
      getTranslations("common.callout"),
      getFormatter(),
      as(actor).myAccess(),
    ]);

  const institutionId = chooseInstitution(
    actingInstitutions(access.grants),
    param(query.institution)
  );
  const described = institutionId
    ? await as(actor).describeStudentImport({ institutionId, reference: ref })
    : undefined;
  if (!institutionId || !described) {
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
  if (!described.ok) {
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

  const { reference, competition, limits } = described;
  const backToStudents = institutionRegistrationPath(reference, institutionId);
  const range = ageRange(competition.ageGroups);
  const labels: ImportFormLabels = {
    file: { label: t("upload.label"), hint: t("upload.hint") },
    tooLarge: t("file.too_large", {
      maxKb: Math.floor(limits.maxBytes / 1024),
    }),
    submit: t("upload.submit"),
    submitting: t("upload.submitting"),
    problem: callout("danger"),
    success: callout("success"),
    result: {
      title: t("result.title"),
      row: t("result.row"),
      student: t("result.student"),
      problems: t("result.problems"),
      download: t("result.download"),
      downloadHint: t("result.downloadHint"),
    },
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
        lead={t("lead")}
      />
      <div>
        <p className="text-lead font-semibold text-ink wrap-anywhere">
          {t("for", {
            institution: described.institution.name,
            competition: competition.name,
          })}
        </p>
        {range ? (
          <p className="mt-1 text-ink">
            {t("ages", {
              minAge: range.minAge,
              maxAge: range.maxAge,
              cutoff: format.dateTime(
                calendarDateInstant(competition.ageCutoffDate),
                "long"
              ),
            })}
          </p>
        ) : null}
      </div>

      {described.enrolment !== "open" ? (
        <ExplainState
          title={t("cannotImport")}
          back={{ href: backToStudents, label: t("back") }}
        >
          <p>{students(`enrolment.${described.enrolment}`)}</p>
        </ExplainState>
      ) : (
        <>
          <section
            aria-labelledby="import-template"
            className="flex flex-col gap-5"
          >
            <SectionHeading id="import-template" title={t("template.title")} />
            <p className="text-ink">{t("template.body")}</p>
            <p className="text-ink">
              {t("limits", {
                maxRows: limits.maxRows,
                maxKb: Math.floor(limits.maxBytes / 1024),
              })}
            </p>
            <div className="flex flex-col items-start gap-3">
              {/* Plain links: private downloads, never prefetched. */}
              <a
                href={studentImportFilePath(
                  reference,
                  institutionId,
                  "template.csv"
                )}
                download
                className={buttonStyles({ variant: "secondary" })}
              >
                {t("template.download")}
              </a>
              {isSampleContentEnabled() ? (
                <a
                  href={studentImportFilePath(
                    reference,
                    institutionId,
                    "sample.csv"
                  )}
                  download
                  className={buttonStyles({ variant: "quiet" })}
                >
                  {t("template.sample")}
                </a>
              ) : null}
            </div>
            <TableScroller captionId="import-columns">
              <table className="w-full text-left">
                <caption
                  id="import-columns"
                  className="px-5 pt-4 text-left font-display text-lead font-semibold text-ink"
                >
                  {t("columns.caption")}
                </caption>
                <thead className="text-sm">
                  <tr>
                    <th scope="col" className={CELL}>
                      {t("columns.column")}
                    </th>
                    <th scope="col" className={CELL}>
                      {t("columns.what")}
                    </th>
                    <th scope="col" className={CELL}>
                      {t("columns.needed")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {described.columns.map((column) => (
                    <tr
                      key={column.header}
                      className="border-t border-border align-top"
                    >
                      <th scope="row" className={cn(CELL, "font-mono text-sm")}>
                        {column.header}
                      </th>
                      <td className={CELL}>
                        {t(
                          `columns.describe.${column.header as DescribedColumn}`
                        )}
                      </td>
                      <td className={CELL}>
                        {t(`columns.need.${column.need}`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroller>
          </section>

          <section
            aria-labelledby="import-upload"
            className="flex flex-col gap-5"
          >
            <SectionHeading id="import-upload" title={t("upload.title")} />
            <ImportForm
              institutionId={institutionId}
              reference={reference}
              maxBytes={limits.maxBytes}
              labels={labels}
            />
          </section>
        </>
      )}
    </div>
  );
}
