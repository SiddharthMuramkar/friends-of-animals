import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

import type { PublicCompetition } from "@/server/modules/competitions";

const CARD =
  "rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6";

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={CARD}>
      <h2 className="text-h3">{title}</h2>
      <div className="mt-3 text-ink [&>*+*]:mt-3">{children}</div>
    </section>
  );
}

/**
 * The competition as its public page will show it. A plain stand-in until
 * 70b's shared public detail body replaces it here, so preview and page
 * can't differ.
 */
export async function CompetitionDetail({
  competition,
}: {
  competition: PublicCompetition;
}) {
  const [t, vocabulary, format] = await Promise.all([
    getTranslations("adminCompetitions.detail"),
    getTranslations("adminCompetitions.vocabulary"),
    getFormatter(),
  ]);
  const yesNo = (value: boolean) => (value ? t("yes") : t("no"));
  // A calendar date: read and shown in UTC, so no zone shifts the day.
  const cutoff = format.dateTime(
    new Date(`${competition.ageCutoffDate}T00:00:00Z`),
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }
  );
  const physical =
    competition.physicalArtwork.kind === "top_n"
      ? vocabulary("physicalArtwork.top_n", {
          count: competition.physicalArtwork.count,
        })
      : vocabulary(`physicalArtwork.${competition.physicalArtwork.kind}`);

  return (
    <div className="flex flex-col gap-6">
      <Part title={t("theme")}>
        <p className="whitespace-pre-line">{competition.theme}</p>
      </Part>
      <Part title={t("welfareMessage")}>
        <p className="whitespace-pre-line">{competition.welfareMessage}</p>
      </Part>
      <Part title={t("whoCanTakePart")}>
        <p>{vocabulary(`participation.${competition.participation}`)}</p>
      </Part>
      <Part title={t("disciplines")}>
        <ul className="list-disc pl-6">
          {competition.disciplines.map((discipline) => (
            <li key={discipline}>{vocabulary(`discipline.${discipline}`)}</li>
          ))}
        </ul>
      </Part>
      <Part title={t("ageGroups")}>
        <ul className="list-disc pl-6">
          {competition.ageGroups.map((group) => (
            <li key={group.label}>
              {t("ageGroup", {
                label: group.label,
                min: group.minAge,
                max: group.maxAge,
              })}
            </li>
          ))}
        </ul>
        <p>{t("ageCutoff", { date: cutoff })}</p>
      </Part>
      <Part title={t("categories")}>
        <ul className="list-disc pl-6">
          {competition.categories.map((category) => (
            <li key={`${category.discipline}/${category.ageGroup}`}>
              {t("category", {
                discipline: vocabulary(`discipline.${category.discipline}`),
                ageGroup: category.ageGroup,
              })}
            </li>
          ))}
        </ul>
      </Part>
      <Part title={t("keyDates")}>
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
          {competition.keyDates.map(({ kind, at }) => (
            <div key={kind} className="contents">
              <dt className="font-semibold">{vocabulary(`keyDate.${kind}`)}</dt>
              <dd>{format.dateTime(at, "longDateTime")}</dd>
            </div>
          ))}
        </dl>
      </Part>
      <Part title={t("rules")}>
        <p className="whitespace-pre-line">{competition.rules}</p>
      </Part>
      <Part title={t("permittedMaterials")}>
        <p className="whitespace-pre-line">{competition.permittedMaterials}</p>
      </Part>
      <Part title={t("duration")}>
        <p>{competition.duration}</p>
      </Part>
      <Part title={t("judging")}>
        <ul className="list-disc pl-6">
          <li>
            {t("digitalScope", {
              scope: vocabulary(`digitalScope.${competition.digitalScope}`),
            })}
          </li>
          <li>{t("shortlist", { count: competition.shortlistPerCategory })}</li>
          <li>
            {t("schoolPositions", { count: competition.schoolPositions })}
          </li>
          <li>{t("physicalArtwork", { rule: physical })}</li>
          <li>
            {t("publicDisplay", { answer: yesNo(competition.publicDisplay) })}
          </li>
          <li>
            {t("auctionPermitted", {
              answer: yesNo(competition.auctionPermitted),
            })}
          </li>
        </ul>
      </Part>
    </div>
  );
}
