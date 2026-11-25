import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { SiteLink } from "@/components/site/site-link";
import { APP_ROUTES, entryDetailPath } from "@/lib/app-routes";
import type { Discipline } from "@/server/modules/competitions/domain/vocabulary";
import { formatOf } from "@/server/modules/entries/rules";

import { EntryStatusChip } from "./_components/entry-status";
import { readParticipantEntries } from "./_lib/read";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("entries");
  return { title: t("list.title"), robots: { index: false, follow: false } };
}

export default async function EntriesPage() {
  const [entries, t] = await Promise.all([
    readParticipantEntries((app) => app.listMyEntries()),
    getTranslations("entries"),
  ]);
  const replacementChecking = (discipline: Discipline) => {
    const format = formatOf(discipline);
    return format === "video" || format === "essay"
      ? t(`outcomeFormat.${format}.replacementChecking`)
      : t("outcome.replacementChecking");
  };
  return (
    <Section width="prose" className="pt-10 sm:pt-14">
      <PageHeader title={t("list.title")} />
      <ButtonLink
        href={APP_ROUTES.participant}
        variant="secondary"
        className="mt-4"
      >
        {t("backToCompetitions")}
      </ButtonLink>
      {entries.length === 0 ? (
        <p className="mt-8 text-ink-muted">{t("list.empty")}</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {entries.map((entry) => (
            <li
              key={entry.code}
              className="rounded-3xl border-2 border-border bg-surface p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-h4 leading-tight wrap-anywhere">
                  <SiteLink
                    href={entryDetailPath(entry.code)}
                    className="text-link underline underline-offset-4"
                  >
                    {entry.title}
                  </SiteLink>
                </h2>
                <EntryStatusChip
                  status={entry.status}
                  format={formatOf(entry.discipline) ?? "image"}
                />
              </div>
              <p className="mt-2 text-ink">{entry.competition.name}</p>
              <p className="text-sm font-semibold text-ink-muted">
                {entry.code}
              </p>
              {entry.whose === "child" ? (
                <p className="mt-2 text-sm text-ink-muted">
                  {t("forChild", { name: entry.participantName })}
                </p>
              ) : null}
              {entry.checking && entry.status === "submitted" ? (
                <p className="mt-2 text-sm text-ink-muted">
                  {replacementChecking(entry.discipline)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
