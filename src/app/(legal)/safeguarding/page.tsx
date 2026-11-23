import { Globe, MessageSquareWarning, Phone } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { ButtonLink } from "@/components/site/button-link";
import { ROUTES } from "@/lib/routes";
import { pageMetadata } from "@/lib/seo";

import { LegalDocument } from "../_components/legal-document";

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
  "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full bg-primary px-3 font-semibold text-primary-fg hover:bg-primary-hover sm:px-5 [&_svg]:size-5 [&_svg]:shrink-0";

/** Helplines: 112, Childline 1098 and cybercrime.gov.in / 1930. */
async function Helplines() {
  const t = await getTranslations("legal.safeguarding.helplines");
  const lines = [
    { key: "emergency", number: "112" },
    { key: "childline", number: "1098" },
  ] as const;
  return (
    <section
      aria-labelledby="helplines"
      className="mb-8 max-w-3xl rounded-3xl border-2 border-red-700 bg-section-red px-4 py-6 sm:p-8 dark:border-red-400"
    >
      <h2
        id="helplines"
        className="font-display text-h3 leading-tight text-(--section-red-heading)"
      >
        {t("title")}
      </h2>
      <p className="mt-2 text-ink">{t("intro")}</p>
      <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {lines.map(({ key, number }) => (
          <li
            key={key}
            className="flex flex-col gap-2 rounded-2xl border-2 border-border bg-surface p-3 sm:p-4"
          >
            <p className="font-semibold text-ink-muted">{t(key)}</p>
            <p className="font-display text-h2 leading-none font-bold text-ink">
              {number}
            </p>
            <p className="text-sm text-ink-muted">{t(`${key}Body`)}</p>
            <a href={`tel:${number}`} className={`${CALL} mt-auto self-start`}>
              <Phone aria-hidden="true" />
              <span className="min-w-0">{t("call", { number })}</span>
            </a>
          </li>
        ))}
        <li className="flex flex-col gap-2 rounded-2xl border-2 border-border bg-surface p-3 sm:p-4">
          <p className="font-semibold text-ink-muted">{t("cyber")}</p>
          <p className="font-display text-h4 leading-tight font-bold break-words text-ink">
            {CYBER_NUMBER}
          </p>
          <p className="text-sm text-ink-muted">{t("cyberBody")}</p>
          <div className="mt-auto flex flex-col items-start gap-2">
            <a href={`tel:${CYBER_NUMBER}`} className={CALL}>
              <Phone aria-hidden="true" />
              <span className="min-w-0">
                {t("call", { number: CYBER_NUMBER })}
              </span>
            </a>
            <a
              href={`https://${CYBER_SITE}`}
              rel="noreferrer"
              className="inline-flex min-h-11 max-w-full items-center gap-2 font-semibold text-link underline underline-offset-2 [&_svg]:size-5 [&_svg]:shrink-0"
            >
              <Globe aria-hidden="true" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {CYBER_SITE}
              </span>
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
    <LegalDocument
      id="safeguarding"
      top={<Helplines />}
      after={{
        "how-to-report": (
          <section
            aria-labelledby="report-form-title"
            className="rounded-3xl border-2 border-border bg-surface px-4 py-6 shadow-warm sm:p-8"
          >
            <h3 id="report-form-title" className="text-h3">
              {t("form.title")}
            </h3>
            <p className="mt-3 max-w-prose text-ink-muted">{t("form.body")}</p>
            <ButtonLink href={ROUTES.safeguardingReport.path} className="mt-6">
              <MessageSquareWarning aria-hidden="true" />
              {t("form.link")}
            </ButtonLink>
          </section>
        ),
      }}
    />
  );
}
