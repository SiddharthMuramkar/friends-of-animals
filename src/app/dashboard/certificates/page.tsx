import { getFormatter, getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { as, currentActor } from "@/server/app";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { buttonStyles, ButtonLink } from "@/components/site/button-link";
import { MY_CERTIFICATES } from "@/lib/app-routes";
import { DomainError } from "@/server/errors";
import { ROUTES } from "@/lib/routes";
export const instant = false;
export const metadata = {
  title: "Certificates",
  robots: { index: false, follow: false },
};
async function prepareShare(certificateId: string) {
  "use server";
  try {
    const result = await as(await currentActor()).requestCertificateShare({
      certificateId,
    });
    redirect(
      `${MY_CERTIFICATES}?share=${result.ok ? result.status : "unavailable"}`
    );
  } catch (error) {
    if (error instanceof DomainError && error.code === "forbidden")
      redirect(`${MY_CERTIFICATES}?share=unavailable`);
    throw error;
  }
}
export default async function Page({
  searchParams,
}: PageProps<"/dashboard/certificates">) {
  const actor = await currentActor();
  if (actor.kind !== "user") redirect(ROUTES.signIn.path);
  const [t, format, rows, query] = await Promise.all([
    getTranslations("certificates"),
    getFormatter(),
    as(actor).listMyCertificates(),
    searchParams,
  ]);
  return (
    <Section hue="green" width="wide" className="pt-10 sm:pt-14">
      <PageHeader title={t("title")} lead={t("myLead")} />
      {query.share === "queued" && (
        <output className="mt-4 block">
          {t("shareQueued")}{" "}
          <a
            className="font-semibold text-link underline"
            href={MY_CERTIFICATES}
          >
            {t("refresh")}
          </a>
        </output>
      )}
      {query.share === "unavailable" && (
        <p role="alert" className="mt-4">
          {t("shareUnavailable")}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="mt-8">{t("empty")}</p>
      ) : (
        Array.from(
          Map.groupBy(rows, (row) => row.participantProfileId),
          ([profileId, certs]) => (
            <section key={profileId} className="mt-8 grid gap-4">
              <h2 className="text-h2">{certs[0]!.recipientName}</h2>
              <ul className="grid gap-4 sm:grid-cols-2">
                {certs.map((c) => (
                  <li
                    key={c.id}
                    className="grid gap-3 rounded-3xl border-2 border-border bg-surface p-5"
                  >
                    <h3 className="text-h3">{t(`type.${c.type}`)}</h3>
                    <p>{c.competitionName}</p>
                    <p className="break-words font-semibold">{c.number}</p>
                    <p>{format.dateTime(c.issuedAt, "longDateTime")}</p>
                    <p>
                      {t(`status.${c.status}`)} ·{" "}
                      {t(`renderStatus.${c.renderStatus}`)}
                    </p>
                    {c.downloadable && (
                      <a
                        href={`/api/certificates/${c.id}/pdf`}
                        className="inline-flex min-h-12 items-center font-semibold text-link underline"
                      >
                        {t("download")}
                        <span className="sr-only"> {c.number}</span>
                      </a>
                    )}
                    {c.shareReady ? (
                      <a
                        href={`/api/certificates/${c.id}/share`}
                        className="inline-flex min-h-12 items-center font-semibold text-link underline"
                      >
                        {t("downloadShare")}
                        <span className="sr-only"> {c.number}</span>
                      </a>
                    ) : c.downloadable ? (
                      <form action={prepareShare.bind(null, c.id)}>
                        <button
                          type="submit"
                          className={buttonStyles({ variant: "secondary" })}
                        >
                          {t("prepareShare")}
                          <span className="sr-only"> {c.number}</span>
                        </button>
                      </form>
                    ) : null}
                    <ButtonLink
                      variant="secondary"
                      href={`/verify/${c.number}`}
                    >
                      {t("verify")}
                      <span className="sr-only"> {c.number}</span>
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            </section>
          )
        )
      )}
    </Section>
  );
}
