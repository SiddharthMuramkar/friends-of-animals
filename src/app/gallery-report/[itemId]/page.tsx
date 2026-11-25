import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/site/heading";
import { Section } from "@/components/site/section";
import { buttonStyles } from "@/components/site/button-link";
import { as, currentActor } from "@/server/app";
import { PUBLIC_READER } from "../../competitions/_lib/public-reader";
import { ReportFields } from "../../gallery/[itemId]/report/_form";
import { sendGalleryReport } from "../../gallery/[itemId]/report/actions";
import { reportLabels } from "../../gallery/[itemId]/report/labels";
export const instant = false;
export const metadata = {
  title: "Report gallery artwork",
  robots: { index: false, follow: false },
};
export default async function Page({
  params,
  searchParams,
}: PageProps<"/gallery-report/[itemId]">) {
  await connection();
  const [{ itemId }, query, t, labels] = await Promise.all([
    params,
    searchParams,
    getTranslations("gallery"),
    reportLabels(),
  ]);
  const item = await as(PUBLIC_READER).getPublicGalleryItem({ itemId });
  if (!item) notFound();
  const proof =
    query.result === "sent"
      ? null
      : await as(await currentActor()).issueGalleryPlainProof();
  return (
    <Section hue="pink" tone="tint" className="pt-10 sm:pt-14">
      <PageHeader title={t("reportTitle")} lead={t("reportLead")} />
      {query.result === "sent" ? (
        <p role="status" className="mt-6 text-lead text-ink">
          {t("sent")}
        </p>
      ) : (
        <>
          <h2 className="mt-6 text-h3">{item.title}</h2>
          {query.result ? (
            <p role="alert" className="mt-4">
              {t(query.result === "rate_limited" ? "rate_limited" : "invalid")}
            </p>
          ) : null}
          {proof ? (
            <form
              action={sendGalleryReport.bind(null, itemId)}
              className="mt-6 grid max-w-xl gap-3"
            >
              <ReportFields labels={labels} />
              <input type="hidden" name="plain" value="1" />
              <input type="hidden" name="humanCheckToken" value={proof.token} />
              <input type="hidden" name="humanCheckNonce" value={proof.nonce} />
              <button className={buttonStyles()}>{labels.send}</button>
            </form>
          ) : (
            <p className="mt-4">{t("plainUnavailable")}</p>
          )}
        </>
      )}
    </Section>
  );
}
