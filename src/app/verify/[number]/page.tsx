import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { ButtonLink } from "@/components/site/button-link";
import { as, currentActor } from "@/server/app";
export const metadata = {
  title: "Certificate verification",
  robots: { index: false, follow: false },
};
export function generateStaticParams() {
  return [{ number: "unknown" }];
}
async function Result({ params }: PageProps<"/verify/[number]">) {
  await connection();
  const t = await getTranslations("certificates");
  const outcome = await as(await currentActor()).verifyCertificate({
    number: (await params).number,
  });
  return (
    <div className="mt-8 grid gap-4 rounded-3xl border-2 border-border bg-surface p-5 sm:p-6">
      <h2 className="text-h2 text-ink">
        {t(outcome.outcome === "rate_limited" ? "limited" : outcome.outcome)}
      </h2>
      {outcome.outcome === "valid" ? (
        <dl className="grid gap-4 break-words">
          <div>
            <dt className="font-semibold">{t("number")}</dt>
            <dd>{outcome.number}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t("award")}</dt>
            <dd>
              {t(`type.${outcome.type}`)}
              {outcome.awardPosition
                ? ` · ${t("position", { position: outcome.awardPosition })}`
                : ""}
            </dd>
          </div>
          {outcome.competition && (
            <div>
              <dt className="font-semibold">{t("competition")}</dt>
              <dd>
                {outcome.competition.name} ({outcome.competition.code})
              </dd>
            </div>
          )}
          <div>
            <dt className="font-semibold">{t("recipient")}</dt>
            <dd>{outcome.credit?.name ?? t("withheld")}</dd>
          </div>
          <div>
            <dt className="font-semibold">{t("date")}</dt>
            <dd>{`${outcome.issuedOn.day}/${outcome.issuedOn.month}/${outcome.issuedOn.year}`}</dd>
          </div>
        </dl>
      ) : (
        <p>
          {outcome.outcome === "unknown"
            ? t("unknownLead")
            : outcome.outcome === "revoked"
              ? t("revokedLead")
              : t("limitedLead", { seconds: outcome.retryAfterSeconds })}
        </p>
      )}
      <ButtonLink variant="secondary" href="/verify">
        {t("another")}
      </ButtonLink>
    </div>
  );
}
export default async function Page(props: PageProps<"/verify/[number]">) {
  const t = await getTranslations("certificates");
  return (
    <Section
      width="prose"
      hue="green"
      tone="tint"
      className="pt-10 sm:pt-14 min-h-svh"
    >
      <PageHeader title={t("verify")} />
      <Suspense fallback={<p className="mt-8">{t("loading")}</p>}>
        <Result {...props} />
      </Suspense>
    </Section>
  );
}
