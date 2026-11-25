import { getFormatter, getTranslations } from "next-intl/server";
import { SectionHeading } from "@/components/site/heading";
import { MILESTONE_KINDS } from "@/server/modules/community/domain/milestones";
import type { getTimeline } from "@/server/modules/community/timeline";

export async function Timeline({
  data,
}: {
  data: Awaited<ReturnType<typeof getTimeline>>;
}) {
  const [t, format] = await Promise.all([
    getTranslations("community.timeline"),
    getFormatter(),
  ]);
  const earned = new Set(data.milestones.map((row) => row.kind));
  return (
    <div className="flex flex-col gap-8">
      <section
        className="rounded-3xl border-2 border-border bg-surface p-5 shadow-warm sm:p-6"
        aria-labelledby="ladder-title"
      >
        <SectionHeading id="ladder-title" title={t("ladder")} />
        <ol className="mt-5 grid gap-3 sm:grid-cols-2">
          {MILESTONE_KINDS.map((kind) => (
            <li
              key={kind}
              className="flex flex-col gap-1 rounded-2xl border border-border p-3"
            >
              <span className="font-bold text-ink">
                {t(`milestones.${kind}`)}
              </span>
              <span className="text-sm text-ink-muted">
                {earned.has(kind) ? t("earned") : t("notYet")}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section aria-labelledby="history-title">
        <SectionHeading id="history-title" title={t("history")} />
        {data.years.length === 0 ? (
          <p className="mt-4 text-ink-muted">{t("empty")}</p>
        ) : (
          data.years.map((group) => (
            <div className="mt-5" key={group.year}>
              <h3 className="text-lead font-bold text-ink">{group.year}</h3>
              <ol className="mt-3 space-y-4 border-s-2 border-border ps-4">
                {group.entries.map((row) => (
                  <li
                    key={row.id}
                    className="min-w-0 break-words rounded-2xl border border-border bg-surface p-4"
                  >
                    <time
                      className="text-sm text-ink-muted"
                      dateTime={row.occurredAt.toISOString()}
                    >
                      {format.dateTime(row.occurredAt, {
                        dateStyle: "medium",
                        timeZone: "Asia/Kolkata",
                      })}
                    </time>
                    <p className="mt-1 font-bold text-ink">
                      {t(`kinds.${row.kind}`)}
                    </p>
                    {row.competitionName ? (
                      <p className="mt-1 text-ink">{row.competitionName}</p>
                    ) : null}
                    <p className="mt-1 text-sm text-ink-muted">
                      {t(`categories.${row.category}`)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
