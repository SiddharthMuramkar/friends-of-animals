import { Globe, Phone } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ExplainState } from "@/components/site/explain-state";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { LegalDocument } from "../_components/legal-document";
import { QuickExit } from "../_components/quick-exit";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("legal.safeguarding.meta");
  return pageMetadata({
    title: t("title"),
    description: t("description"),
    path: ROUTES.safeguarding.path,
  });
}

const CYBER_NUMBER = "1930";
const CYBER_SITE = "cybercrime.gov.in";

const CALL =
  "inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover [&_svg]:size-5";

/** 112, Childline 1098 and cybercrime.gov.in / 1930 (DIRECTION §5, SPEC §12.9). */
async function Helplines() {
  const t = await getTranslations("legal.safeguarding.helplines");
  const lines = [
    { key: "emergency", number: "112" },
    { key: "childline", number: "1098" },
  ] as const;
  return (
    <section
      aria-labelledby="helplines"
      className="mb-8 max-w-3xl rounded-3xl border-2 border-red-700 bg-section-red p-6 sm:p-8 dark:border-red-400"
    >
      <h2
        id="helplines"
        className="font-display text-h3 leading-tight text-(--section-red-heading)"
      >
        {t("title")}
      </h2>
      <p className="mt-2 text-ink">{t("intro")}</p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-3">
        {lines.map(({ key, number }) => (
          <li
            key={key}
            className="flex flex-col gap-2 rounded-2xl border-2 border-border bg-surface p-4"
          >
            <p className="font-semibold text-ink-muted">{t(key)}</p>
            <p className="font-display text-h2 leading-none font-bold text-ink">
              {number}
            </p>
            <p className="text-sm text-ink-muted">{t(`${key}Body`)}</p>
            <a href={`tel:${number}`} className={`${CALL} mt-auto self-start`}>
              <Phone aria-hidden="true" />
              {t("call", { number })}
            </a>
          </li>
        ))}
        <li className="flex flex-col gap-2 rounded-2xl border-2 border-border bg-surface p-4">
          <p className="font-semibold text-ink-muted">{t("cyber")}</p>
          <p className="font-display text-h4 leading-tight font-bold break-words text-ink">
            {CYBER_NUMBER}
          </p>
          <p className="text-sm text-ink-muted">{t("cyberBody")}</p>
          <div className="mt-auto flex flex-col items-start gap-2">
            <a href={`tel:${CYBER_NUMBER}`} className={CALL}>
              <Phone aria-hidden="true" />
              {t("call", { number: CYBER_NUMBER })}
            </a>
            <a
              href={`https://${CYBER_SITE}`}
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 font-semibold text-link underline underline-offset-2 [&_svg]:size-5"
            >
              <Globe aria-hidden="true" />
              {CYBER_SITE}
            </a>
          </div>
        </li>
      </ul>
    </section>
  );
}

export default async function Page() {
  const t = await getTranslations("legal.safeguarding");
  return (
    <>
      <div className="sticky top-(--header-height) z-30 border-b-2 border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
          <p
            id="quick-exit-hint"
            className="sr-only text-sm text-ink-muted sm:not-sr-only"
          >
            {t("quickExitHint")}
          </p>
          <QuickExit label={t("quickExit")} hintId="quick-exit-hint" />
        </div>
      </div>
      <LegalDocument
        id="safeguarding"
        top={<Helplines />}
        after={{
          "how-to-report": (
            <ExplainState
              title={t("form.title")}
              headingLevel="h3"
              back={{
                href: ROUTES.childProtection.path,
                label: t("form.back"),
              }}
            >
              <p>{t("form.body")}</p>
            </ExplainState>
          ),
        }}
      />
    </>
  );
}
