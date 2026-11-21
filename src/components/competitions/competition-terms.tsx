import { FileText } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";

import { SiteLink } from "@/components/site/site-link";
import { TileMarker } from "@/components/site/tile";
import type { PublicCompetitionTerms } from "@/server/modules/competitions/terms";

import { feeText } from "./fee-text";

const LINK =
  "inline-flex min-h-6 items-center gap-2 text-link underline decoration-1 underline-offset-2 hover:text-link-hover";

/**
 * A published competition's fees, prizes and the exact versions of the
 * documents registering agrees to (#72). The public detail page (#70)
 * and the admin preview render it from the read model's `terms`.
 */
export async function CompetitionTerms({
  terms,
  headingLevel = "h2",
}: {
  terms: PublicCompetitionTerms;
  headingLevel?: "h2" | "h3";
}) {
  const [t, tFees, format] = await Promise.all([
    getTranslations("competitionTerms"),
    getTranslations("competitionTerms.fees"),
    getFormatter(),
  ]);
  const Heading = headingLevel;
  const Sub = headingLevel === "h2" ? "h3" : "h4";

  return (
    <section
      aria-labelledby="competition-terms"
      className="rounded-3xl border-2 border-border bg-surface p-6 shadow-warm sm:p-8"
    >
      <Heading
        id="competition-terms"
        className="flex items-center gap-2.5 font-display text-h4 leading-tight"
      >
        <TileMarker hue="pink" />
        {t("heading")}
      </Heading>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div>
          <Sub className="font-display text-lead font-semibold">
            {t("fees.heading")}
          </Sub>
          <dl className="mt-3 space-y-3">
            {terms.fees.map((line) => (
              <div key={line.route}>
                <dt className="text-sm text-ink-muted">
                  {t(`fees.route.${line.route}`)}
                </dt>
                <dd className="text-lead font-semibold text-ink">
                  {feeText(line, { t: tFees, format })}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div>
          <Sub className="font-display text-lead font-semibold">
            {t("awards.heading")}
          </Sub>
          <div className="mt-3 space-y-4">
            {terms.awards.map((round) => (
              <div key={round.roundKey}>
                <p className="font-semibold text-ink">
                  {t(`awards.round.${round.roundKey}`)}
                  <span className="font-normal text-ink-muted">
                    {" · "}
                    {t(`awards.scheme.${round.scheme}`)}
                  </span>
                </p>
                <ul className="mt-1 space-y-1 text-ink">
                  {round.bands.map(({ band, prize }) => (
                    <li key={band}>
                      <span className="font-semibold">
                        {t(`awards.band.${band}`)}
                      </span>
                      {": "}
                      {prize ?? (
                        <span className="text-ink-muted">
                          {t("awards.noPrize")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8">
        <Sub className="font-display text-lead font-semibold">
          {t("documents.heading")}
        </Sub>
        {terms.documents.length > 0 ? (
          <>
            <p className="mt-1 text-ink-muted">{t("documents.lead")}</p>
            <ul className="mt-3 space-y-2">
              {terms.documents.map((document) => (
                <li key={document.purpose}>
                  <SiteLink href={document.href} className={LINK}>
                    <FileText aria-hidden="true" className="size-4 shrink-0" />
                    {t("documents.link", {
                      title: document.title,
                      version: document.version,
                    })}
                  </SiteLink>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="mt-1 text-ink-muted">{t("documents.none")}</p>
        )}
      </div>
    </section>
  );
}
