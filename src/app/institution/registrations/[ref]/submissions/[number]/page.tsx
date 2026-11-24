import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  APP_ROUTES,
  institutionSubmissionsPath,
  studentSubmissionPath,
} from "@/lib/app-routes";
import { uploadRuleFor } from "@/server/modules/entries/rules";
import type { StudentSubmission } from "@/server/modules/institution-submissions";

import { EntryStatusChip } from "../../../../../participant/entries/_components/entry-status";
import { EntryUpload } from "../../../../../participant/entries/_components/entry-upload";
import { actingFor } from "../_lib/acting-institution";

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("institutionSubmissions.student");
  return { title: t("meta"), robots: { index: false, follow: false } };
}

type Props = PageProps<"/institution/registrations/[ref]/submissions/[number]">;

export default async function Page(props: Props) {
  await connection();
  const t = await getTranslations("institutionSubmissions.student");
  return (
    <Section hue="pink" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Student {...props} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Student({ params, searchParams }: Props) {
  const [{ ref, number }, query, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("institutionSubmissions.student"),
  ]);
  const { app, institutionId } = await actingFor(query.institution);
  const page = institutionId
    ? await app.getStudentSubmission({
        institutionId,
        reference: ref,
        registrationNumber: number,
      })
    : null;
  if (!institutionId || !page?.ok) {
    return (
      <>
        <PageHeader
          eyebrow={t("eyebrow")}
          tile="pink"
          title={t("notFound.title")}
          lead={t("notFound.body")}
        />
        <ButtonLink
          href={
            institutionId
              ? institutionSubmissionsPath(ref, institutionId)
              : APP_ROUTES.dashboard
          }
          variant="secondary"
          className="mt-6"
        >
          {t("back")}
        </ButtonLink>
      </>
    );
  }
  return <StudentView page={page} institutionId={institutionId} />;
}

async function StudentView({
  page,
  institutionId,
}: {
  page: StudentSubmission;
  institutionId: string;
}) {
  const [t, entries, format] = await Promise.all([
    getTranslations("institutionSubmissions.student"),
    getTranslations("entries"),
    getFormatter(),
  ]);
  const { entry, upload, hold, student } = page;
  const checking =
    entry?.latestUpload === "pending" || entry?.latestUpload === "processing";
  const backHref = institutionSubmissionsPath(page.reference, institutionId);
  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="pink"
        title={student.name}
        lead={t("for", {
          institution: page.institutionName,
          competition: page.competitionName,
        })}
      />
      <p className="mt-3 font-mono text-sm text-ink-muted">
        {t("number", { number: student.registrationNumber })}
      </p>
      <ButtonLink href={backHref} variant="secondary" className="mt-4">
        {t("back")}
      </ButtonLink>

      <div className={`mt-6 ${CARD}`}>
        {entry ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <dl>
                <dt className="text-sm text-ink-muted">{t("code")}</dt>
                <dd className="font-mono font-semibold text-ink">
                  {entry.code}
                </dd>
              </dl>
              <EntryStatusChip status={entry.status} />
            </div>
            <h2 className="mt-4 text-h3 wrap-anywhere">{entry.title}</h2>
            <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-ink">
              {entry.description}
            </p>
            {entry.statement ? (
              <div className="mt-4">
                <h3 className="text-h4">{t("statement")}</h3>
                <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-ink">
                  {entry.statement}
                </p>
              </div>
            ) : null}
            {entry.picture ? (
              // oxlint-disable-next-line nextjs/no-img-element -- The browser fetches the already-resized private derivative with its signed URL.
              <img
                src={entry.picture.url}
                alt={t("pictureAlt", { title: entry.title })}
                width={entry.picture.width}
                height={entry.picture.height}
                referrerPolicy="no-referrer"
                className="mt-4 h-auto max-w-full rounded-2xl"
              />
            ) : (
              <p className="mt-4 text-sm text-ink-muted">
                {t("pictureUnavailable")}
              </p>
            )}
            {entry.submittedAt ? (
              <p className="mt-4 text-sm text-ink-muted">
                {t("submittedOn", {
                  date: format.dateTime(entry.submittedAt, {
                    dateStyle: "long",
                    timeZone: "Asia/Kolkata",
                  }),
                })}
              </p>
            ) : null}
            {entry.latestUpload ? (
              <div className="mt-4 text-ink">
                <p>{entries(`outcome.${entry.latestUpload}`)}</p>
                {entry.status === "submitted" ? (
                  <p className="mt-2">
                    {entries(
                      checking
                        ? "outcome.replacementChecking"
                        : "outcome.replacementRefused"
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-ink">{t("noEntry")}</p>
        )}
      </div>

      {upload ? (
        <section aria-labelledby="student-upload-heading" className="mt-8">
          <h2 id="student-upload-heading" className="text-h3">
            {t(`upload.${upload.mode}`)}
          </h2>
          {page.closesAt ? (
            <p className="mt-2 text-ink-muted">
              {entries("deadline", {
                date: format.dateTime(page.closesAt, "longDateTime"),
              })}
            </p>
          ) : null}
          {upload.mode === "replace" ? (
            <p className="mt-2 text-ink-muted">{t("replaceHint")}</p>
          ) : null}
          <EntryUpload
            registrationId={student.registrationId}
            options={upload.disciplines.map((value) => ({
              value,
              rule: uploadRuleFor(value)!,
            }))}
            mode={upload.mode}
            {...(entry
              ? {
                  text: {
                    title: entry.title,
                    description: entry.description,
                    statement: entry.statement,
                  },
                }
              : {})}
            doneHref={studentSubmissionPath(
              page.reference,
              student.registrationNumber,
              institutionId
            )}
          />
        </section>
      ) : hold ? (
        <p className="mt-8 text-ink">{t(`hold.${hold}`)}</p>
      ) : null}
    </>
  );
}
