import { CalendarDays } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";

import { Placeholder } from "@/components/site/placeholder";
import { SampleTag } from "@/components/site/sample-tag";
import type { Competition } from "@/content/sample/model";
import { ageRange, feeDisplay, nextKeyDate } from "@/content/sample/selectors";
import { slugHref } from "@/lib/routes";
import { placeholder } from "@/lib/site";
import { cn } from "@/lib/utils";

import { CardCover, CardCredit } from "./card-cover";
import { cachedNow } from "./clock";
import { H, type HeadingLevel } from "./heading";
import { StatusChip } from "./status-chip";

/**
 * A competition card with the listing fields: cover, name, theme,
 * disciplines, ages, next key date, ways in, fee and status. Sample content
 * only for now, so it always carries the Sample tag.
 */
export async function CompetitionCard({
  competition: c,
  headingLevel = 3,
  sizes = "(min-width: 1024px) 380px, (min-width: 640px) 45vw, 92vw",
  className,
}: {
  competition: Competition;
  headingLevel?: HeadingLevel;
  sizes?: string;
  className?: string;
}) {
  const t = await getTranslations("showcase.competition");
  const ts = await getTranslations("sample");
  const format = await getFormatter();
  const now = new Date(await cachedNow());
  const next = nextKeyDate(c, now);
  const ages = ageRange(c);

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-3xl border-2 border-border bg-surface shadow-warm transition-[translate,border-color] duration-200 ease-out hover:border-border-strong motion-safe:hover:-translate-y-0.5 has-[a:focus-visible]:border-border-strong",
        className
      )}
    >
      <CardCover id={c.coverImageId} sizes={sizes} />
      <div className="flex flex-1 flex-col gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={c.status} />
          <SampleTag />
        </div>
        <div>
          <H level={headingLevel} className="text-h4 leading-tight text-ink">
            <Link
              href={slugHref("competition", c.slug)}
              prefetch={true}
              className="rounded-sm decoration-2 underline-offset-4 group-hover:underline after:absolute after:inset-0 after:rounded-3xl after:content-['']"
            >
              {c.name}
            </Link>
          </H>
          <p className="mt-2 text-ink-muted">{c.theme}</p>
        </div>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="font-semibold text-ink">{t("disciplines")}</dt>
          <dd className="text-ink-muted">
            {format.list(
              c.disciplines.map((d) => ts(`discipline.${d}`)),
              "and"
            )}
          </dd>
          <dt className="font-semibold text-ink">{t("ages")}</dt>
          <dd className="text-ink-muted">{t("ageRange", ages)}</dd>
          <dt className="font-semibold text-ink">{t("ways")}</dt>
          <dd className="text-ink-muted">
            {format.list(
              c.routes.map((r) => ts(`route.${r.route}`)),
              "and"
            )}
          </dd>
          <dt className="font-semibold text-ink">{t("fee")}</dt>
          <dd className="relative z-10 flex flex-wrap gap-1.5 text-ink-muted">
            {c.routes.map((r) => {
              const fee = feeDisplay(r.feeBaseMinor);
              if (fee.kind === "placeholder")
                return (
                  <Placeholder key={r.route} fact={placeholder(fee.key)} />
                );
              return (
                <span
                  key={r.route}
                  className="font-display font-semibold text-ink"
                >
                  {fee.kind === "free" ? t("free") : fee.text}
                </span>
              );
            })}
          </dd>
        </dl>
        <p className="mt-auto flex items-center gap-2 rounded-2xl bg-section-pink px-4 py-3 font-semibold text-section-pink-heading">
          <CalendarDays aria-hidden="true" className="size-5 shrink-0" />
          {next
            ? t(`keyDate.${next.kind}`, {
                date: format.dateTime(new Date(next.at), "long"),
              })
            : t("keyDate.none")}
        </p>
        <CardCredit id={c.coverImageId} />
      </div>
    </article>
  );
}
