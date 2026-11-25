import { Suspense } from "react";
import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ButtonLink } from "@/components/site/button-link";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { slugHref } from "@/lib/routes";
import { as } from "@/server/app";
import { PUBLIC_READER } from "../../_lib/public-reader";

// No cached credit or indexing: the guardian can withdraw consent at any time.
export const metadata = {
  title: "Competition results",
  robots: { index: false, follow: false },
};
export function generateStaticParams() {
  return [{ slug: "__placeholder__" }];
}
async function Results({ params }: PageProps<"/competitions/[slug]/results">) {
  await connection();
  const { slug } = await params;
  const [results, t, format] = await Promise.all([
    as(PUBLIC_READER).getPublicResults({ slug }),
    getTranslations("results"),
    getFormatter(),
  ]);
  if (!results) {
    // The public competition detail is cached independently of the worker's
    // release job. This live waiting view makes the results link discoverable
    // from any public competition without ever reading an unpublished snapshot.
    const comp = await as(PUBLIC_READER).getPublishedCompetition({ slug });
    if (!comp) notFound();
    return (
      <div className="grid gap-6">
        <ButtonLink variant="quiet" href={slugHref("competition", slug)}>
          {t("backCompetition")}
        </ButtonLink>
        <section className="rounded-3xl border-2 border-border bg-surface p-5">
          <h2 className="text-h2 text-ink">
            {t("publicTitle", { competition: comp.name })}
          </h2>
          <p className="mt-3 font-semibold text-ink">
            {t(comp.status === "cancelled" ? "cancelled" : "waiting")}
          </p>
          <p className="mt-2 text-ink-muted">
            {t(comp.status === "cancelled" ? "cancelledBody" : "waitingBody")}
          </p>
        </section>
      </div>
    );
  }
  const groups = Map.groupBy(
    results.awards,
    (a) => `${a.discipline}/${a.category}`
  );
  return (
    <div className="grid gap-8">
      <ButtonLink variant="quiet" href={slugHref("competition", slug)}>
        {t("backCompetition")}
      </ButtonLink>
      <header>
        <h2 className="text-h2 text-ink">
          {t("publicTitle", { competition: results.competitionName })}
        </h2>
        <p className="mt-2 text-ink-muted">
          {t("publicLead", {
            at: format.dateTime(results.publishedAt, "longDateTime"),
          })}
        </p>
      </header>
      {groups.size === 0 ? (
        <p className="rounded-3xl border-2 border-border bg-surface p-5">
          {t("noPublicAwards")}
        </p>
      ) : (
        Array.from(groups, ([key, awards]) => (
          <section key={key} className="grid gap-4">
            <h3 className="text-h3 text-ink">
              {t("categoryHeading", {
                discipline: t(`disciplines.${awards[0]!.discipline}`),
                category: awards[0]!.category,
              })}
            </h3>
            <ul className="grid gap-4 sm:grid-cols-2">
              {awards.map((award, index) => (
                <li
                  key={index}
                  className="rounded-3xl border-2 border-border bg-surface p-5 shadow-warm"
                >
                  <p className="font-semibold text-ink-muted">
                    {award.awardBand
                      ? t(`bands.${award.awardBand}`)
                      : t(`outcomes.${award.outcome}`)}
                  </p>
                  <p className="mt-2 text-h3 text-ink">{award.credit.name}</p>
                  {(award.credit.school || award.credit.city) && (
                    <p className="mt-1 text-ink-muted">
                      {[award.credit.school, award.credit.city]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
export default async function Page(
  props: PageProps<"/competitions/[slug]/results">
) {
  const t = await getTranslations("results");
  return (
    <Section hue="pink" tone="tint" className="min-h-svh pt-10 sm:pt-14">
      <PageHeader
        title={t("publicPageTitle")}
        lead={t("consentNote")}
        tile="pink"
      />
      <div className="mt-8">
        <Suspense
          fallback={
            <output className="block min-h-64">
              <span className="sr-only">{t("loading")}</span>
              <span
                aria-hidden="true"
                className="block min-h-64 rounded-3xl border-2 border-border bg-surface-muted"
              />
            </output>
          }
        >
          <Results {...props} />
        </Suspense>
      </div>
    </Section>
  );
}
