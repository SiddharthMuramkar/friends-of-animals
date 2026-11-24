import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { PARTICIPANT_ENTRIES } from "@/lib/app-routes";
import { isImageDiscipline } from "@/server/modules/entries/rules";

import { EntryStatusChip } from "../_components/entry-status";
import { EntryUpload } from "../_components/entry-upload";
import { readParticipantEntries } from "../_lib/read";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("entries");
  return { title: t("detail.meta"), robots: { index: false, follow: false } };
}

export default async function EntryPage({
  params,
}: PageProps<"/participant/entries/[code]">) {
  const { code } = await params;
  const [result, t, format] = await Promise.all([
    readParticipantEntries((app) => app.getEntry({ code })),
    getTranslations("entries"),
    getFormatter(),
  ]);
  if (!result.ok) notFound();
  const { entry } = result;
  const retry = entry.status === "rejected" || entry.status === "failed";
  const replacement = entry.status === "submitted";
  const checking =
    entry.latestUpload === "pending" || entry.latestUpload === "processing";

  return (
    <Section width="prose" className="pt-10 sm:pt-14">
      <PageHeader title={entry.title} lead={entry.competition.name} />
      <ButtonLink
        href={PARTICIPANT_ENTRIES}
        variant="secondary"
        className="mt-4"
      >
        {t("backToEntries")}
      </ButtonLink>
      <div className="mt-6 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <dl>
            <dt className="text-sm text-ink-muted">{t("detail.code")}</dt>
            <dd className="font-semibold text-ink">{entry.code}</dd>
          </dl>
          <EntryStatusChip status={entry.status} />
        </div>
        {entry.whose === "child" ? (
          <p className="mt-4 font-semibold text-ink">
            {t("forChild", { name: entry.participantName })}
          </p>
        ) : null}
        <p className="mt-4 whitespace-pre-wrap wrap-anywhere text-ink">
          {entry.description}
        </p>
        {entry.statement ? (
          <div className="mt-4">
            <h2 className="text-h4">{t("detail.statement")}</h2>
            <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-ink">
              {entry.statement}
            </p>
          </div>
        ) : null}
        {entry.picture ? (
          // oxlint-disable-next-line nextjs/no-img-element -- The browser fetches the already-resized private derivative with its signed URL.
          <img
            src={entry.picture.url}
            alt={t("detail.pictureAlt", { title: entry.title })}
            width={entry.picture.width}
            height={entry.picture.height}
            referrerPolicy="no-referrer"
            className="mt-4 h-auto max-w-full rounded-2xl"
          />
        ) : replacement ? (
          <p className="mt-4 text-sm text-ink-muted">
            {t("detail.pictureUnavailable")}
          </p>
        ) : null}
        {entry.submittedAt ? (
          <p className="mt-4 text-sm text-ink-muted">
            {t("detail.submittedOn", {
              date: format.dateTime(entry.submittedAt, {
                dateStyle: "long",
                timeZone: "Asia/Kolkata",
              }),
            })}
          </p>
        ) : null}
        {entry.latestUpload ? (
          <div className="mt-4 text-ink">
            <p>{t(`outcome.${entry.latestUpload}`)}</p>
            {replacement ? (
              <p className="mt-2">
                {t(
                  checking
                    ? "outcome.replacementChecking"
                    : "outcome.replacementRefused"
                )}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {entry.uploadRule && isImageDiscipline(entry.discipline) ? (
        <section aria-labelledby="entry-upload-heading" className="mt-8">
          <h2 id="entry-upload-heading" className="text-h3">
            {t(retry ? "detail.retry" : "detail.replace")}
          </h2>
          {entry.closesAt ? (
            <p className="mt-2 text-ink-muted">
              {t("deadline", {
                date: format.dateTime(entry.closesAt, "longDateTime"),
              })}
            </p>
          ) : null}
          <EntryUpload
            registrationId={entry.registrationId}
            options={[
              {
                value: entry.discipline,
                rule: entry.uploadRule,
              },
            ]}
            mode={retry ? "retry" : "replace"}
            text={{
              title: entry.title,
              description: entry.description,
              statement: entry.statement,
            }}
          />
        </section>
      ) : null}
    </Section>
  );
}
