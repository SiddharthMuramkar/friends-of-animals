import { Check, X } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { CardCover, CardCredit } from "@/components/showcase/card-cover";
import type { Neighbour } from "@/content/awareness/neighbours";

import { FlipCard } from "./flip-card";

/** One street-neighbour card: a fact on the front, good-neighbour tips behind. */
export async function NeighbourCard({ n }: { n: Neighbour }) {
  const t = await getTranslations("awareness.neighbours");
  const titleId = `neighbour-${n.id}`;

  const front = (
    <article
      aria-labelledby={titleId}
      className="flex h-full flex-col overflow-hidden rounded-3xl border-2 border-border bg-surface shadow-warm"
    >
      <CardCover
        id={n.imageId}
        sizes="(min-width: 1024px) 360px, (min-width: 640px) 46vw, 92vw"
      />
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <h3 id={titleId} className="text-h4 text-(--section-heading)">
          {n.name}
        </h3>
        <p className="text-sm text-ink-muted">
          <i lang="la">{n.latin}</i>
        </p>
        <p className="mt-4 font-hand text-lead text-teal-800 dark:text-teal-300">
          {t("didYouKnow")}
        </p>
        <p className="mt-1 font-display text-lead leading-snug font-semibold text-ink">
          {n.fact}
        </p>
        <CardCredit id={n.imageId} raised={false} className="mt-auto pt-4" />
      </div>
    </article>
  );

  const back = (
    <div className="flex h-full flex-col rounded-3xl border-2 border-teal-700 bg-section-teal p-5 shadow-warm sm:p-6">
      <p className="text-sm font-semibold text-ink-muted">{n.name}</p>
      <p className="font-display text-h4 leading-tight font-bold text-(--section-heading)">
        <span className="sr-only">{t("superpower")}: </span>
        {n.superpower}
      </p>
      <p className="mt-4 font-semibold text-ink">{t("do")}</p>
      <ul className="mt-1 space-y-2">
        {n.good.map((line) => (
          <li key={line} className="flex gap-2">
            <Check
              aria-hidden="true"
              className="mt-1 size-5 shrink-0 text-green-700 dark:text-green-400"
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 font-semibold text-ink">{t("dont")}</p>
      <ul className="mt-1 space-y-2">
        {n.avoid.map((line) => (
          <li key={line} className="flex gap-2">
            <X
              aria-hidden="true"
              className="mt-1 size-5 shrink-0 text-red-700 dark:text-red-400"
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <details className="group/d mt-4 rounded-2xl bg-surface p-3 text-sm">
        <summary className="flex min-h-6 cursor-pointer items-center font-semibold text-ink">
          {t("grownUps")}
        </summary>
        <div className="mt-2 space-y-2 text-ink">
          <p>
            <strong>{t("theStudy")}:</strong> {n.factDetail}
          </p>
          <p>{n.grownUps}</p>
          <p className="font-semibold">{t("sources")}</p>
          <ul className="space-y-1">
            {n.sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  className="inline-flex min-h-6 items-center text-link underline underline-offset-2 hover:text-link-hover"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );

  return (
    <FlipCard
      front={front}
      back={back}
      label={t("flipLabel", { name: n.name })}
      buttonText={t("flip")}
      className="h-full"
    />
  );
}
