import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { connection } from "next/server";
import { Suspense } from "react";

import { ButtonLink } from "@/components/site/button-link";
import { Chip } from "@/components/site/chip";
import { ExplainState } from "@/components/site/explain-state";
import { PageHeader, SectionHeading } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import {
  APP_ROUTES,
  conductCertificationPath,
  institutionCompetitionsPath,
  institutionRegistrationPath,
  schoolRoundPath,
  studentSubmissionPath,
} from "@/lib/app-routes";
import type {
  InstitutionSubmissions,
  RosterRow,
} from "@/server/modules/institution-submissions";

import { EntryStatusChip } from "../../../../participant/entries/_components/entry-status";
import { actingFor } from "./_lib/acting-institution";

// Render the document on each request so its scripts carry the CSP nonce
// (#65): `instant = false` lets it build with an empty static shell.
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("institutionSubmissions.roster.meta");
  return {
    title: t("title"),
    description: t("description"),
    robots: { index: false, follow: false },
  };
}

type Props = PageProps<"/institution/registrations/[ref]/submissions">;

export default async function Page(props: Props) {
  await connection();
  const t = await getTranslations("institutionSubmissions.roster");
  return (
    <Section hue="pink" tone="tint" width="prose" className="pt-10 sm:pt-14">
      <PageHeader
        eyebrow={t("eyebrow")}
        tile="pink"
        title={t("title")}
        lead={t("lead")}
      />
      <Suspense
        fallback={<p className="mt-8 text-ink-muted">{t("loading")}</p>}
      >
        <Roster {...props} />
      </Suspense>
    </Section>
  );
}

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

async function Roster({ params, searchParams }: Props) {
  const [{ ref }, query, t] = await Promise.all([
    params,
    searchParams,
    getTranslations("institutionSubmissions.roster"),
  ]);
  const { app, institutionId } = await actingFor(query.institution);
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
  const list = await app.listInstitutionSubmissions({
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
  return <RosterView list={list} />;
}

async function RosterView({ list }: { list: InstitutionSubmissions }) {
  const [t, format] = await Promise.all([
    getTranslations("institutionSubmissions.roster"),
    getFormatter(),
  ]);
  const { institutionId, reference } = list;
  return (
    <div className="mt-8 flex flex-col gap-8">
      <div>
        <p className="text-lead font-semibold text-ink wrap-anywhere">
          {t("for", {
            institution: list.institutionName,
            competition: list.competitionName,
          })}
        </p>
        <p className="mt-1 font-mono text-sm text-ink-muted">
          {t("reference", { reference })}
        </p>
        <p className="mt-3 text-ink">
          {list.gate === "open" && list.closesAt
            ? t("deadline", {
                date: format.dateTime(list.closesAt, "longDateTime"),
              })
            : list.gate === "open"
              ? null
              : t(`gate.${list.gate}`)}
        </p>
      </div>

      <section aria-labelledby="conduct-summary" className={CARD}>
        <SectionHeading id="conduct-summary" title={t("conduct.title")} />
        <p className="mt-3 text-ink">
          {list.conductCertified
            ? t("conduct.certified")
            : t("conduct.notCertified")}
        </p>
        {list.conductCertified ? null : (
          <ButtonLink
            href={conductCertificationPath(reference, institutionId)}
            variant="secondary"
            className="mt-4"
          >
            {t("conduct.link")}
          </ButtonLink>
        )}
      </section>

      <section aria-labelledby="school-round-summary" className={CARD}>
        <SectionHeading
          id="school-round-summary"
          title={t("schoolRound.title")}
        />
        <p className="mt-3 text-ink">{t("schoolRound.body")}</p>
        <ButtonLink
          href={schoolRoundPath(reference, institutionId)}
          variant="secondary"
          className="mt-4"
        >
          {t("schoolRound.link")}
        </ButtonLink>
      </section>

      <section aria-labelledby="students-entries">
        <SectionHeading id="students-entries" title={t("listTitle")} />
        <p className="mt-3 font-semibold text-ink">
          {t("counts", {
            submitted: list.counts.byStatus.submitted,
            needingUpload: list.counts.needingUpload,
            total: list.counts.total,
          })}
        </p>
        {list.rows.length === 0 ? (
          <p className="mt-4 text-ink-muted">{t("empty")}</p>
        ) : (
          <ul className="mt-5 flex flex-col gap-4">
            {list.rows.map((row) => (
              <li key={row.registrationId} className={CARD}>
                <StudentRow
                  row={row}
                  href={
                    row.registrationNumber
                      ? studentSubmissionPath(
                          reference,
                          row.registrationNumber,
                          institutionId
                        )
                      : null
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <p>
        <ButtonLink
          href={institutionRegistrationPath(reference, institutionId)}
          variant="quiet"
          className="-ms-5"
        >
          {t("back")}
        </ButtonLink>
      </p>
    </div>
  );
}

async function StudentRow({
  row,
  href,
}: {
  row: RosterRow;
  href: string | null;
}) {
  const t = await getTranslations("institutionSubmissions.roster");
  const headingId = `student-${row.registrationId}`;
  const label = row.action ? t(`action.${row.action}`) : t("action.view");
  return (
    <article aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id={headingId} className="text-h3 wrap-anywhere">
          {row.studentName}
        </h3>
        {row.status === "not_started" ? (
          <Chip>{t("noEntry")}</Chip>
        ) : (
          <EntryStatusChip status={row.status} />
        )}
      </div>
      {row.entryCode ? (
        <p className="mt-2 font-mono text-ink">
          {t("entryCode", { code: row.entryCode })}
        </p>
      ) : null}
      {row.registrationNumber ? (
        <p className="mt-1 font-mono text-sm text-ink-muted">
          {t("number", { number: row.registrationNumber })}
        </p>
      ) : null}
      {row.checking ? <p className="mt-2 text-ink">{t("checking")}</p> : null}
      {row.hold ? (
        <p className="mt-2 text-ink-muted">{t(`hold.${row.hold}`)}</p>
      ) : null}
      {href && (row.action || row.entryCode) ? (
        <ButtonLink
          href={href}
          variant={
            row.action === "submit" || row.action === "retry"
              ? "primary"
              : "secondary"
          }
          className="mt-4"
        >
          {/* One sentence for screen readers, starting with the visible
              words (WCAG 2.5.3). */}
          <span aria-hidden="true">{label}</span>
          <span className="sr-only">
            {t("actionFor", { action: label, name: row.studentName })}
          </span>
        </ButtonLink>
      ) : null}
    </article>
  );
}
