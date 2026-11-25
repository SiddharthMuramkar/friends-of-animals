import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { Correction } from "@/app/_components/verification/correction";
import { PARTICIPANT_ENTRIES, entryDetailPath } from "@/lib/app-routes";
import { essayBodyText } from "@/server/rich-text/essay";

import { EntryStatusChip } from "../_components/entry-status";
import { EntryUpload } from "../_components/entry-upload";
import { EssayText } from "../_components/essay-text";
import { readParticipantEntries } from "../_lib/read";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("entries");
  return { title: t("detail.meta"), robots: { index: false, follow: false } };
}

export default async function EntryPage({
  params,
  searchParams,
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
  const replacement =
    entry.status === "submitted" || entry.status === "sent_back";
  const checking =
    entry.latestUpload === "pending" || entry.latestUpload === "processing";
  const kind = entry.format;
  const outcome = (key: NonNullable<typeof entry.latestUpload>) =>
    kind === "image" ? t(`outcome.${key}`) : t(`outcomeFormat.${kind}.${key}`);
  const replacementNote = (key: "replacementChecking" | "replacementRefused") =>
    kind === "image" ? t(`outcome.${key}`) : t(`outcomeFormat.${kind}.${key}`);
  const uploadHeading = {
    image: retry ? t("detail.retry") : t("detail.replace"),
    video: retry ? t("detail.retryVideo") : t("detail.replaceVideo"),
    essay: retry ? t("detail.retryEssay") : t("detail.replaceEssay"),
  }[kind];

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
          <EntryStatusChip status={entry.status} format={kind} />
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
        {kind === "image" ? (
          entry.picture ? (
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
          ) : null
        ) : null}
        {kind === "video" ? (
          entry.video ? (
            // The transcoded copy, never the original (#86).
            // oxlint-disable-next-line jsx-a11y/media-has-caption -- A participant's own clip comes with no captions; a captions upload is a follow-up.
            <video
              controls
              playsInline
              preload="metadata"
              poster={entry.video.posterUrl ?? undefined}
              width={entry.video.width}
              height={entry.video.height}
              aria-label={t("detail.videoLabel", { title: entry.title })}
              className="mt-4 h-auto max-h-[70vh] w-full rounded-2xl bg-ink"
            >
              <source src={entry.video.url} type="video/mp4" />
              {t("detail.videoFallback")}
            </video>
          ) : replacement ? (
            <p className="mt-4 text-sm text-ink-muted">
              {t("detail.videoUnavailable")}
            </p>
          ) : null
        ) : null}
        {kind === "essay" ? (
          entry.essay?.kind === "text" ? (
            <section aria-labelledby="entry-essay-heading" className="mt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="entry-essay-heading" className="text-h4">
                  {t("detail.essay")}
                </h2>
                <p className="text-sm text-ink-muted">
                  {t("detail.wordCount", { count: entry.essay.wordCount })}
                </p>
              </div>
              <EssayText
                body={entry.essay.body}
                className="mt-2 rounded-2xl border-2 border-border p-4"
              />
            </section>
          ) : entry.essay?.kind === "document" ? (
            <p className="mt-4">
              {/* A short-lived signed URL to private storage, not a page. */}
              <a
                href={entry.essay.url}
                rel="noreferrer"
                className="text-link underline underline-offset-4"
              >
                {t("detail.openDocument")}
              </a>
            </p>
          ) : replacement ? (
            <p className="mt-4 text-sm text-ink-muted">
              {t("detail.essayUnavailable")}
            </p>
          ) : null
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
            <p>{outcome(entry.latestUpload)}</p>
            {entry.latestProblem ? (
              <p className="mt-2">{t(`problem.${entry.latestProblem}`)}</p>
            ) : null}
            {replacement ? (
              <p className="mt-2">
                {replacementNote(
                  checking ? "replacementChecking" : "replacementRefused"
                )}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <Correction
        entry={entry}
        href={entryDetailPath(entry.code)}
        canCorrect={Boolean(entry.uploadRule) && !checking}
        refused={Boolean((await searchParams).resubmitError)}
      />
      {entry.uploadRule ? (
        <section aria-labelledby="entry-upload-heading" className="mt-8">
          <h2 id="entry-upload-heading" className="text-h3">
            {uploadHeading}
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
            {...(entry.essay?.kind === "text"
              ? { essay: essayBodyText(entry.essay.body) }
              : {})}
          />
        </section>
      ) : null}
    </Section>
  );
}
